#!/usr/bin/env python3
"""BLACKBOX TEST BLUETOOTH + WIFI FLOW — stub AndroidBridge di headless browser.
Menguji alur nyata JS: pilih kanal, izin BT, scan perangkat, host/join room,
roster, kick+alasan, chat, dan join WiFi manual — tanpa perangkat fisik."""
import threading, functools, http.server, json, sys, time
from playwright.sync_api import sync_playwright

PORT = 8126
ROOT = "/home/z/my-project/sambungkata-apk/app/src/main/assets"

passed, failed, fails = 0, 0, []
def ok(cond, msg):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1; fails.append(msg); print(f"  ✗ FAIL: {msg}")
def section(n): print("▶", n)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)
    def log_message(self, *a): pass

def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

# Stub AndroidBridge — dipasang SEBELUM script halaman berjalan.
# Merekam semua pemanggilan ke __BRIDGE_LOG; pushEvent lewat __onBridgeEvent.
STUB = """
window.__BRIDGE_LOG = [];
window.__LOGPUSH = function(m, a) { window.__BRIDGE_LOG.push([m, a === undefined ? null : a]); };
window.__BT_PUSH = function(ev) { window.__onBridgeEvent && window.__onBridgeEvent(ev); };
window.__SERVER_WS = null;   // simulasi koneksi ws konsol host / client
window.AndroidBridge = {
  getVersion: function(){ return "1.1.0-stub"; },
  startServer: function(pin, name){
    window.__LOGPUSH("startServer", pin);
    setTimeout(function(){
      window.__onBridgeEvent({k:"server_started", ip:"192.168.43.1", port:8787});
      window.__onBridgeEvent({k:"ws_open"});
    }, 30);
  },
  stopServer: function(){ window.__LOGPUSH("stopServer", null); },
  discoverRooms: function(){ window.__LOGPUSH("discoverRooms", null); },
  wsConnect: function(url){ window.__LOGPUSH("wsConnect", url); },
  wsSend: function(msg){ window.__LOGPUSH("wsSend", msg); },
  wsClose: function(){ window.__LOGPUSH("wsClose", null); },
  copyText: function(t){ window.__LOGPUSH("copyText", t); },
  vibrate: function(ms){ window.__LOGPUSH("vibrate", ms); },
  exitApp: function(){},
  btSupported: function(){ return true; },
  btEnsurePermissions: function(){
    window.__LOGPUSH("btEnsurePermissions", null);
    setTimeout(function(){ window.__onBridgeEvent({k:"bt_perms", granted:true}); }, 30);
  },
  btEnabled: function(){ return true; },
  btEnable: function(){ window.__LOGPUSH("btEnable", null);
    setTimeout(function(){ window.__onBridgeEvent({k:"bt_enable_result", ok:true}); }, 20); },
  btStartHost: function(pin, name){
    window.__LOGPUSH("btStartHost", pin);
    setTimeout(function(){
      window.__onBridgeEvent({k:"bt_server_started", pin:pin, deviceName:"HostAnda"});
      window.__onBridgeEvent({k:"bt_msg", data: JSON.stringify({t:"hello", id:"H"})});
    }, 30);
  },
  btStopHost: function(){ window.__LOGPUSH("btStopHost", null); },
  btMakeDiscoverable: function(){ window.__LOGPUSH("btMakeDiscoverable", null); },
  btStartScan: function(){
    window.__LOGPUSH("btStartScan", null);
    setTimeout(function(){
      window.__onBridgeEvent({k:"bt_device", name:"HostAnda", addr:"AA:BB:CC:DD:EE:01"});
      window.__onBridgeEvent({k:"bt_device", name:"HP Lain", addr:"AA:BB:CC:DD:EE:02"});
      window.__onBridgeEvent({k:"bt_scan_done"});
    }, 40);
  },
  btStopScan: function(){ window.__LOGPUSH("btStopScan", null); },
  btConnect: function(addr){
    window.__LOGPUSH("btConnect", addr);
    setTimeout(function(){
      window.__onBridgeEvent({k:"bt_open", addr:addr});
    }, 40);
  },
  btDisconnect: function(){ window.__LOGPUSH("btDisconnect", null); },
  btSend: function(msg){ window.__LOGPUSH("btSend", msg); }
};
true;
"""

def open_page(p):
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 412, "height": 915})
    pg.add_init_script(STUB)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_selector("#scr-menu.on", timeout=15000)
    return b, pg

def calls(pg, method):
    return pg.evaluate("(m) => window.__BRIDGE_LOG.filter(x => x[0] === m).map(x => x[1])", method)

def main():
    serve()
    with sync_playwright() as pw:
        page_errs = []

        section("Lobi online — pilih kanal")
        b, pg = open_page(pw)
        pg.on("pageerror", lambda e: page_errs.append(str(e)))
        pg.click("#m-play"); pg.click("#p-online")
        pg.wait_for_selector("#scr-online.on", timeout=5000)
        ok(pg.inner_text("#host-chan") == "WIFI" or pg.is_hidden("#scr-host"), "sanity lobi")
        pg.click('#online-chan [data-ch="bt"]')
        time.sleep(0.2)
        ok("Bluetooth" in pg.inner_text("#online-hint"), "hint berubah saat kanal BT dipilih")
        pg.click('#online-chan [data-ch="wifi"]')
        time.sleep(0.2)
        ok("WiFi atau hotspot" in pg.inner_text("#online-hint"), "hint kembali saat kanal WiFi")

        section("Host room via Bluetooth")
        pg.click('#online-chan [data-ch="bt"]')
        pg.click("#on-create")
        time.sleep(0.5)
        ok(len(calls(pg, "btEnsurePermissions")) == 1, "izin BT diminta dulu")
        ok(len(calls(pg, "btStartHost")) == 1 and calls(pg, "btStartHost")[0].isdigit()
           and len(calls(pg, "btStartHost")[0]) == 6, "btStartHost dengan PIN 6 digit")
        pg.wait_for_selector("#scr-host.on", timeout=5000)
        ok(pg.inner_text("#host-chan") == "BLUETOOTH", "badge kanal = BLUETOOTH")
        ok("HostAnda" in pg.inner_text("#host-ip"), "nama perangkat host tampil")
        pin = pg.inner_text("#pin-display")
        ok(len(pin) == 6 and pin.isdigit(), f"PIN tampil 6 digit ({pin})")
        ok(pg.is_visible("#bt-visible"), "tombol discoverable tampil di mode BT")
        pg.click("#bt-visible"); time.sleep(0.2)
        ok(len(calls(pg, "btMakeDiscoverable")) == 1, "tombol discoverable memanggil bridge")

        section("Konsol host BT — roster, chat, kick+alasan")
        # client bergabung lewat hub (event bt_msg dari Kotlin)
        pg.evaluate("""() => {
            window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"conn", id:"c1", mac:"AA:BB:CC:DD:EE:01"})});
            window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"joined", id:"c1", name:"Budi", mac:"AA:BB:CC:DD:EE:01"})});
            window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"roster", players:[{id:"H",name:"guest"},{id:"c1",name:"Budi"}]})});
        }""")
        time.sleep(0.3)
        rows = pg.locator("#room-players .rprow").count()
        ok(rows == 2, f"roster 2 pemain tampil ({rows})")
        ok("Budi" in pg.inner_text("#room-players"), "nama client tampil")
        ok(pg.inner_text("#host-count") == "2", "hitung pemain = 2")
        # chat masuk
        pg.evaluate("""() => window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"chat", from:"c1", name:"Budi", text:"halo host!"})})""")
        time.sleep(0.2)
        ok("halo host!" in pg.inner_text("#chat-box"), "chat client tampil")
        # kick dengan alasan wajib
        pg.click("[data-kick='c1']")
        time.sleep(0.3)
        ok(pg.is_visible("#modal-root.on"), "modal kick muncul")
        pg.fill("#kick-reason", "spam terus")
        pg.click("#kk-yes")
        time.sleep(0.3)
        kicks = pg.evaluate("""() => window.__BRIDGE_LOG.filter(x => x[0]==='btSend').map(x => JSON.parse(x[1])).filter(m => m.t==='srv_kick')""")
        ok(len(kicks) == 1 and kicks[0]["id"] == "c1" and kicks[0]["reason"] == "spam terus",
           "srv_kick terkirim via btSend dengan alasan")
        # host pilih mode & tombol mulai aktif setelah ada pemain (roster di-set ulang)
        pg.evaluate("""() => window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"roster", players:[{id:"H",name:"guest"},{id:"c1",name:"Budi"}]})})""")
        time.sleep(0.2)
        ok(pg.is_enabled("#host-start"), "tombol mulai aktif saat ada pemain")
        b.close()

        section("Client gabung via Bluetooth (scan → sambung → join)")
        b, pg = open_page(pw)
        pg.on("pageerror", lambda e: page_errs.append(str(e)))
        pg.click("#m-play"); pg.click("#p-online")
        pg.click('#online-chan [data-ch="bt"]')
        pg.click("#on-join")
        pg.wait_for_selector("#scr-join.on", timeout=5000)
        time.sleep(0.4)
        ok(len(calls(pg, "btEnsurePermissions")) == 1, "izin BT diminta")
        ok(len(calls(pg, "btStartScan")) == 1, "scan BT dimulai otomatis")
        ok(pg.is_visible("#join-bt-pane"), "pane BT tampil")
        ok(pg.is_hidden("#join-wifi-pane"), "pane WiFi disembunyikan")
        ok(pg.locator("#bt-devices .roomrow").count() == 2, "2 perangkat hasil scan tampil")
        ok("HostAnda" in pg.inner_text("#bt-devices"), "nama perangkat host di daftar")
        # PIN wajib dulu
        pg.click("[data-addr='AA:BB:CC:DD:EE:01']")
        time.sleep(0.3)
        ok(len(calls(pg, "btConnect")) == 0, "tanpa PIN, koneksi tidak dimulai")
        pg.fill("#join-pin", "123456")
        pg.click("[data-addr='AA:BB:CC:DD:EE:01']")
        time.sleep(0.4)
        ok(calls(pg, "btConnect") == ["AA:BB:CC:DD:EE:01"], "btConnect ke MAC host")
        # host menerima: joined_ok
        pg.evaluate("""() => window.__BT_PUSH({k:"bt_msg", data: JSON.stringify({t:"joined_ok", id:"c1", players:[{id:"H",name:"HostAnda"},{id:"c1",name:"guest"}]})})""")
        pg.wait_for_selector("#scr-client.on", timeout=5000)
        ok(pg.inner_text("#client-pin") == "123456", "PIN room tampil di client")
        ok(pg.locator("#room-players2 .rprow").count() == 2, "roster client tampil")
        joinmsgs = pg.evaluate("""() => window.__BRIDGE_LOG.filter(x => x[0]==='btSend').map(x => JSON.parse(x[1])).filter(m => m.t==='join')""")
        ok(len(joinmsgs) == 1 and joinmsgs[0]["pin"] == "123456" and joinmsgs[0]["name"] == "guest",
           "pesan join berisi PIN + nama")
        b.close()

        section("Join WiFi manual masih bekerja (regresi)")
        b, pg = open_page(pw)
        pg.on("pageerror", lambda e: page_errs.append(str(e)))
        pg.click("#m-play"); pg.click("#p-online")
        pg.click("#on-join")
        pg.wait_for_selector("#scr-join.on", timeout=5000)
        time.sleep(0.2)
        ok(pg.is_visible("#join-wifi-pane"), "pane WiFi tampil")
        ok(pg.is_hidden("#join-bt-pane"), "pane BT disembunyikan")
        pg.fill("#join-ip", "192.168.1.55")
        pg.fill("#join-pin", "654321")
        pg.click("#join-btn")
        time.sleep(0.4)
        urls = calls(pg, "wsConnect")
        ok(urls == ["ws://192.168.1.55:8787"], f"wsConnect ke host benar ({urls})")
        # host menerima via ws
        pg.evaluate("""() => window.__onBridgeEvent({k:"ws_msg", data: JSON.stringify({t:"joined_ok", id:"c2", players:[{id:"H",name:"HostAnda"},{id:"c2",name:"guest"}]})})""")
        pg.wait_for_selector("#scr-client.on", timeout=5000)
        ok(pg.inner_text("#client-pin") == "654321", "client room tampil (jalur WiFi)")
        b.close()

        section("Stabilitas")
        ok(not page_errs, f"tanpa pageerror ({page_errs[:3]})")

    print(f"\n■ BT/WIFI FLOW BLACKBOX: {passed} lulus, {failed} gagal")
    if fails:
        print("Gagal:")
        for f in fails: print(" -", f)
        sys.exit(1)

if __name__ == "__main__":
    main()
