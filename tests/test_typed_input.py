#!/usr/bin/env python3
"""BLACKBOX TEST — KOTAK HURUF KETIKAN (input jawaban baru).
Verifikasi permintaan desainer:
 1. Ketikan direkam sebagai kotak huruf di area kosong DI ATAS label
    "Giliranmu! Sambung dari X" (ngetik 'a' → kotak 'a' muncul).
 2. Menghapus huruf → kotaknya hilang.
 3. Kirim kata benar → kotak berubah HIJAU, lalu kosong untuk giliran baru.
 4. Kirim kata salah → kotak berubah MERAH (teks tetap agar bisa diperbaiki).
 5. Tombol kirim berada di atas (bersama kotak huruf) — tersentuh penuh
    bahkan saat keyboard terbuka (simulasi visualViewport menyusut).
 6. Tombol Enter keyboard juga mengirim.
 7. Tap area kotak = fokus input (keyboard muncul).
 8. Giliran baru mengosongkan kotak (placeholder menunggu/ketik).
 9. Mode easy & normal keduanya memakai kotak huruf yang sama.
"""
import threading, functools, http.server, sys, time
from playwright.sync_api import sync_playwright

PORT = 8129
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

def find_word(pg, prefix):
    return pg.evaluate("""(p) => {
        const d = window.__DBG.dict;
        return d.randomWordPrefix(p, window.__DBG.G ? window.__DBG.G.room.used : new Set(), Math.random);
    }""", prefix)

def boxes(pg):
    return pg.evaluate("""() => {
        const t = document.getElementById('typed-tiles');
        return { n: t.querySelectorAll('.tb').length,
                 letters: [...t.querySelectorAll('.tb')].map(b => b.textContent),
                 ok: t.classList.contains('ok'), bad: t.classList.contains('bad'),
                 typing: document.getElementById('typed-wrap').classList.contains('typing'),
                 ph: !!t.querySelector('.ph') };
    }""")

def main():
    serve()
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 390, "height": 844})
        pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        pg.wait_for_selector("#scr-menu.on", timeout=15000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        section("Kotak huruf — mode easy vs bot")
        pg.click("#m-play"); pg.click("#p-sp")
        pg.click("[data-diff='easy']")
        pg.wait_for_selector("#scr-game.on", timeout=8000)
        time.sleep(0.4)
        # struktur baru: kotak huruf di ATAS label giliran
        pos = pg.evaluate("""() => {
            const t = document.getElementById('typed-wrap').getBoundingClientRect();
            const l = document.getElementById('turn-label').getBoundingClientRect();
            return { typedAbove: t.bottom <= l.top + 1, gap: l.top - t.bottom };
        }""")
        ok(pos["typedAbove"], "kotak huruf berada di atas label 'Giliranmu!'")
        ok(boxes(pg)["ph"] and boxes(pg)["n"] == 0, "kosong di awal (placeholder)")

        # ngetik huruf demi huruf → kotak muncul satu per satu
        # (pemain pertama acak — bot bisa mulai lebih dulu)
        for _ in range(40):
            if pg.evaluate("window.__DBG.G.isMyTurn()"): break
            time.sleep(0.3)
        ok(pg.evaluate("window.__DBG.G.isMyTurn()"), "giliranmu tiba")
        ok(pg.evaluate("document.getElementById('word-input').disabled") is False, "input aktif di giliranmu")
        prefix = pg.evaluate("window.__DBG.G.room.prefix")
        w = find_word(pg, prefix)
        pg.focus("#word-input")
        for i, ch in enumerate(w[:3]):
            pg.keyboard.type(ch)
            time.sleep(0.08)
            bx = boxes(pg)
            ok(bx["n"] == i + 1, f"ngetik '{ch}' → kotak ke-{i+1} muncul")
            ok(bx["letters"][-1] == ch, f"kotak terakhir berisi '{ch}'")
        ok(boxes(pg)["typing"], "area kotak aktif (border highlight) saat mengetik")

        # hapus → kotak hilang
        pg.keyboard.press("Backspace")
        time.sleep(0.08)
        ok(boxes(pg)["n"] == 2, "Backspace → kotak terakhir hilang (3→2)")
        pg.keyboard.press("Backspace"); pg.keyboard.press("Backspace")
        time.sleep(0.08)
        ok(boxes(pg)["n"] == 0 and boxes(pg)["ph"], "hapus semua → kembali placeholder")

        # kirim kata BENAR → hijau, lalu kosong
        pg.fill("#word-input", w)
        ok(boxes(pg)["n"] == len(w), f"kata '{w}' → {len(w)} kotak huruf")
        pg.click("#btn-send")
        time.sleep(0.3)
        bx = boxes(pg)
        ok(bx["ok"] and not bx["bad"], "jawaban benar → kotak HIJAU")
        ok(bx["n"] == len(w), "kotak hijau masih menampilkan kata (tahanan 1s)")
        ok(pg.evaluate("document.getElementById('word-input').value") == "", "input dikosongkan setelah benar")
        ok(pg.locator("#feed .fitem.ok").count() >= 1, "feed mencatat kata benar")

        # tunggu bot menjawab → giliran baru → kotak kembali placeholder
        time.sleep(4.2)
        ok(boxes(pg)["n"] == 0 or boxes(pg)["ph"] or boxes(pg)["ok"] is False,
           "giliran baru: kotak kembali netral/placeholder")

        section("Kotak huruf — jawaban SALAH")
        # paksa giliran aku: bila giliran bot, tunggu
        for _ in range(30):
            if pg.evaluate("window.__DBG.G.isMyTurn()"): break
            time.sleep(0.3)
        ok(pg.evaluate("window.__DBG.G.isMyTurn()"), "giliranku lagi utk tes salah")
        pfx = pg.evaluate("window.__DBG.G.room.prefix")
        pg.fill("#word-input", "zzzzzz")  # tak ada di KBBI
        pg.click("#btn-send")
        time.sleep(0.3)
        bx = boxes(pg)
        ok(bx["bad"] and not bx["ok"], "jawaban salah → kotak MERAH")
        ok(pg.evaluate("document.getElementById('word-input').value") == "zzzzzz",
           "teks salah tetap di input (bisa diperbaiki)")
        ok(pg.locator("#feed .fitem.bad").count() >= 1, "feed mencatat penolakan")

        section("Keyboard & tombol kirim")
        # Enter mengirim
        for _ in range(30):
            if pg.evaluate("window.__DBG.G.isMyTurn()"): break
            time.sleep(0.3)
        pg.fill("#word-input", "")
        pfx2 = pg.evaluate("window.__DBG.G.room.prefix")
        w2 = find_word(pg, pfx2)
        pg.fill("#word-input", w2)
        pg.press("#word-input", "Enter")
        time.sleep(0.3)
        ok(pg.locator("#feed .fitem.ok").count() >= 2, "tombol Enter keyboard mengirim jawaban")

        # simulasi keyboard terbuka: visualViewport menyusut 45%
        pg.evaluate("""() => {
            const vv = window.visualViewport;
            Object.defineProperty(vv, 'height', { value: window.innerHeight * 0.55, configurable: true });
            window.__DBG.kbCheck();
        }""")
        ok(pg.evaluate("document.body.classList.contains('kb-open')"), "keyboard terbuka → mode rapat kb-open")
        hit = pg.evaluate("""() => {
            const b = document.getElementById('btn-send').getBoundingClientRect();
            const e = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
            const t = document.getElementById('typed-tiles').getBoundingClientRect();
            return { btnVisible: b.bottom <= window.innerHeight + 2 && e !== null &&
                               (e.id === 'btn-send' || (!!e.closest && !!e.closest('#btn-send'))),
                     tilesVisible: t.top >= 0, tilesAboveFold: t.bottom <= window.innerHeight + 2 };
        }""")
        ok(hit["btnVisible"], "keyboard terbuka: TOMBOL KIRIM tetap terlihat & tersentuh")
        ok(hit["tilesVisible"] and hit["tilesAboveFold"], "keyboard terbuka: kotak huruf tetap terlihat")
        pg.evaluate("""() => {
            Object.defineProperty(window.visualViewport, 'height',
              { value: window.innerHeight, configurable: true });
            window.__DBG.kbCheck();
        }""")
        ok(not pg.evaluate("document.body.classList.contains('kb-open')"), "keyboard tertutup → kb-open lepas")

        # tap area kotak = fokus input (input tersembunyi sengaja menutupi
        # area kotak — tap di sana langsung memunculkan keyboard)
        for _ in range(40):
            if pg.evaluate("window.__DBG.G.isMyTurn()"): break
            time.sleep(0.3)
        ok(pg.evaluate("window.__DBG.G.isMyTurn()"), "giliranmu tiba sebelum tap kotak")
        pg.click("#typed-tiles", force=True)
        time.sleep(0.1)
        ok(pg.evaluate("document.activeElement") is not None and
           pg.evaluate("document.activeElement.id") == "word-input",
           "tap area kotak huruf → input tersembunyi terfokus (keyboard muncul)")

        section("Kotak huruf — mode normal (prefix 1-3)")
        pg.click("#g-exit"); time.sleep(0.3); pg.click("#cf-yes"); time.sleep(0.4)
        pg.click("#m-play"); pg.click("#p-sp"); pg.click("[data-diff='normal']")
        pg.wait_for_selector("#scr-game.on", timeout=8000)
        time.sleep(0.4)
        for _ in range(40):
            if pg.evaluate("window.__DBG.G.isMyTurn()"): break
            time.sleep(0.3)
        pfx3 = pg.evaluate("window.__DBG.G.room.prefix")
        w3 = find_word(pg, pfx3)
        pg.fill("#word-input", w3)
        pg.click("#btn-send")
        time.sleep(0.3)
        ok(boxes(pg)["ok"], "normal: kotak hijau juga bekerja")

        ok(len(errs) == 0, "tidak ada pageerror sepanjang tes" + (f": {errs[:2]}" if errs else ""))
        b.close()

    print(f"\n■ TYPED-BOX BLACKBOX: {passed} lulus, {failed} gagal")
    if fails:
        print("Gagal:")
        for f in fails: print(" -", f)
        sys.exit(1)

if __name__ == "__main__":
    main()
