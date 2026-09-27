#!/usr/bin/env python3
"""BLACKBOX TEST RESPONSIVITAS — Sambung Kata di berbagai ukuran layar.
Matriks viewport hp/tablet nyata: cek overflow horizontal, elemen keluar layar,
tumpang-tindih (menu-foot vs tombol, prefix vs timer), dan elemen kunci terlihat."""
import threading, functools, http.server, time, sys
from playwright.sync_api import sync_playwright

PORT = 8125
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

# JS di browser: kembalikan daftar elemen yang keluar dari viewport horizontal
JS_OVERFLOW = """() => {
  const vw = window.innerWidth;
  const bad = [];
  const skipSel = "#bg, #players-strip, .roomlist, #chat-box, #chat-box2, #chat-box3, #kamus-list, #title-ladder";
  document.querySelectorAll(".screen.on *").forEach(el => {
    if (el.closest(skipSel)) return;
    if (el.namespaceURI && el.namespaceURI.includes("svg")) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 2 || r.left < -2) {
      const label = el.id || (typeof el.className === "string" ? el.className : el.tagName);
      bad.push(String(label).slice(0, 30));
    }
  });
  return { vw, bad: bad.slice(0, 8) };
}"""

JS_OVERLAP = """(sel) => {
  const [a, b] = sel;
  const A = document.querySelector(a), B = document.querySelector(b);
  if (!A || !B) return null;
  const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
  const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
  const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
  return (ix > 2 && iy > 2);
}"""

def check_common(pg, tag, screen):
    r = pg.evaluate(JS_OVERFLOW)
    ok(len(r["bad"]) == 0, f"[{tag}] {screen}: elemen keluar layar {r['bad']} (vw={r['vw']})")

def back(pg):
    """kembali pakai tombol back dalam aplikasi (bukan history browser)"""
    pg.evaluate("""() => {
        const scr = document.querySelector('.screen.on');
        const b = scr && scr.querySelector('[data-back]');
        if (b) b.click();
    }""")
    time.sleep(0.35)

def run_viewport(p, w, h):
    tag = f"{w}x{h}"
    print(f"── viewport {tag}")
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_selector("#scr-menu.on", timeout=15000)
    time.sleep(0.3)

    section(f"menu {tag}")
    check_common(pg, tag, "menu")
    btns = pg.evaluate("""() => {
        const vw = window.innerWidth;
        return [...document.querySelectorAll('#menu-btns .btn')].map(b => {
            const r = b.getBoundingClientRect();
            return r.width <= vw && r.left >= 0;
        });
    }""")
    ok(all(btns) and len(btns) == 4, f"[{tag}] 4 tombol menu muat penuh")
    if h <= 700:
        # layar pendek: foot tidak menumpuk tombol
        ov = pg.evaluate(JS_OVERLAP, ["#menu-foot", "#menu-btns"])
        ok(ov is False, f"[{tag}] menu-foot tidak menumpuk tombol")
    # semua tombol dapat diklik (tidak tertutup elemen lain)
    clickable = pg.evaluate("""() => {
        const ids = ['m-play','m-kamus','m-profil','m-kredit'];
        return ids.map(id => {
            const el = document.getElementById(id);
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
            return el === top || el.contains(top);
        });
    }""")
    ok(all(clickable), f"[{tag}] semua tombol menu tersentuh penuh (tidak tertutup)")

    section(f"game hard {tag} (6 tile prefix — kasus terburuk)")
    pg.click("#m-play"); pg.click("#p-sp")
    pg.click('[data-diff="hard"]')
    pg.wait_for_selector("#scr-game.on", timeout=8000)
    time.sleep(0.4)
    check_common(pg, tag, "game-hard")
    ok(pg.evaluate(JS_OVERLAP, ["#prefix-wrap", "#input-row"]) is False,
       f"[{tag}] prefix/timer tidak menumpuk input")
    ok(pg.evaluate(JS_OVERLAP, ["#prefix-tiles", "#timer-wrap"]) is False,
       f"[{tag}] tile prefix tidak menumpuk timer")
    input_box = pg.evaluate("""() => {
        const r = document.getElementById('input-row').getBoundingClientRect();
        return { bottom: r.bottom, vh: window.innerHeight, w: r.width, vw: window.innerWidth };
    }""")
    ok(input_box["bottom"] <= input_box["vh"] + 2, f"[{tag}] input jawaban terlihat di dalam layar")
    ok(input_box["w"] <= input_box["vw"], f"[{tag}] input tidak melebihi lebar layar")
    # strip pemain dapat di-scroll (13 pemain pun tetap usable)
    pg.evaluate("""() => {
        const strip = document.getElementById('players-strip');
        strip.innerHTML = '';
        for (let i = 0; i < 13; i++) {
            const c = document.createElement('div');
            c.className = 'pcard';
            c.innerHTML = '<div class="av">P</div><div><div class="pn">Pemain' + i + '</div><div class="lives"></div></div>';
            strip.appendChild(c);
        }
    }""")
    strip_scroll = pg.evaluate("""() => document.getElementById('players-strip').scrollWidth >= document.getElementById('players-strip').clientWidth""")
    ok(strip_scroll, f"[{tag}] strip 13 pemain bisa digulir")
    pg.click("#g-exit"); time.sleep(0.3); pg.click("#cf-yes"); time.sleep(0.4)

    section(f"game easy {tag}")
    pg.click("#m-play"); pg.click("#p-sp")
    pg.click('[data-diff="easy"]')
    pg.wait_for_selector("#scr-game.on", timeout=8000)
    time.sleep(0.3)
    check_common(pg, tag, "game-easy")
    pg.click("#g-exit"); time.sleep(0.3); pg.click("#cf-yes"); time.sleep(0.4)

    section(f"layar lain {tag}")
    pg.click("#m-kamus"); time.sleep(0.2); check_common(pg, tag, "kamusku"); back(pg)
    pg.click("#m-profil"); time.sleep(0.2); check_common(pg, tag, "profil")
    ok(pg.is_visible("#name-input"), f"[{tag}] input nama terlihat")
    back(pg)
    pg.click("#m-kredit"); time.sleep(0.2); check_common(pg, tag, "kredit")
    num = pg.evaluate("document.getElementById('gopay-num').getBoundingClientRect().width")
    ok(num < w, f"[{tag}] nomor GoPay muat")
    back(pg)
    pg.click("#m-play"); pg.click("#p-online"); time.sleep(0.2)
    check_common(pg, tag, "online-lobi")
    pg.click("#on-join"); time.sleep(0.3); check_common(pg, tag, "join-wifi")
    pinw = pg.evaluate("document.getElementById('join-pin').getBoundingClientRect().width")
    ok(pinw <= w - 4, f"[{tag}] input PIN muat")
    b.close()

def main():
    serve()
    with sync_playwright() as pw:
        for (w, h) in [(320, 480), (320, 568), (360, 640), (360, 740),
                       (375, 667), (412, 915), (412, 732), (480, 854),
                       (600, 977), (768, 1024)]:
            run_viewport(pw, w, h)
    print(f"\n■ RESPONSIVE BLACKBOX: {passed} lulus, {failed} gagal")
    if fails:
        print("Gagal:")
        for f in fails: print(" -", f)
        sys.exit(1)

if __name__ == "__main__":
    main()
