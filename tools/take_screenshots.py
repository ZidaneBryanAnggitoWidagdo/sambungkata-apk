#!/usr/bin/env python3
"""Ambil screenshot UI nyata untuk README (simpan ke docs/img/)."""
import threading, http.server, time, os
from playwright.sync_api import sync_playwright

PORT = 8127
ROOT = "/home/z/my-project/sambungkata-apk/app/src/main/assets"
OUT = "/home/z/my-project/sambungkata-apk/docs/img"
os.makedirs(OUT, exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 412, "height": 915}, device_scale_factor=2)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_selector("#scr-menu.on", timeout=15000)
    time.sleep(0.8)
    pg.screenshot(path=f"{OUT}/menu.png")

    pg.click("#m-play"); time.sleep(0.4)
    pg.screenshot(path=f"{OUT}/mode.png")
    pg.click("#p-online"); time.sleep(0.4)
    pg.screenshot(path=f"{OUT}/online.png")
    pg.evaluate("document.querySelector('#scr-online [data-back]').click()"); time.sleep(0.4)

    # game hard vs bot — mainkan beberapa giliran agar feed terisi
    pg.click("#p-sp")
    pg.click('[data-diff="hard"]')
    pg.wait_for_selector("#scr-game.on", timeout=8000)
    time.sleep(0.5)
    for _ in range(4):
        state = pg.evaluate("""() => {
            const G = window.__DBG.G;
            if (!G) return null;
            const mine = G.isMyTurn();
            return { mine, prefix: G.room.prefix };
        }""")
        if state and state["mine"]:
            word = pg.evaluate("""(p) => window.__DBG.dict.randomWordPrefix(p, window.__DBG.G.room.used, Math.random)""", state["prefix"])
            if word:
                pg.fill("#word-input", word)
                if _ == 3:
                    # tangkap kotak huruf terisi (fitur baru) sebelum kirim
                    time.sleep(0.3)
                    pg.screenshot(path=f"{OUT}/game.png")
                pg.click("#btn-send")
                time.sleep(0.5)
                if _ == 3:
                    # kotak huruf hijau (jawaban benar)
                    pg.screenshot(path=f"{OUT}/game-green.png")
        else:
            time.sleep(0.8)
    pg.click("#g-exit"); time.sleep(0.3); pg.click("#cf-yes"); time.sleep(0.5)

    # kamusku: isi dengan beberapa kata biar tidak kosong
    pg.evaluate("""() => { window.__DBG.saveWord("sambung"); window.__DBG.saveWord("kata"); window.__DBG.saveWord("buku"); window.__DBG.saveWord("kata"); }""")
    pg.click("#m-kamus"); time.sleep(0.5)
    pg.screenshot(path=f"{OUT}/kamusku.png")
    pg.evaluate("document.querySelector('#scr-kamus [data-back]').click()"); time.sleep(0.4)

    pg.click("#m-profil"); time.sleep(0.4)
    pg.screenshot(path=f"{OUT}/profil.png")
    b.close()
print("screenshots saved to", OUT)
