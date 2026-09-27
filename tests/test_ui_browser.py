#!/usr/bin/env python3
"""BLACKBOX TEST UI — Sambung Kata via headless browser (Playwright).
Menguji alur nyata pengguna: menu → permainan → jawab → gameover → kamusku → profil → kredit."""
import threading, functools, http.server, sys, time, json
from playwright.sync_api import sync_playwright

PORT = 8123
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

def open_page(p):
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_selector("#scr-menu.on", timeout=15000)
    return b, pg

def find_word(pg, prefix):
    """cari kata valid utk prefix lewat hook debug engine (masih blackbox UI: input via DOM)"""
    return pg.evaluate("""(p) => {
        const d = window.__DBG.dict;
        return d.randomWordPrefix(p, window.__DBG.G ? window.__DBG.G.room.used : new Set(), Math.random);
    }""", prefix)

def submit(pg, word):
    pg.fill("#word-input", word)
    pg.click("#btn-send")
    time.sleep(0.25)

def main():
    serve()
    with sync_playwright() as pw:
        b, pg = open_page(pw)
        page_errs = []
        pg.on("pageerror", lambda e: page_errs.append(str(e)))

        section("Menu utama")
        ok(pg.is_visible("#scr-menu.on"), "menu tampil setelah loading")
        ok(pg.locator("#menu-logo .tile").count() == 7, "logo SAMBUNG = 7 tile")
        ok(pg.locator("#bg .ft").count() >= 10, "tile latar mengambang dirender")
        ok("108344" in pg.inner_text("#load-text") or pg.inner_text("#load-text") == "", "info kamus")
        ok(pg.inner_text("#m-profil-name") == "guest", "profil default guest")
        ok(pg.inner_text("#menu-foot").find("zdn_gg") >= 0 if isinstance(pg.inner_text("#menu-foot"), str) else True, "kredit di menu")
        ok(pg.evaluate("window.__DBG.dict.words.length") == 108344, "kamus 108344 termuat di browser")

        section("Alur singleplayer easy vs bot")
        pg.click("#m-play"); time.sleep(0.2)
        ok(pg.is_visible("#scr-play.on"), "layar pilih cara main")
        pg.click("#p-sp"); time.sleep(0.2)
        ok(pg.is_visible("#scr-diff.on"), "layar pilih kesulitan")
        pg.click("[data-diff='easy']"); time.sleep(0.4)
        ok(pg.is_visible("#scr-game.on"), "layar game tampil")
        ok(pg.inner_text("#g-mode").startswith("EASY"), "label mode EASY")
        ok(pg.inner_text("#timer-num") in ("25", "24"), "timer easy 25 detik")
        ok(pg.locator("#players-strip .pcard").count() == 2, "2 kartu pemain (aku + bot)")
        prefix = pg.evaluate("window.__DBG.G.room.prefix")
        ok(len(prefix) == 1, "prefix easy 1 huruf: " + prefix)
        # aku menjawab benar
        w = find_word(pg, prefix)
        submit(pg, w)
        ok(pg.locator("#feed .fitem.ok").count() >= 1, "feed menampilkan jawaban ok")
        ok(pg.evaluate("window.__DBG.kamusPribadi['" + w + "']") is not None, "kata tersimpan di Kamusku")
        time.sleep(3.5)  # bot menjawab (delay 1.2-3.0s)
        ok(pg.locator("#feed .fitem.ok").count() >= 2, "bot juga menjawab di feed")
        ok(pg.evaluate("window.__DBG.G.room.byId['BOT'].lives") == 3, "bot tidak kehilangan nyawa")

        section("Validasi salah & penalti nyawa di UI")
        pf2 = pg.evaluate("window.__DBG.G.room.prefix")
        me_turn = pg.evaluate("window.__DBG.G.room.currentPlayer().id")
        if me_turn != "ME":  # pastikan giliran aku utk uji salah
            w2 = find_word(pg, pf2)
            submit(pg, w2); time.sleep(3.2)
            pf2 = pg.evaluate("window.__DBG.G.room.prefix")
        # 4x salah ditoleransi, ke-5 mengurangi nyawa
        for i in range(4):
            submit(pg, pf2 + "zzqx")
        lives_before = pg.evaluate("window.__DBG.G.room.byId['ME'].lives")
        ok(lives_before == 3, f"4x salah masih ditoleransi (nyawa={lives_before})")
        submit(pg, pf2 + "zzqx")
        lives_after = pg.evaluate("window.__DBG.G.room.byId['ME'].lives")
        wrong_after = pg.evaluate("window.__DBG.G.room.byId['ME'].wrong")
        ok(lives_after == 2 and wrong_after == 0, f"salah ke-5 → nyawa 3→2 & counter reset (lives={lives_after}, wrong={wrong_after})")

        section("Kamusku")
        pg.click("#g-exit"); time.sleep(0.2)
        pg.click("#cf-yes"); time.sleep(0.3)
        ok(pg.is_visible("#scr-menu.on"), "keluar permainan → menu")
        pg.click("#m-kamus"); time.sleep(0.3)
        total = int(pg.inner_text("#kamus-total"))
        ok(total >= 1, f"kamusku berisi {total} kata")
        ok("Gelar" in pg.inner_text("#kamus-title"), "gelar tampil")
        pg.fill("#kamus-search", "zzzqqq"); time.sleep(0.2)
        ok(pg.locator("#kamus-list .krow").count() == 0, "pencarian tak cocok = kosong")
        pg.fill("#kamus-search", ""); time.sleep(0.2)
        ok(pg.locator("#kamus-list .krow").count() >= 1, "pencarian kosong = semua")

        section("Profil")
        pg.locator(".screen.on .iconbtn[data-back]").first.click(); time.sleep(0.2)
        pg.click("#m-profil"); time.sleep(0.3)
        pg.fill("#name-input", "nama invalid!!")
        pg.click("#name-save"); time.sleep(0.2)
        ok(pg.inner_text("#m-profil-name") == "guest", "nama invalid ditolak")
        pg.fill("#name-input", "zdn_gg99")
        pg.click("#name-save"); time.sleep(0.2)
        ok(pg.inner_text("#m-profil-name") == "zdn_gg99", "nama valid tersimpan")
        ok(pg.inner_text("#pr-av").lower() == "z", "avatar = huruf pertama (uppercase via CSS)")

        section("Kredit & donasi")
        pg.locator(".screen.on .iconbtn[data-back]").first.click(); time.sleep(0.2)
        pg.click("#m-kredit"); time.sleep(0.3)
        ok("+6287802078095" in pg.inner_text("#gopay-num"), "nomor GoPay benar")
        ok("zdn_gg" in pg.content(), "kredit zdn_gg ada")

        section("Solo mode normal")
        pg.locator(".screen.on .iconbtn[data-back]").first.click(); time.sleep(0.2)
        pg.click("#m-play"); time.sleep(0.2)
        pg.click("#p-solo"); time.sleep(0.2)
        pg.click("[data-diff='normal']"); time.sleep(0.4)
        ok(pg.is_visible("#scr-game.on"), "solo normal jalan")
        ok(pg.inner_text("#timer-num") in ("15", "14"), "timer normal 15 detik")
        ok(pg.locator("#players-strip .pcard").count() == 1, "1 pemain (monolog)")
        pf = pg.evaluate("window.__DBG.G.room.prefix")
        ok(1 <= len(pf) <= 3, f"prefix normal 1-3 huruf ({pf})")
        w = find_word(pg, pf)
        submit(pg, w)
        ok(pg.locator("#feed .fitem.ok").count() >= 1, "jawaban solo ok")

        section("Hard mode — prefix pertama 1 huruf, timer 10s")
        pg.click("#g-exit"); pg.click("#cf-yes"); time.sleep(0.2)
        pg.click("#m-play"); pg.click("#p-solo")
        pg.click("[data-diff='hard']"); time.sleep(0.4)
        ok(pg.inner_text("#timer-num") in ("10", "9"), "timer hard 10 detik")
        pf = pg.evaluate("window.__DBG.G.room.prefix")
        ok(len(pf) == 1, "hard: prefix pertama 1 huruf")

        section("Gameover solo (habiskan nyawa via salah)")
        pf = pg.evaluate("window.__DBG.G.room.prefix")
        for i in range(15):
            if pg.is_visible("#scr-over.on"): break
            cur = pg.evaluate("window.__DBG.G && window.__DBG.G.room && window.__DBG.G.room.currentPlayer().id")
            if cur != "ME": break
            submit(pg, pf + "zzqx")
            if pg.is_visible("#scr-over.on"): break
            pf = pg.evaluate("window.__DBG.G.room.prefix")
        time.sleep(0.3)
        ok(pg.is_visible("#scr-over.on"), "layar gameover tampil")
        ok("TAMAT" in pg.inner_text("#over-title") or "Selesai" in pg.inner_text("#over-title"), "judul gameover")
        pg.click("#over-menu"); time.sleep(0.3)
        ok(pg.is_visible("#scr-menu.on"), "kembali ke menu")

        section("Stabilitas")
        ok(len(page_errs) == 0, f"tanpa pageerror ({page_errs[:2]})")

        b.close()
    print(f"\n■ UI BLACKBOX: {passed} lulus, {failed} gagal")
    if failed: print("\n".join(fails)); sys.exit(1)

if __name__ == "__main__":
    main()
