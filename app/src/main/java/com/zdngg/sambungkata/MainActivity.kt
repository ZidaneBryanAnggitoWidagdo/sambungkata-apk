package com.zdngg.sambungkata

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
        webView.destroy()
        super.onDestroy()
    }
}
