/* BLACKBOX TEST 2 — Noise engine mode normal & hard
 * Memverifikasi kurva kesulitan sesuai desain:
 *  normal: awal mayoritas 1-2 huruf → pertengahan mulai ada 3 → akhir mayoritas 2-3
 *  hard  : giliran pertama pasti 1 huruf → awal condong 3-5 → pertengahan/akhir
 *          mayoritas 3-6, 1 huruf jarang; fallback otomatis jika tak ada kandidat
 * Semua prefix HARUS: berasal dari sub-sekuens 3/6 huruf terakhir kata sebelumnya,
 * punya dukungan kamus, dan punya minimal 1 kata lanjutan yang belum dipakai.
 */
"use strict";
const { ok, eq, section, done, rng } = require("./harness.js");
require("../app/src/main/assets/kamus.js");
const Engine = require("../app/src/main/assets/engine.js");

const dict = new Engine.Dict(globalThis.KAMUS);

/* ---------- Mode normal ---------- */
section("Mode normal — kurva noise & validitas kandidat");
{
  const used = new Set();
  const eng = new Engine.PrefixEngine(dict, "normal", rng(42));
  // fase awal (giliran 0-4): mayoritas 1-2 huruf
  let counts = { 1: 0, 2: 0, 3: 0 };
  let prev = "mantap"; // kata awal utk menghasilkan kandidat
  for (let i = 0; i < 400; i++) {
    const r = eng.next(prev, 0, used);
    ok(r && r.prefix, "fase awal selalu punya kandidat");
    counts[r.prefix.length]++;
    if (!Engine.isSubseq(r.prefix, prev.slice(-3)))
      ok(false, `prefix '${r.prefix}' bukan sub-sekuens dari '${prev.slice(-3)}'`);
    ok(dict.countPrefix(r.prefix) >= 12, `prefix '${r.prefix}' punya dukungan kamus >= 12`);
  }
  const frac12 = (counts[1] + counts[2]) / 400;
  ok(frac12 > 0.85, `fase awal: 1-2 huruf dominan (${(frac12 * 100).toFixed(1)}%)`);
  ok(counts[3] === 0, "fase awal (giliran<5): tidak ada prefix 3 huruf");

  // fase pertengahan (giliran 6-15): mulai muncul 3 huruf — kata acak kamus
  counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 400; i++) {
    const w = dict.words[(dict.words.length * rng(1000 + i)()) | 0];
    const r = eng.next(w, 6 + (i % 9), used);
    counts[r.prefix.length]++;
  }
  ok(counts[3] > 60, `pertengahan: prefix 3 huruf mulai sering (${counts[3]}/400)`);
  ok(counts[1] > 40, `pertengahan: 1 huruf masih ada (${counts[1]}/400)`);

  // fase akhir (giliran 18+): mayoritas 2-3 — kata acak kamus
  counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 400; i++) {
    const w = dict.words[(dict.words.length * rng(2000 + i)()) | 0];
    const r = eng.next(w, 18 + (i % 20), used);
    counts[r.prefix.length]++;
  }
  const frac23 = (counts[2] + counts[3]) / 400;
  ok(frac23 > 0.75, `akhir: 2-3 huruf dominan (${(frac23 * 100).toFixed(1)}%)`);
}

/* ---------- Mode hard ---------- */
section("Mode hard — kurva noise & validitas kandidat");
{
  const used = new Set();
  const eng = new Engine.PrefixEngine(dict, "hard", rng(99));
  // giliran pertama PASTI 1 huruf
  for (let i = 0; i < 50; i++) {
    const r = eng.next(null, 0, used);
    ok(r.prefix.length === 1, "hard: prefix pertama pasti 1 huruf");
  }

  // fase awal (giliran 1-6): condong 3-5 huruf (noise tinggi utk >2 huruf)
  let counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const longWord = "strategi"; // 6 huruf terakhir: trategi
  for (let i = 0; i < 400; i++) {
    const r = eng.next(longWord, 1 + (i % 6), used);
    ok(r && r.prefix, "hard fase awal selalu punya kandidat");
    ok(r.prefix.length <= 6, "hard: prefix maksimal 6 huruf");
    counts[r.prefix.length]++;
    if (!Engine.isSubseq(r.prefix, longWord.slice(-6)))
      ok(false, `hard: prefix '${r.prefix}' bukan sub-sekuens '${longWord.slice(-6)}'`);
  }
  const fracHigh = counts[3] + counts[4] + counts[5] + counts[6];
  ok(fracHigh > 300, `hard awal: prefix 3-5+ huruf dominan (${fracHigh}/400)`);
  ok(counts[1] < 60, `hard awal: 1 huruf sudah jarang (${counts[1]}/400)`);

  // fase pertengahan/akhir (giliran 13+): mayoritas 3-6, 1 huruf sangat jarang
  counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (let i = 0; i < 400; i++) {
    const r = eng.next(longWord, 13 + (i % 25), used);
    counts[r.prefix.length]++;
  }
  const high2 = counts[3] + counts[4] + counts[5] + counts[6];
  ok(high2 > 320, `hard akhir: prefix 3-6 huruf dominan (${high2}/400)`);
  ok(counts[1] < 30, `hard akhir: 1 huruf sulit didapat (${counts[1]}/400)`);
}

/* ---------- Fallback otomatis hard (turun ke 1-2 huruf) ---------- */
section("Hard — fallback ketika 3-6 huruf tak tersedia");
{
  // Cari kata yang tail-nya TIDAK punya kandidat sehat utk panjang 3-6
  // (contoh nyata: 'tkr', 'omz') — sistem wajib turun ke 1-2 huruf.
  // Pemeriksaan deterministik via API publik (bukan lewat sampling engine).
  const eng = new Engine.PrefixEngine(dict, "hard", rng(5));
  const MIN = 6; // sama dgn cfg hard
  function hasLen(w, L) {
    const tail = w.slice(-6);
    for (const s of Engine.subsequences(tail))
      if (s.length === L && dict.countPrefix(s) >= MIN) return true;
    return false;
  }
  const deadTail = [];
  for (let i = 0; i < 60000 && deadTail.length < 30; i++) {
    const w = dict.words[(dict.words.length * rng(3100 + i)()) | 0];
    if (w.length < 6) continue;
    if (!hasLen(w, 3) && !hasLen(w, 4) && !hasLen(w, 5) && !hasLen(w, 6)) deadTail.push(w);
  }
  ok(deadTail.length >= 5, "ditemukan kata pemicu fallback (" + deadTail.length + ")");
  let fell = 0, total = 0;
  for (let t = 0; t < 300; t++) {
    const w = deadTail[t % deadTail.length];
    const r = eng.next(w, 13 + (t % 20), new Set());
    ok(r && r.prefix, "selalu ada kandidat (fallback turun panjang)");
    if (r && r.prefix.length <= 2) fell++;
    total++;
  }
  ok(fell === total, `fallback ke 1-2 huruf terjadi ${fell}/${total} kali`);
}

/* ---------- Aturan anchoring (revisi desainer) ---------- */
section("Anchoring — huruf suffix WAJIB ada di prefix, kontigu diprioritaskan");
{
  // 1) Setiap prefix normal/hard HARUS berakhir dengan huruf terakhir kata sebelumnya
  for (const mode of ["normal", "hard"]) {
    const eng = new Engine.PrefixEngine(dict, mode, rng(777));
    const used = new Set();
    const sampleWords = ["sandal", "bilang", "mantap", "strategi", "kata", "sambung",
      "nasional", "perpustakaan", "terminal", "program"];
    for (let i = 0; i < 300; i++) {
      const w = sampleWords[i % sampleWords.length];
      const r = eng.next(w, 3 + (i % 20), used);
      ok(r && r.prefix, `${mode}: kandidat ada utk '${w}'`);
      if (!r) continue;
      const suf = w.charAt(w.length - 1);
      ok(r.prefix.charAt(r.prefix.length - 1) === suf,
        `${mode}: prefix '${r.prefix}' berakhir dgn huruf suffix '${suf}' (dari '${w}')`);
      ok(Engine.isSubseq(r.prefix, w.slice(-(mode === "normal" ? 3 : 6))),
        `${mode}: prefix '${r.prefix}' masih sub-sekuens ekoran '${w}'`);
    }
  }

  // 2) Prioritas kontigu: bila blok akhiran kontigu sehat, engine harus
  //    mengembalikan PERSIS blok itu pada panjang yang sama.
  const eng2 = new Engine.PrefixEngine(dict, "normal", rng(888));
  const used2 = new Set();
  // "sandal" tail "DAL": L=2 kontigu "AL" (harus dukungan kamus besar), L=3 "DAL"
  ok(dict.countPrefix("al") >= 12 && dict.countPrefix("dal") >= 12,
    "prasarat: al & dal sehat di kamus");
  let hit2 = 0, hit3 = 0;
  for (let i = 0; i < 300; i++) {
    const r = eng2.next("sandal", 18 + (i % 20), used2); // fase akhir: 2-3 dominan
    if (!r) continue;
    if (r.prefix.length === 2) { eq(r.prefix, "al", "L=2 → kontigu 'al' (bukan 'dl')"); hit2++; }
    if (r.prefix.length === 3) { eq(r.prefix, "dal", "L=3 → kontigu 'dal'"); hit3++; }
  }
  ok(hit2 > 50 && hit3 > 20, `kontigu terverifikasi sering muncul (L2=${hit2}, L3=${hit3})`);

  // 3) Easy tetap: 1 huruf terakhir (suffix), x/q/f diganti huruf sebelumnya
  const eng3 = new Engine.PrefixEngine(dict, "easy", rng(999));
  eq(eng3.next("sandal", 5, new Set()).prefix, "l", "easy: sandal → 'l'");
  eq(eng3.next("tarif", 5, new Set()).prefix, "i", "easy: tarif → 'i' (f diganti)");
  eq(eng3.next("klaks", 5, new Set()).prefix, "s", "easy: klaks → 's' (s bukan banned)");
}

/* ---------- Anti-jalan-buntu: rantai panjang normal ---------- */
section("Simulasi rantai 300 langkah — tidak boleh macet");
{
  for (const mode of ["normal", "hard"]) {
    const eng = new Engine.PrefixEngine(dict, mode, rng(1234));
    const used = new Set();
    let word = null, prefix = null;
    let chain = 0;
    for (let t = 0; t < 300; t++) {
      let r = prefix
        ? eng.next(word, t, used)
        : eng.next(null, t, used);
      if (!r) break;
      prefix = r.prefix;
      // pilih kata lanjutan seperti pemain/bot
      const w = dict.randomWordPrefix(prefix, used, rng(t + 7));
      ok(w, `${mode}: ada kata utk prefix '${prefix}' di langkah ${t}`);
      if (!w) break;
      const v = Engine.validate(dict, eng, w, prefix, used);
      ok(v.ok, `${mode}: kata '${w}' valid utk prefix '${prefix}'`);
      if (!v.ok) break;
      used.add(v.word);
      word = v.word;
      chain++;
    }
    ok(chain >= 290, `${mode}: rantai 300 langkah menyambung tanpa macet (${chain})`);
  }
}

done("test_noise_normal_hard");
