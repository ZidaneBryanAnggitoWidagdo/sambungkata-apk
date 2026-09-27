package com.zdngg.sambungkata

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URI

/**
 * MainActivity — seluruh layar adalah WebView fullscreen yang memuat
 * satu paket web (assets/index.html + kamus.js + engine.js + app.js).
 * Logika game 100% JavaScript; Kotlin menyediakan:
 *  - server WebSocket mode online (GameServer)
 *  - penemuan room via NSD (NsdHelper)
 *  - klien WebSocket untuk konsol host & client (Java-WebSocket)
 *  - jembatan event ke JS lewat window.__onBridgeEvent(...)
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var server: GameServer? = null
    private var nsd: NsdHelper? = null
    private var wsClient: org.java_websocket.client.WebSocketClient? = null
    private var bt: BtManager? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersive()

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }
        webView.setBackgroundColor(0xFF0D1120.toInt())
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")
        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            700 -> pushEvent(JSONObject()
                .put("k", "bt_enable_result").put("ok", resultCode > 0))
            701 -> pushEvent(JSONObject()
                .put("k", "bt_discoverable_result").put("ok", resultCode > 0)
                .put("seconds", resultCode))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 702) {
            var all = grantResults.isNotEmpty()
            for (r in grantResults) if (r != android.content.pm.PackageManager.PERMISSION_GRANTED) all = false
            pushEvent(JSONObject().put("k", "bt_perms").put("granted", all))
        }
    }

    private fun btMgr(): BtManager {
        if (bt == null) bt = BtManager(applicationContext) { ev -> pushEvent(ev) }
        return bt!!
    }

    private fun applyImmersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        webView.evaluateJavascript(
            "window.__onAndroidBack ? window.__onAndroidBack() : 'exit'"
        ) { result ->
            if (result != null && result.contains("exit")) finish()
        }
    }

    // ---------- event ke JS ----------

    /** Kirim event ke JS — aman dipanggil dari thread mana pun. */
    private fun pushEvent(obj: JSONObject) {
        runOnUiThread {
            try {
                webView.evaluateJavascript(
                    "window.__onBridgeEvent && window.__onBridgeEvent(" + obj.toString() + ")", null
                )
            } catch (e: Exception) {}
        }
    }

    private fun localIp(): String {
        return try {
            val en = NetworkInterface.getNetworkInterfaces()
            while (en.hasMoreElements()) {
                val ni = en.nextElement()
                val addrs = ni.inetAddresses
                while (addrs.hasMoreElements()) {
                    val a = addrs.nextElement()
                    if (!a.isLoopbackAddress && a is Inet4Address && a.isSiteLocalAddress) {
                        return a.hostAddress ?: ""
                    }
                }
            }
            ""
        } catch (e: Exception) { "" }
    }

    // ---------- jembatan JS ----------

    inner class Bridge {

        @JavascriptInterface
        fun getVersion(): String = "1.0.0"

        @JavascriptInterface
        fun startServer(pin: String, roomName: String) {
            runOnUiThread {
                if (server != null) {
                    pushEvent(JSONObject()
                        .put("k", "server_started")
                        .put("ip", localIp())
                        .put("port", GameServer.PORT))
                    return@runOnUiThread
                }
                try {
                    val cleanPin = pin.filter { it.isDigit() }.take(6).padEnd(6, '0')
                    val srv = GameServer(cleanPin) { ev -> pushEvent(ev) }
                    server = srv
                    srv.start()
                    if (nsd == null) nsd = NsdHelper(applicationContext) { ev -> pushEvent(ev) }
                    nsd?.register(GameServer.PORT, roomName)
                    pushEvent(JSONObject()
                        .put("k", "server_started")
                        .put("ip", localIp())
                        .put("port", GameServer.PORT))
                } catch (e: Exception) {
                    server = null
                    pushEvent(JSONObject().put("k", "server_error").put("err", e.message ?: "gagal mulai"))
                }
            }
        }

        @JavascriptInterface
        fun stopServer() {
            runOnUiThread {
                nsd?.unregister()
                val srv = server ?: return@runOnUiThread
                server = null
                Thread {
                    try { srv.stop(100) } catch (e: Exception) {}
                }.start()
            }
        }

        @JavascriptInterface
        fun discoverRooms() {
            runOnUiThread {
                if (nsd == null) nsd = NsdHelper(applicationContext) { ev -> pushEvent(ev) }
                nsd?.discover()
            }
        }

        @JavascriptInterface
        fun stopDiscovery() {
            runOnUiThread { nsd?.stopDiscovery() }
        }

        @JavascriptInterface
        fun getMyIp(): String = localIp()

        @JavascriptInterface
        fun wsConnect(url: String) {
            runOnUiThread {
                closeWs()
                try {
                    val client = object : org.java_websocket.client.WebSocketClient(URI(url)) {
                        override fun onOpen(handshakedata: org.java_websocket.handshake.ServerHandshake) {
                            pushEvent(JSONObject().put("k", "ws_open"))
                        }
                        override fun onMessage(message: String) {
                            pushEvent(JSONObject().put("k", "ws_msg").put("data", message))
                        }
                        override fun onClose(code: Int, reason: String, remote: Boolean) {
                            pushEvent(JSONObject().put("k", "ws_close").put("code", code))
                        }
                        override fun onError(ex: Exception) { /* onClose menyusul */ }
                    }
                    client.connectionLostTimeout = 30
                    wsClient = client
                    client.connect()
                } catch (e: Exception) {
                    pushEvent(JSONObject().put("k", "ws_close").put("err", e.message ?: "gagal"))
                }
            }
        }

        @JavascriptInterface
        fun wsSend(message: String) {
            val c = wsClient ?: return
            try { c.send(message) } catch (e: Exception) {}
        }

        @JavascriptInterface
        fun wsClose() {
            runOnUiThread { closeWs() }
        }

        @JavascriptInterface
        fun copyText(text: String) {
            runOnUiThread {
                val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cb.setPrimaryClip(ClipData.newPlainText("sambungkata", text))
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Long) {
            try {
                val v = getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms.coerceIn(10, 500), android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION") v.vibrate(ms.coerceIn(10, 500))
                }
            } catch (e: Exception) {}
        }

        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        // ---------------- Bluetooth ----------------

        @JavascriptInterface
        fun btSupported(): Boolean {
            val mgr = getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
            return mgr?.adapter != null
        }

        /** Push event {k:"bt_perms", granted} setelah izin selesai diminta. */
        @JavascriptInterface
        fun btEnsurePermissions() {
            runOnUiThread {
                val needed = ArrayList<String>()
                if (android.os.Build.VERSION.SDK_INT >= 31) {
                    if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        needed.add(android.Manifest.permission.BLUETOOTH_CONNECT)
                    if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        needed.add(android.Manifest.permission.BLUETOOTH_SCAN)
                } else {
                    if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        needed.add(android.Manifest.permission.ACCESS_FINE_LOCATION)
                }
                if (needed.isEmpty()) {
                    pushEvent(JSONObject().put("k", "bt_perms").put("granted", true))
                } else {
                    requestPermissions(needed.toTypedArray(), 702)
                }
            }
        }

        @JavascriptInterface
        fun btEnabled(): Boolean = try {
            (getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter?.isEnabled == true
        } catch (e: Exception) { false }

        @JavascriptInterface
        fun btEnable() {
            runOnUiThread {
                try {
                    startActivityForResult(Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_ENABLE), 700)
                } catch (e: Exception) {
                    pushEvent(JSONObject().put("k", "bt_enable_result").put("ok", false))
                }
            }
        }

        @JavascriptInterface
        fun btStartHost(pin: String, roomName: String) {
            val p = pin.filter { it.isDigit() }.take(6).padEnd(6, '0')
            Thread { btMgr().startHost(p, roomName) }.start()
        }

        @JavascriptInterface
        fun btStopHost() {
            Thread { bt?.stopHost() }.start()
        }

        @JavascriptInterface
        fun btMakeDiscoverable() {
            runOnUiThread {
                try {
                    val i = Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
                    i.putExtra(android.bluetooth.BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300)
                    startActivityForResult(i, 701)
                } catch (e: Exception) {
                    pushEvent(JSONObject().put("k", "bt_discoverable_result").put("ok", false))
                }
            }
        }

        @JavascriptInterface
        fun btStartScan() { Thread { btMgr().startScan() }.start() }

        @JavascriptInterface
        fun btStopScan() { Thread { bt?.stopScan() }.start() }

        @JavascriptInterface
        fun btConnect(addr: String) { Thread { btMgr().connect(addr) }.start() }

        @JavascriptInterface
        fun btDisconnect() { Thread { bt?.disconnectClient() }.start() }

        @JavascriptInterface
        fun btSend(message: String) { bt?.onJsSend(message) }
    }

    private fun closeWs() {
        val c = wsClient ?: return
        wsClient = null
        try { c.close() } catch (e: Exception) {}
    }

    override fun onDestroy() {
        nsd?.unregister()
        nsd?.stopDiscovery()
        val srv = server
        server = null
        if (srv != null) {
            Thread { try { srv.stop(100) } catch (e: Exception) {} }.start()
        }
        closeWs()
        bt?.cleanup()
        webView.destroy()
        super.onDestroy()
    }
}
