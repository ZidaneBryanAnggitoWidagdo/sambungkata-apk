#!/usr/bin/env python3
"""E2E ONLINE MULTIPLAYER — 2 halaman browser (HOST + CLIENT) via relay protokol.
Menguji jalur yang paling kritis (pernah FATAL):
  1. Host buat room WiFi -> PIN -> client join (PIN salah dulu, lalu benar)
  2. Host mulai game -> client otomatis pindah ke layar GAME
  3. Client & host menjawab bergantian lewat UI (btn-send) -> relay -> feed
  4. Jawaban salah -> feed 'bad' + counter
  5. Host akhiri game (g-exit) -> client lihat layar over -> kembali ke room
  6. Host kick client + alasan -> client melihat overlay DIKELUARKAN
Relay Python mencerminkan semantik GameServer.kt / mock_relay.js."""
import json, sys, time, threading, functools, http.server
from playwright.sync_api import sync_playwright

PORT = 8131
ROOT = "/home/z/my-project/sambungkata-apk/app/src/main/assets"
WSPIN = "482913"

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

STUB = """
window.__BRIDGE_LOG = [];
window.__LOG = function(m, a){ window.__BRIDGE_LOG.push([m, a === undefined ? null : a]); };
window.AndroidBridge = {
  getVersion: function(){ return "1.1.1-stub"; },
  startServer: function(pin, name){ window.__LOG("startServer", pin);
    setTimeout(function(){ window.__onBridgeEvent({k:"server_started", ip:"192.168.1.10", port:8787}); }, 15); },
  stopServer: function(){ window.__LOG("stopServer"); },
  discoverRooms: function(){ window.__LOG("discoverRooms"); },
  getMyIp: function(){ return "192.168.1.10"; },
  wsConnect: function(url){ window.__LOG("wsConnect", url);
    setTimeout(function(){ window.__onBridgeEvent({k:"ws_open"}); }, 15); },
  wsSend: function(m){ window.__LOG("wsSend", m); },
  wsClose: function(){ window.__LOG("wsClose"); },
  copyText: function(){}, vibrate: function(){}, exitApp: function(){},
  btSupported: function(){ return true; },
  btEnsurePermissions: function(){ window.__onBridgeEvent({k:"bt_perms", granted:true}); },
  btEnabled: function(){ return true; },
  btEnable: function(){}, btStartHost: function(){}, btStopHost: function(){},
  btMakeDiscoverable: function(){}, btStartScan: function(){}, btStopScan: function(){},
  btConnect: function(){}, btDisconnect: function(){}, btSend: function(){}
};
"""

class Conn:
    def __init__(self, page, ip):
        self.page = page; self.ip = ip; self.id = None
        self.name = "anon"; self.joined = False; self.closed = False

class Relay:
    """Cermin semantik GameServer.kt (cukup untuk jalur yang dites)."""
    def __init__(self):
        self.conns = []          # semua conn (host console + client)
        self.roster = {}         # id -> conn
        self.pin = WSPIN
        self.kicked = {}         # id -> reason

    def drain(self, page, tag):
        try:
            rows = page.evaluate("window.__BRIDGE_LOG.splice(0)")
        except Exception:
            return
        for m, a in rows:
            if m == "wsConnect":
                ip = "127.0.0.1" if tag == "H" else "10.0.0.2"
                c = Conn(page, ip)
                self.conns.append(c)
                self.to_one(c, {"t": "hello", "id": "H" if ip == "127.0.0.1" else "pending"})
            elif m == "wsSend":
                try: msg = json.loads(a)
                except Exception: continue
                self.on_message(self.find(page), msg)
            elif m == "wsClose":
                c = self.find(page)
                if c: self.disconnect(c)

    def find(self, page):
        for c in self.conns:
            if c.page is page and not c.closed: return c
        return None

    def to_one(self, c, obj):
        if c.closed: return
        try:
            c.page.evaluate("function(ev){ window.__onBridgeEvent(ev); }",
                            {"k": "ws_msg", "data": json.dumps(obj)})
        except Exception:
            pass

    def to_host(self, obj):
        for c in self.conns:
            if c.ip == "127.0.0.1" and not c.closed: self.to_one(c, obj)

    def players_json(self):
        ps = [{"id": "H", "name": "HOST"}]
        for cid, c in self.roster.items(): ps.append({"id": cid, "name": c.name})
        return ps

    def broadcast_roster(self):
        m = {"t": "roster", "players": self.players_json()}
        for c in self.conns:
            if not c.closed: self.to_one(c, m)

    def disconnect(self, c):
        if c in self.conns: self.conns.remove(c)
        c.closed = True
        if self.roster.pop(c.id, None) is not None:
            self.broadcast_roster()
            self.to_host({"t": "left", "id": c.id})

    def on_message(self, c, msg):
        if c is None: return
        t = msg.get("t")
        if t == "join":
            if msg.get("pin") != self.pin:
                self.to_one(c, {"t": "join_rejected", "reason": "pin"}); return
            c.id = "c" + str(len(self.roster) + 1)
            c.name = str(msg.get("name", "anon"))[:15] or "anon"
            c.joined = True
            self.roster[c.id] = c
            self.to_one(c, {"t": "joined_ok", "id": c.id, "players": self.players_json()})
            self.broadcast_roster()
            self.to_host({"t": "joined", "id": c.id, "name": c.name, "ip": c.ip})
        elif t == "gmsg":
            d = msg.get("d") or {}
            if c.ip == "127.0.0.1":
                for x in self.conns:
                    if x is not c and not x.closed:
                        self.to_one(x, {"t": "gmsg", "from": "H", "name": "HOST", "d": d})
            elif c.joined:
                for x in self.conns:
                    if x is not c and not x.closed:
                        self.to_one(x, {"t": "gmsg", "from": c.id, "name": c.name, "d": d})
        elif t == "chat":
            text = str(msg.get("text", ""))[:300]
            if not text: return
            frm = "H" if c.ip == "127.0.0.1" else c.id
            nm = "HOST" if c.ip == "127.0.0.1" else c.name
            for x in self.conns:
                if x is not c and not x.closed:
                    self.to_one(x, {"t": "chat", "from": frm, "name": nm, "text": text})
        elif t == "srv_kick":
            target = msg.get("id"); reason = str(msg.get("reason", ""))[:200] or "dikeluarkan host"
            victim = self.roster.get(target)
            if victim:
                self.to_one(victim, {"t": "kicked", "reason": reason, "wait": 30})
                self.roster.pop(target, None)
                self.broadcast_roster()
                self.to_host({"t": "left", "id": target})
                self.disconnect(victim)
                self.kicked[target] = reason

def wait_js(page, expr, timeout=8.0, poll=0.05):
    dl = time.time() + timeout
    while time.time() < dl:
        try:
            v = page.evaluate("() => " + expr)
            if v: return v
        except Exception:
            pass
        time.sleep(poll)
    return None

def pump(relay, pages, seconds):
    dl = time.time() + seconds
    while time.time() < dl:
        relay.drain(pages["H"], "H")
        relay.drain(pages["C"], "C")
        time.sleep(0.02)

def pick_word(host_page):
    return host_page.evaluate(
        "() => { const r = __DBG.Host.room; return __DBG.dict.words.find(w => w.startsWith(r.prefix) && !r.used.has(w)); }")

def whose_turn(host_page):
    r = host_page.evaluate(
        "() => { const r = __DBG.Host.room; return (r && r.running && !r.over) ? r.currentPlayer().id : null; }")
    return r

def submit(page, word):
    page.eval_on_selector("#word-input", "function(el, w){ el.value = w; }", word)
    page.click("#btn-send")

def feed_words(page):
    return page.eval_on_selector_all("#feed .fw", "els => els.map(e => e.textContent)")

def main():
    serve()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx_args = dict(viewport={"width": 390, "height": 780})
        H = browser.new_page(**ctx_args)
        C = browser.new_page(**ctx_args)
        for p in (H, C): p.add_init_script(STUB)
        H.goto(f"http://127.0.0.1:{PORT}/index.html")
        C.goto(f"http://127.0.0.1:{PORT}/index.html")
        wait_js(H, "document.getElementById('scr-menu').classList.contains('on')")
        wait_js(C, "document.getElementById('scr-menu').classList.contains('on')")
        relay = Relay()
        pages = {"H": H, "C": C}

        section("Host buat room WiFi")
        H.click("#m-play"); H.click("#p-online"); H.click("#on-create")
        pump(relay, pages, 1.0)
        ok(wait_js(H, "document.getElementById('scr-host').classList.contains('on')"), "host di layar room")
        ok(wait_js(H, "/^\\d{6}$/.test(document.getElementById('pin-display').textContent)"), "PIN 6 digit tampil di host")
        ok(H.evaluate("() => /^\\d{6}$/.test(__DBG.Host.pin)"), "startServer dipanggil (PIN host terisi)")

        section("Client join — PIN salah dulu")
        C.click("#m-play"); C.click("#p-online"); C.click("#on-join")
        C.fill("#join-ip", "192.168.1.10"); C.fill("#join-pin", "000000")
        C.click("#join-btn"); pump(relay, pages, 0.8)
        ok(wait_js(C, "document.getElementById('toast').textContent.includes('PIN salah')"), "PIN salah ditolak")
        C.fill("#join-pin", WSPIN); C.click("#join-btn"); pump(relay, pages, 1.0)
        ok(wait_js(C, "document.getElementById('scr-client').classList.contains('on')"), "client masuk room")
        ok(wait_js(C, "document.querySelectorAll('#room-players2 .rprow').length") == 2, "roster client 2 baris")
        ok(wait_js(H, "document.querySelectorAll('#room-players .rprow').length") == 2, "roster host 2 baris")
        ok(wait_js(H, "!document.getElementById('host-start').disabled"), "tombol mulai aktif")

        section("Host mulai game -> client pindah ke layar game (bug fatal lama)")
        H.click("#host-start")
        pump(relay, pages, 1.2)
        ok(wait_js(C, "document.getElementById('scr-game').classList.contains('on')"),
           "CLIENT otomatis di layar game")
        ok(wait_js(H, "document.getElementById('scr-game').classList.contains('on')"), "host di layar game")
        ok(wait_js(C, "document.querySelectorAll('#prefix-tiles .tile').length") > 0, "prefix tampil di client")
        mode_h = H.evaluate("() => __DBG.Host.room.mode")
        ok(mode_h == "normal", "mode host = normal")

        section("Bermain bergantian — host & client menjawab lewat UI")
        answered = {"H": 0, "C": 0}
        turns_done = set()
        for i in range(40):
            pump(relay, pages, 0.12)
            tid = H.evaluate("() => __DBG.Host.room ? (__DBG.Host.room.turnIdx + ':' + __DBG.Host.room.currentPlayer().id) : null")
            if tid is None: break
            if tid in turns_done: continue
            turnidx, pid = tid.split(":")
            w = pick_word(H)
            if w is None: break
            slot = "H" if pid == "H" else "C"
            page = H if pid == "H" else C
            submit(page, w)
            turns_done.add(tid)
            answered[slot] += 1
            pump(relay, pages, 0.25)
            if answered["H"] + answered["C"] >= 6: break
        pump(relay, pages, 0.6)
        ok(answered["C"] >= 2, f"client sempat menjawab >=2 kali (dapat {answered['C']})")
        ok(answered["H"] >= 1, f"host sempat menjawab >=1 kali (dapat {answered['H']})")
        used_n = H.evaluate("() => __DBG.Host.room.used.size")
        ok(used_n >= 6, f"kata terpakai >= 6 (dapat {used_n})")
        cw = feed_words(C)
        ok(len(cw) >= 4, f"feed client berisi jawaban ({len(cw)} baris)")

        section("Jawaban salah dihitung & disiarkan")
        bad_seen = wait_js(C, "!!document.querySelector('#feed .bad')") or \
                   any("—" in x for x in feed_words(C))
        # client sengaja jawab salah bila gilirannya; kalau tidak, pakai host
        for _ in range(30):
            pump(relay, pages, 0.12)
            pid = whose_turn(H)
            if pid is None: break
            submit(H if pid == "H" else C, "qqqqzz")
            pump(relay, pages, 0.4)
            if C.evaluate("() => !!document.querySelector('#feed .bad')"): break
        ok(C.evaluate("() => !!document.querySelector('#feed .bad')"), "feed client menampilkan baris salah")

        section("Host akhiri permainan (g-exit) -> client ke layar over")
        H.click("#g-exit")
        wait_js(H, "document.getElementById('cf-yes')") and H.click("#cf-yes")
        pump(relay, pages, 1.0)
        ok(wait_js(C, "document.getElementById('scr-over').classList.contains('on')"), "client lihat layar over")
        ok(wait_js(H, "document.getElementById('scr-host').classList.contains('on')"), "host kembali ke room")
        ok(wait_js(H, "!document.getElementById('host-start').disabled"), "host bisa mulai lagi")
        C.click("#over-again"); pump(relay, pages, 0.4)
        ok(wait_js(C, "document.getElementById('scr-client').classList.contains('on')"), "client kembali ke room")

        section("Kick + alasan -> overlay DIKELUARKAN di client")
        H.click("#room-players .iconbtn[data-kick]")
        wait_js(H, "document.getElementById('kk-yes')")
        H.fill("#kick-reason", "mengganggu pemain lain")
        H.click("#kk-yes")
        pump(relay, pages, 1.0)
        ov = wait_js(C, "document.getElementById('overlay').classList.contains('on')")
        ok(ov, "overlay kick tampil di client")
        txt = C.evaluate("() => document.getElementById('overlay-card').textContent") if ov else ""
        ok("DIKELUARKAN" in txt, "teks DIKELUARKAN")
        ok("mengganggu pemain lain" in txt, "alasan kick terlihat")

        browser.close()

    print(f"\n■ E2E ONLINE: {passed} lulus, {failed} gagal")
    if fails:
        print("Gagal:"); [print("  -", f) for f in fails]; sys.exit(1)

if __name__ == "__main__":
    main()
