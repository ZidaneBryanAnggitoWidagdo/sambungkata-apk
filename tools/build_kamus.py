#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_kamus.py — Generate assets/kamus.js dari hasil scraping kamus sambung kata.

Format keluaran (keputusan final utk arsitektur game JS di WebView):
  window.KAMUS_VER  : metadata kecil
  window.KAMUS      : SATU string berisi semua kata terurut asc, dipisah '\n'

Alasan format ini (vs SQLite/JSON/shard):
  - Logika game 100% JS: mesin prefix (noise) melakukan 50-300 query prefix/giliran.
    Sorted array + binary search di memori = O(log n) ~ mikrodetik per query.
  - Parse split('\n') 108rb kata < 300ms di WebView Android modern; JSON.parse array
    2-3x lebih lambat & memakan memori transient lebih besar.
  - Tanpa jembatan JS<->Kotlin per query (jika SQLite) = tidak ada overhead asinkron.
  - Ukuran asset ~1 MB, RAM runtime ~12-15 MB — wajar untuk game.

Pemakaian:
  python3 tools/build_kamus.py <sumber.json> <out_dir_assets>
"""
import json
import re
import sys
import os
import time

VALID = re.compile(r"^[a-z]+$")

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/data/all_words_sorted_unique.json"
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "assets")

    with open(src, "r", encoding="utf-8") as f:
        words = json.load(f)

    # Sanitasi defensif: hanya a-z, panjang >= 2, unik, terurut.
    seen = set()
    clean = []
    for w in words:
        w = w.strip().lower()
        if len(w) < 2 or not VALID.match(w):
            continue
        if w in seen:
            continue
        seen.add(w)
        clean.append(w)
    clean.sort()

    # Escape: newline literal tidak valid di string JS -> tulis sebagai \n dua-karakter
    payload = "\\n".join(clean)
    js = (
        "/* kamus.js — dihasilkan otomatis oleh tools/build_kamus.py. JANGAN edit manual. */\n"
        "var KAMUS_VER={n:%d,build:'%s'};\n" % (len(clean), time.strftime("%Y-%m-%d"))
        + 'var KAMUS="%s";\n' % payload
        + 'if(typeof window!=="undefined"){window.KAMUS_VER=KAMUS_VER;window.KAMUS=KAMUS;}\n'
        + 'else if(typeof globalThis!=="undefined"){globalThis.KAMUS_VER=KAMUS_VER;globalThis.KAMUS=KAMUS;}\n'
    )

    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, "kamus.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(js)

    # Statistik untuk verifikasi
    from collections import Counter
    first = Counter(w[0] for w in clean)
    last = Counter(w[-1] for w in clean)
    banned_end = sum(last.get(c, 0) for c in "xqf")
    print("kata    : %d" % len(clean))
    print("ukuran  : %.2f MB" % (os.path.getsize(out) / 1048576))
    print("huruf awal terbanyak:", first.most_common(3))
    print("kata berujung x/q/f :", banned_end, "(penting utk rule mode easy)")

if __name__ == "__main__":
    main()
