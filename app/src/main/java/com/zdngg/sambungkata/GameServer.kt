package com.zdngg.sambungkata

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil

/**
 * GameServer — server WebSocket untuk mode online (host = perangkat ini).
 *
 * Protokol 100% mencerminkan tests/mock_relay.js (diverifikasi blackbox):
 *  - koneksi dari 127.0.0.1 = konsol host (dipercaya, boleh srv_*)
 *  - join: cek blokir (sisa digandakan bila mencoba saat diblokir),
 *    cek PIN, cek kapasitas (12 client + host = 13 pemain)
 *  - gmsg / chat: relay ke semua KECUALI pengirim
 *  - srv_kick: kirim alasan ke korban, tutup koneksi, blokir IP 30 detik
 *  - srv_direct: kirim pesan mentah ke satu client
 *  - roster broadcast tiap join/left
 */
class GameServer(
    private val pin: String,
    private val pushEvent: (JSONObject) -> Unit
) : WebSocketServer(InetSocketAddress(8787)) {

    init {
        // host bisa stop -> start lagi cepat tanpa gagal bind (port TIME_WAIT)
        isReuseAddr = true
    }

    companion object {
        const val MAX_CLIENTS = 12          // + 1 host = 13 pemain
        const val BAN_MS = 30_000L          // blokir kick pertama: 30 detik
        const val PORT = 8787
    }

    class ConnInfo(val id: String, val ip: String) {
        var name: String = "anon"
        var joined: Boolean = false
    }

    private val conns = ConcurrentHashMap<WebSocket, ConnInfo>()
    private val roster = ConcurrentHashMap<String, ConnInfo>() // id client yang sudah join
    private val bans = ConcurrentHashMap<String, Long>()        // ip -> until (epoch ms)
    private val lock = Any()
    private var counter = 0

    private fun remoteIp(conn: WebSocket): String {
        return try {
            val addr = conn.remoteSocketAddress ?: return "unknown"
            addr.address?.hostAddress ?: addr.hostString ?: "unknown"
        } catch (e: Exception) { "unknown" }
    }

    private fun isHost(conn: WebSocket): Boolean {
        val ip = conns[conn]?.ip ?: return false
        return ip == "127.0.0.1" || ip == "::1" || ip == "localhost"
    }

    private fun newId(): String = synchronized(lock) { "c" + (++counter) }

    // ---------- lifecycle ----------

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        val ip = remoteIp(conn)
        val info = ConnInfo(newId(), ip)
        conns[conn] = info
        sendJson(conn, JSONObject().put("t", "hello").put("id", info.id))
        if (!isHost(conn)) {
            toHost(JSONObject().put("t", "conn").put("id", info.id).put("ip", ip))
        }
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        val info = conns.remove(conn) ?: return
        if (roster.remove(info.id) != null) {
            broadcastRoster()
            toHost(JSONObject().put("t", "left").put("id", info.id))
        }
    }

    override fun onMessage(conn: WebSocket, message: String) {
        val msg = try { JSONObject(message) } catch (e: Exception) { return }
        val info = conns[conn] ?: return
        val t = msg.optString("t")

        if (isHost(conn)) {
            when (t) {
                "srv_kick" -> return kick(msg.optString("id"), msg.optString("reason"))
                "srv_direct" -> return direct(msg.optString("id"), msg.optJSONObject("msg"))
            }
        }

        when (t) {
            "join" -> join(conn, info, msg)
            "gmsg" -> {
                if (isHost(conn)) {
                    val d = msg.optJSONObject("d") ?: return
                    broadcastExcept(conn, JSONObject()
                        .put("t", "gmsg").put("from", "H").put("name", "HOST").put("d", d))
                } else {
                    if (!info.joined) return
                    val d = msg.optJSONObject("d") ?: return
                    broadcastExcept(conn, JSONObject()
                        .put("t", "gmsg").put("from", info.id).put("name", info.name).put("d", d))
                }
            }
            "chat" -> {
                val text = msg.optString("text").take(300)
                if (text.isEmpty()) return
                if (isHost(conn)) {
                    broadcastExcept(conn, JSONObject()
                        .put("t", "chat").put("from", "H").put("name", "HOST").put("text", text))
                } else {
                    if (!info.joined) return
                    broadcastExcept(conn, JSONObject()
                        .put("t", "chat").put("from", info.id).put("name", info.name).put("text", text))
                }
            }
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) { /* ditangani onClose */ }

    override fun onStart() { /* siap menerima koneksi */ }

    // ---------- fitur ----------

    private fun join(conn: WebSocket, info: ConnInfo, msg: JSONObject) {
        val now = System.currentTimeMillis()
        // 1) cek blokir — mencoba saat diblokir = sisa MENGANDAKAN
        val until = bans[info.ip]
        if (until != null && until > now) {
            val remaining = until - now
            val newUntil = now + remaining * 2
            bans[info.ip] = newUntil
            sendJson(conn, JSONObject()
                .put("t", "join_rejected")
                .put("reason", "banned")
                .put("wait", ceil((remaining * 2) / 1000.0).toInt()))
            return
        }
        // 2) cek PIN
        if (msg.optString("pin") != pin) {
            sendJson(conn, JSONObject().put("t", "join_rejected").put("reason", "pin"))
            return
        }
        // 3) cek kapasitas
        if (roster.size >= MAX_CLIENTS) {
            sendJson(conn, JSONObject().put("t", "join_rejected").put("reason", "full"))
            return
        }
        // 4) terima
        info.name = msg.optString("name").take(15).ifEmpty { "anon" }
        info.joined = true
        roster[info.id] = info
        val players = JSONArray()
        players.put(JSONObject().put("id", "H").put("name", "HOST"))
        for (r in roster.values) players.put(JSONObject().put("id", r.id).put("name", r.name))
        sendJson(conn, JSONObject().put("t", "joined_ok").put("id", info.id).put("players", players))
        broadcastRoster()
        toHost(JSONObject().put("t", "joined").put("id", info.id).put("name", info.name).put("ip", info.ip))
    }

    private fun kick(targetId: String, reason: String) {
        var targetConn: WebSocket? = null
        var victim: ConnInfo? = null
        for ((c, i) in conns) if (i.id == targetId) { targetConn = c; victim = i }
        val info = victim ?: return
        if (!roster.containsKey(targetId)) return

        if (targetConn != null) {
            sendJson(targetConn, JSONObject()
                .put("t", "kicked")
                .put("reason", reason.take(200).ifEmpty { "dikeluarkan host" })
                .put("wait", (BAN_MS / 1000).toInt()))
        }
        roster.remove(targetId)
        if (targetConn != null) {
            bans[info.ip] = System.currentTimeMillis() + BAN_MS
            conns.remove(targetConn)
            try { targetConn.close(4001, "kicked") } catch (e: Exception) {}
        }
        broadcastRoster()
        toHost(JSONObject().put("t", "left").put("id", targetId))
    }

    private fun direct(targetId: String, raw: JSONObject?) {
        if (raw == null) return
        for ((c, i) in conns) if (i.id == targetId) { sendJson(c, raw); return }
    }

    // ---------- util kirim ----------

    private fun sendJson(conn: WebSocket, obj: JSONObject) {
        try { conn.send(obj.toString()) } catch (e: Exception) {}
    }

    private fun toHost(obj: JSONObject) {
        for ((c, i) in conns) if (i.ip == "127.0.0.1" || i.ip == "::1") sendJson(c, obj)
    }

    private fun broadcastRoster() {
        val players = JSONArray()
        players.put(JSONObject().put("id", "H").put("name", "HOST"))
        for (r in roster.values) players.put(JSONObject().put("id", r.id).put("name", r.name))
        val msg = JSONObject().put("t", "roster").put("players", players)
        for (c in conns.keys) sendJson(c, msg)
    }

    private fun broadcastExcept(sender: WebSocket?, obj: JSONObject) {
        for ((c, _) in conns) {
            if (c === sender) continue
            sendJson(c, obj)
        }
    }
}
