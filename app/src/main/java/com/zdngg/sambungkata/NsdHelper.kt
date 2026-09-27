package com.zdngg.sambungkata

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import org.json.JSONObject

/**
 * NsdHelper — penemuan room via mDNS/NSD.
 * Host mendaftarkan service tipe "_sambungkata._tcp." dengan nama "SK-<nama room>".
 * Client menemukan room di jaringan yang sama tanpa mengetik IP.
 */
class NsdHelper(
    private val context: Context,
    private val pushEvent: (JSONObject) -> Unit
) {
    companion object {
        const val TYPE = "_sambungkata._tcp."
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var regListener: NsdManager.RegistrationListener? = null
    private var discListener: NsdManager.DiscoveryListener? = null
    private var serviceName: String = "SK-room"

    /* NSD hanya mengizinkan SATU resolveService aktif pada satu waktu.
     * Memanggil resolve untuk tiap room sekaligus membuat resolve kedua dst
     * gagal (FAILURE_ALREADY_ACTIVE) — room tidak pernah muncul di daftar.
     * Solusi: antrean resolve yang diproses satu per satu. */
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private val seenServices = HashSet<String>()
    @Volatile private var resolving = false

    /** Daftarkan service; bila nama bentrok, coba ulang dengan angka acak. */
    fun register(port: Int, baseName: String) {
        unregister()
        serviceName = "SK-" + baseName.take(20).ifEmpty { "room" }
        tryRegister(port, 0)
    }

    private fun tryRegister(port: Int, attempt: Int) {
        val name = if (attempt == 0) serviceName else serviceName + "-" + (100..999).random()
        val info = NsdServiceInfo().apply {
            this.serviceName = name
            this.serviceType = TYPE
            this.port = port
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(nsdServiceInfo: NsdServiceInfo) {
                serviceName = nsdServiceInfo.serviceName ?: name
            }
            override fun onRegistrationFailed(nsdServiceInfo: NsdServiceInfo, errorCode: Int) {
                if (attempt < 3) tryRegister(port, attempt + 1)
            }
            override fun onServiceUnregistered(nsdServiceInfo: NsdServiceInfo) {}
            override fun onUnregistrationFailed(nsdServiceInfo: NsdServiceInfo, errorCode: Int) {}
        }
        regListener = listener
        try {
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            if (attempt < 3) tryRegister(port, attempt + 1)
        }
    }

    fun unregister() {
        val l = regListener ?: return
        regListener = null
        try { nsdManager.unregisterService(l) } catch (e: Exception) {}
    }

    fun discover() {
        stopDiscovery()
        synchronized(resolveQueue) { resolveQueue.clear(); seenServices.clear() }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType?.startsWith("_sambungkata") != true) return
                val key = serviceInfo.serviceName ?: return
                synchronized(resolveQueue) {
                    if (!seenServices.add(key)) return // dedupe nama service
                    resolveQueue.add(serviceInfo)
                }
                pumpResolve()
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        discListener = listener
        try {
            nsdManager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {}
    }

    /** Proses antrean resolve satu per satu (NSD = 1 resolve aktif). */
    private fun pumpResolve() {
        synchronized(resolveQueue) {
            if (resolving) return
            val next = resolveQueue.removeFirstOrNull() ?: return
            resolving = true
            try {
                nsdManager.resolveService(next, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        synchronized(resolveQueue) { resolving = false }
                        pumpResolve()
                    }
                    @Suppress("DEPRECATION")
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        synchronized(resolveQueue) { resolving = false }
                        val ip = try { info.host?.hostAddress ?: "" } catch (e: Exception) { "" }
                        if (ip.isNotEmpty()) {
                            pushEvent(JSONObject()
                                .put("k", "room_found")
                                .put("name", info.serviceName ?: "")
                                .put("ip", ip)
                                .put("port", info.port))
                        }
                        pumpResolve()
                    }
                })
            } catch (e: Exception) {
                resolving = false
                pumpResolve()
            }
        }
    }

    fun stopDiscovery() {
        synchronized(resolveQueue) { resolveQueue.clear() }
        val l = discListener ?: return
        discListener = null
        try { nsdManager.stopServiceDiscovery(l) } catch (e: Exception) {}
    }
}
