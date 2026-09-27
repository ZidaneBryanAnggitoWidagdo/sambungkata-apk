package com.zdngg.sambungkata

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil

/**
 * BtManager — mabar lewat Bluetooth (RFCOMM) tanpa internet.
 *
 * Peran:
 *  - HOST : listenUsingInsecureRfcommWithServiceRecord + accept loop.
 *           Hub relay-nya 1:1 sama dengan GameServer.kt (protokol WebSocket):
 *           hello/join/join_rejected/joined_ok/roster/gmsg/chat/srv_kick/srv_direct/kicked/left.
 *           "Konsol" host bukan socket — pesan masuk lewat AndroidBridge.btSend()
 *           dan keluar lewat event {k:"bt_msg"}.
 *  - CLIENT: createInsecureRfcommSocketToServiceRecord + connect ke UUID aplikasi.
 *           Semua pesan lewat btSend / event bt_msg, persis jalur WebSocket.
 *
 * Identifikasi blokir kick memakai alamat MAC perangkat (padanan IP di WiFi).
 */
@SuppressLint("MissingPermission")
class BtManager(
    private val context: Context,
    private val pushEvent: (JSONObject) -> Unit
) {
    companion object {
        val APP_UUID: UUID = UUID.fromString("e63f1d28-9f2c-4a1f-b7a4-7c2d5a8b3e11")
        const val SDP_NAME = "SambungKata"
        const val MAX_CLIENTS = 12      // + 1 host = 13 pemain
        const val BAN_MS = 30_000L
    }

    private val btManager =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = btManager.adapter

    // ---------------- state host ----------------
    private var serverSocket: BluetoothServerSocket? = null
    private var acceptThread: Thread? = null
    private var hosting = false
    private var pin = ""

    private class BtConn(val id: String, val mac: String, val socket: BluetoothSocket) {
        var name: String = "anon"
        var joined: Boolean = false
        val writeLock = Any()
        var writer: PrintWriter? = null
    }

    private val conns = ConcurrentHashMap<String, BtConn>()
    private val roster = ConcurrentHashMap<String, BtConn>() // id -> conn yang sudah join
    private val bans = ConcurrentHashMap<String, Long>()      // mac -> until (epoch ms)
    private val lock = Any()
    private var counter = 0

    // ---------------- state client ----------------
    private var clientSocket: BluetoothSocket? = null
    private var clientWriter: PrintWriter? = null
    private val clientWriteLock = Any()
    private var clientThread: Thread? = null
    private var clientMode = false

    // ---------------- scan ----------------
    private var receiverRegistered = false
    private var scanning = false

    private fun newId(): String = synchronized(lock) { "c" + (++counter) }

    private fun adapterName(): String = try {
        adapter?.name ?: ""
    } catch (e: Exception) { "" }

    // =========================================================
    //  HOST
    // =========================================================

    fun startHost(pin6: String, roomName: String) {
        val ad = adapter
        if (ad == null) { emitError("Perangkat tidak punya Bluetooth."); return }
        if (hosting) {
            emitStarted()
            return
        }
        this.pin = pin6.filter { it.isDigit() }.take(6).padEnd(6, '0')
        this.hosting = true
        this.clientMode = false
        this.conns.clear()
        this.roster.clear()
        this.bans.clear()
        try {
            val ss = ad.listenUsingInsecureRfcommWithServiceRecord(SDP_NAME, APP_UUID)
            serverSocket = ss
            emitStarted()
            acceptThread = Thread {
                while (hosting) {
                    try {
                        val sock = ss.accept()
                        registerConn(sock)
                    } catch (e: IOException) {
                        break // socket server ditutup
                    } catch (e: SecurityException) {
                        break
                    }
                }
            }.apply { isDaemon = true; start() }
        } catch (e: Exception) {
            hosting = false
            serverSocket = null
            emitError("Gagal membuka Bluetooth server: " + (e.message ?: "?"))
        }
    }

    private fun emitStarted() {
        pushEvent(JSONObject()
            .put("k", "bt_server_started")
            .put("pin", pin)
            .put("deviceName", adapterName()))
        // konsol host (virtual) langsung "terhubung" — sama seperti WebSocket loopback
        pushJson(JSONObject().put("t", "hello").put("id", "H"))
    }

    private fun emitError(msg: String) {
        pushEvent(JSONObject().put("k", "bt_error").put("err", msg))
    }

    private fun registerConn(sock: BluetoothSocket) {
        val mac = try { sock.remoteDevice?.address ?: genMac() } catch (e: Exception) { genMac() }
        val conn = BtConn(newId(), mac, sock)
        try {
            conn.writer = PrintWriter(OutputStreamWriter(sock.outputStream, Charsets.UTF_8), true)
        } catch (e: Exception) {
            try { sock.close() } catch (e2: Exception) {}
            return
        }
        conns[conn.id] = conn
        sendTo(conn, JSONObject().put("t", "hello").put("id", conn.id))
        toConsole(JSONObject().put("t", "conn").put("id", conn.id).put("mac", mac))
        Thread {
            try {
                val reader = BufferedReader(InputStreamReader(sock.inputStream, Charsets.UTF_8))
                var line: String? = reader.readLine()
                while (line != null && hosting && conns[conn.id] != null) {
                    if (line.isNotBlank()) onClientMessage(conn, line)
                    line = reader.readLine()
                }
            } catch (e: Exception) { /* koneksi putus */ }
            dropConn(conn)
        }.apply { isDaemon = true; start() }
    }

    private fun genMac(): String = "bt-" + newId()

    private fun dropConn(conn: BtConn) {
        conns.remove(conn.id)
        try { conn.socket.close() } catch (e: Exception) {}
        if (roster.remove(conn.id) != null) {
            broadcastRoster()
            toConsole(JSONObject().put("t", "left").put("id", conn.id))
        }
    }

    private fun onClientMessage(conn: BtConn, raw: String) {
        val msg = try { JSONObject(raw) } catch (e: Exception) { return }
        when (msg.optString("t")) {
            "join" -> join(conn, msg)
            "gmsg" -> {
                if (!conn.joined) return
                val d = msg.optJSONObject("d") ?: return
                broadcastExcept(conn, JSONObject()
                    .put("t", "gmsg").put("from", conn.id).put("name", conn.name).put("d", d))
                toConsole(JSONObject()
                    .put("t", "gmsg").put("from", conn.id).put("name", conn.name).put("d", d))
            }
            "chat" -> {
                if (!conn.joined) return
                val text = msg.optString("text").take(300)
                if (text.isEmpty()) return
                broadcastExcept(conn, JSONObject()
                    .put("t", "chat").put("from", conn.id).put("name", conn.name).put("text", text))
                toConsole(JSONObject()
                    .put("t", "chat").put("from", conn.id).put("name", conn.name).put("text", text))
            }
        }
    }

    /** Pesan dari konsol host (JS) — dipicu AndroidBridge.btSend() saat hosting. */
    private fun onConsoleMessage(raw: String) {
        val msg = try { JSONObject(raw) } catch (e: Exception) { return }
        when (msg.optString("t")) {
            "srv_kick" -> kick(msg.optString("id"), msg.optString("reason"))
            "srv_direct" -> direct(msg.optString("id"), msg.optJSONObject("msg"))
            "gmsg" -> {
                val d = msg.optJSONObject("d") ?: return
                broadcast(JSONObject()
                    .put("t", "gmsg").put("from", "H").put("name", "HOST").put("d", d))
            }
            "chat" -> {
                val text = msg.optString("text").take(300)
                if (text.isNotEmpty()) broadcast(JSONObject()
                    .put("t", "chat").put("from", "H").put("name", "HOST").put("text", text))
            }
        }
    }

    private fun join(conn: BtConn, msg: JSONObject) {
        val now = System.currentTimeMillis()
        // 1) blokir kick — mencoba saat diblokir = sisa digandakan
        val until = bans[conn.mac]
        if (until != null && until > now) {
            val remaining = until - now
            bans[conn.mac] = now + remaining * 2
            sendTo(conn, JSONObject()
                .put("t", "join_rejected")
                .put("reason", "banned")
                .put("wait", ceil((remaining * 2) / 1000.0).toInt()))
            return
        }
        // 2) PIN
        if (msg.optString("pin") != pin) {
            sendTo(conn, JSONObject().put("t", "join_rejected").put("reason", "pin"))
            return
        }
        // 3) kapasitas
        if (roster.size >= MAX_CLIENTS) {
            sendTo(conn, JSONObject().put("t", "join_rejected").put("reason", "full"))
            return
        }
        // 4) terima
        conn.name = msg.optString("name").take(15).ifEmpty { "anon" }
        conn.joined = true
        roster[conn.id] = conn
        val players = rosterJson()
        sendTo(conn, JSONObject().put("t", "joined_ok").put("id", conn.id).put("players", players))
        broadcastRoster()
        toConsole(JSONObject().put("t", "joined").put("id", conn.id)
            .put("name", conn.name).put("mac", conn.mac))
    }

    private fun rosterJson(): org.json.JSONArray {
        val players = org.json.JSONArray()
        players.put(JSONObject().put("id", "H").put("name", "HOST"))
        for (r in roster.values) players.put(JSONObject().put("id", r.id).put("name", r.name))
        return players
    }

    private fun broadcastRoster() {
        val msg = JSONObject().put("t", "roster").put("players", rosterJson())
        broadcast(msg)
        toConsole(msg)
    }

    private fun kick(targetId: String, reason: String) {
        val conn = roster[targetId] ?: return
        val cleanReason = reason.take(200).ifEmpty { "dikeluarkan host" }
        sendTo(conn, JSONObject()
            .put("t", "kicked")
            .put("reason", cleanReason)
            .put("wait", (BAN_MS / 1000).toInt()))
        roster.remove(targetId)
        bans[conn.mac] = System.currentTimeMillis() + BAN_MS
        conns.remove(targetId)
        try { conn.socket.close() } catch (e: Exception) {}
        broadcastRoster()
        toConsole(JSONObject().put("t", "left").put("id", targetId))
    }

    private fun direct(targetId: String, raw: JSONObject?) {
        if (raw == null) return
        for (c in conns.values) if (c.id == targetId) { sendTo(c, raw); return }
    }

    fun stopHost() {
        hosting = false
        try { serverSocket?.close() } catch (e: Exception) {}
        serverSocket = null
        for (c in conns.values) { try { c.socket.close() } catch (e: Exception) {} }
        conns.clear()
        roster.clear()
        acceptThread = null
        pushEvent(JSONObject().put("k", "bt_server_stopped"))
    }

    // =========================================================
    //  CLIENT
    // =========================================================

    fun connect(addr: String) {
        val ad = adapter
        if (ad == null) { emitError("Perangkat tidak punya Bluetooth."); return }
        disconnectClient()
        clientMode = true
        val thread = Thread {
            try {
                try { ad.cancelDiscovery() } catch (e: Exception) {}
                val device: BluetoothDevice = ad.getRemoteDevice(addr)
                val sock = device.createInsecureRfcommSocketToServiceRecord(APP_UUID)
                clientSocket = sock
                sock.connect()
                clientWriter = PrintWriter(OutputStreamWriter(sock.outputStream, Charsets.UTF_8), true)
                clientThread = Thread.currentThread()
                pushEvent(JSONObject().put("k", "bt_open").put("addr", addr))
                val reader = BufferedReader(InputStreamReader(sock.inputStream, Charsets.UTF_8))
                var line: String? = reader.readLine()
                while (line != null) {
                    if (line.isNotBlank()) pushEvent(JSONObject()
                        .put("k", "bt_msg").put("data", line))
                    line = reader.readLine()
                }
                pushEvent(JSONObject().put("k", "bt_close"))
            } catch (e: SecurityException) {
                emitError("Izin Bluetooth belum diberikan.")
                pushEvent(JSONObject().put("k", "bt_close"))
            } catch (e: Exception) {
                if (clientMode) {
                    emitError("Gagal terhubung: " + (e.message ?: "perangkat tidak merespons"))
                    pushEvent(JSONObject().put("k", "bt_close"))
                }
            }
        }.apply { isDaemon = true; start() }
        clientThread = thread
    }

    fun disconnectClient() {
        clientMode = false
        clientThread = null
        clientWriter = null
        val sock = clientSocket
        clientSocket = null
        if (sock != null) { try { sock.close() } catch (e: Exception) {} }
    }

    // =========================================================
    //  SCAN perangkat
    // =========================================================

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val dev = try {
                        intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
                    } catch (e: Exception) { null } ?: return
                    val addr = try { dev.address } catch (e: Exception) { return }
                    val name = try { dev.name ?: "" } catch (e: Exception) { "" }
                    pushEvent(JSONObject()
                        .put("k", "bt_device")
                        .put("name", name.ifEmpty { "Perangkat tanpa nama" })
                        .put("addr", addr))
                }
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                    scanning = false
                    pushEvent(JSONObject().put("k", "bt_scan_done"))
                }
            }
        }
    }

    fun startScan() {
        val ad = adapter
        if (ad == null) { emitError("Perangkat tidak punya Bluetooth."); return }
        registerScanReceiver()
        // perangkat sudah dipasangkan (bonded) dikirim duluan
        try {
            for (d in ad.bondedDevices) {
                pushEvent(JSONObject()
                    .put("k", "bt_device")
                    .put("name", (d.name ?: "").ifEmpty { "Perangkat tanpa nama" })
                    .put("addr", d.address))
            }
        } catch (e: Exception) { /* izin */ }
        try {
            if (ad.isDiscovering) ad.cancelDiscovery()
            val ok = ad.startDiscovery()
            scanning = ok
            if (!ok) pushEvent(JSONObject().put("k", "bt_scan_done"))
        } catch (e: Exception) {
            scanning = false
            pushEvent(JSONObject().put("k", "bt_scan_done"))
            emitError("Gagal memindai: " + (e.message ?: "?"))
        }
    }

    fun stopScan() {
        scanning = false
        try { adapter?.cancelDiscovery() } catch (e: Exception) {}
    }

    private fun registerScanReceiver() {
        if (receiverRegistered) return
        val f = IntentFilter()
        f.addAction(BluetoothDevice.ACTION_FOUND)
        f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(receiver, f)
            }
            receiverRegistered = true
        } catch (e: Exception) {}
    }

    fun cleanup() {
        if (hosting) stopHost()
        disconnectClient()
        stopScan()
        if (receiverRegistered) {
            try { context.unregisterReceiver(receiver) } catch (e: Exception) {}
            receiverRegistered = false
        }
    }

    // =========================================================
    //  UTIL kirim
    // =========================================================

    /** Dipanggil JS lewat AndroidBridge.btSend(). */
    fun onJsSend(raw: String) {
        if (hosting) { onConsoleMessage(raw); return }
        if (clientMode) {
            val w = clientWriter ?: return
            synchronized(clientWriteLock) {
                try { w.println(raw) } catch (e: Exception) {}
            }
        }
    }

    private fun sendTo(conn: BtConn, obj: JSONObject) {
        val w = conn.writer ?: return
        synchronized(conn.writeLock) {
            try { w.println(obj.toString()) } catch (e: Exception) {}
        }
    }

    private fun broadcast(obj: JSONObject) {
        for (c in conns.values) sendTo(c, obj)
    }

    private fun broadcastExcept(sender: BtConn?, obj: JSONObject) {
        for (c in conns.values) {
            if (sender != null && c.id == sender.id) continue
            sendTo(c, obj)
        }
    }

    private fun toConsole(obj: JSONObject) {
        pushEvent(JSONObject().put("k", "bt_msg").put("data", obj.toString()))
    }

    private fun pushJson(obj: JSONObject) {
        pushEvent(JSONObject().put("k", "bt_msg").put("data", obj.toString()))
    }
}
