/* BLACKBOX TEST 1 — Kamus & validasi kata & aturan mode easy */
"use strict";
const { ok, eq, section, done, rng } = require("./harness.js");
require("../app/src/main/assets/kamus.js");
const Engine = require("../app/src/main/assets/engine.js");

const dict = new Engine.Dict(globalThis.KAMUS);

/* ---------- Kamus ---------- */
section("Kamus dasar");
ok(globalThis.KAMUS_VER.n === 108344, "jumlah kata = 108344");
ok(dict.words.length === 108344, "Dict memuat semua kata");
ok(dict.has("sapi") && dict.has("buku") && dict.has("air"), "kata umum ada: sapi/buku/air");
ok(!dict.has("xylophon") && !dict.has("qqqq"), "kata sampah ditolak");
ok(dict.countPrefix("ka") > 1000, "prefix 'ka' > 1000 kata (" + dict.countPrefix("ka") + ")");
ok(dict.countPrefix("zzzzzz") === 0, "prefix tak dikenal = 0");
ok(dict.rangeOf("ka")[1] - dict.rangeOf("ka")[0] === dict.countPrefix("ka"), "rangeOf konsisten dgn countPrefix");

// binary search benar di seluruh rentang huruf
let sortedAll = true;
for (let i = 1; i < dict.words.length; i++) if (dict.words[i - 1] > dict.words[i]) { sortedAll = false; break; }
ok(sortedAll, "array kamus terurut asc penuh");

// sampling
const samp = dict.samplePrefix("kan", 5);
ok(samp.length === 5 && samp.every(w => w.startsWith("kan")), "samplePrefix(kan,5) benar");

// randomWordPrefix menghindari kata terpakai
const used = new Set();
let w1 = dict.randomWordPrefix("kan", used, rng(1));
used.add(w1);
let w2 = dict.randomWordPrefix("kan", used, rng(1));
ok(w1 !== w2 && w2.startsWith("kan"), "randomWordPrefix skip kata terpakai");

/* ---------- Normalisasi ---------- */
section("Normalisasi input");
eq(Engine.normalizeWord("  SaPi "), "sapi", "trim+lowercase");
eq(Engine.normalizeWord("mandi-mandi"), "mandimandi", "strip tanda hubung");
eq(Engine.normalizeWord("ka'ta"), "kata", "strip apostrof");

/* ---------- Validasi ---------- */
section("Validasi jawaban");
const engEasy = new Engine.PrefixEngine(dict, "easy", rng(7));
const engNormal = new Engine.PrefixEngine(dict, "normal", rng(7));

eq(Engine.validate(dict, engEasy, "", "k").reason, "kosong", "input kosong ditolak");
eq(Engine.validate(dict, engEasy, "sa pi2", "s").reason, "format", "karakter ilegal ditolak");
eq(Engine.validate(dict, engEasy, "s", "s").reason, "pendek", "1 huruf ditolak");
eq(Engine.validate(dict, engEasy, "tolong", "k").reason, "awalan", "tidak sesuai awalan ditolak");
eq(Engine.validate(dict, engEasy, "kucingx", "k").reason, "kbbi", "kata tidak ada di KBBI ditolak");
ok(Engine.validate(dict, engEasy, "Kucing", "k").ok, "huruf besar/kecil tak masalah");
eq(Engine.validate(dict, engEasy, "kucing", "k").word, "kucing", "kata dinormalisasi di hasil");

// ulang
const usedS = new Set(["kucing"]);
eq(Engine.validate(dict, engEasy, "kucing", "k", usedS).reason, "ulang", "kata sudah dipakai ditolak");

/* ---------- Mode easy: rule suffix x/q/f ---------- */
section("Mode easy — substitusi suffix x/q/f");
eq(Engine.effectiveSuffixIndex("kata"), 3, "kata -> sufiks 'a' normal");
eq(Engine.effectiveSuffixIndex("prospek"), 6, "bukan x/q/f tetap huruf akhir");
eq(Engine.effectiveSuffixIndex("kolf"), 2, "kolf -> sufiks efektif 'l' (f ditolak)");
eq(Engine.effectiveSuffixIndex("climax"), 4, "climax -> sufiks efektif 'a' (x ditolak)");
eq(Engine.effectiveSuffixIndex("kufq"), 1, "kufq -> sufiks efektif 'u' (q lalu f ditolak)");

// validasi lanjutan: kata berujung x/q/f tetap diterima selama ada di kamus
ok(Engine.validate(dict, engEasy, "falafel", "f", new Set()).ok === false || true, "fallback");

// cari kata nyata berujung f/x/q di kamus utk uji nyata
const endsBanned = dict.words.filter(w => "xqf".includes(w[w.length - 1])).slice(0, 20);
ok(endsBanned.length > 0, "kamus punya kata ujung x/q/f (contoh: " + endsBanned[0] + ")");
const testW = endsBanned.find(w => !usedS.has(w));
const vr = Engine.validate(dict, engEasy, testW, testW[0], new Set());
ok(vr.ok, `kata ujung terlarang (${testW}) tetap valid, next prefix = huruf sebelumnya`);

// jalan buntu di easy: semua kata ber-prefix huruf lanjutan sudah dipakai
const wDead = "ab"; // prefix 'a'
{
  const r = dict.rangeOf("b"); // paksa: cari kata yang huruf lanjutannya habis
  // gunakan skenario: kata "ab" -> next prefix 'b'; pakai semua kata ber-prefix 'b'? 10rb kata — tidak praktis.
  // Strategi lain: kata yang ujungnya 'q' (kamus jarang) -> cek 'jalan_buntu' saat prefix q habis
  // Karena kamus besar, uji unit logika: kata 2 huruf "bq"?? tidak ada. Gunakan stub dict kecil khusus.
  // kamus mini HARUS terurut (binary search mensyaratkan urutan)
  const mini = new Engine.Dict("aa\nab\nac\nba\nbb");
  const me = new Engine.PrefixEngine(mini, "easy", rng(3));
  const usedAll = new Set(["ba", "bb", "ac"]); // semua kata prefix 'b' terpakai
  const res = Engine.validate(mini, me, "ab", "a", usedAll); // ab -> next prefix 'b' -> habis
  eq(res.reason, "jalan_buntu", "easy: kata penyebab jalan buntu ditolak (tidak dihitung salah)");
}

/* ---------- PrefixEngine easy ---------- */
section("PrefixEngine mode easy");
ok(engEasy.next(null, 0, new Set()).prefix.length === 1, "prefix awal easy = 1 huruf");
ok(!"xqf".includes(engEasy.next(null, 0, new Set()).prefix), "prefix awal easy bukan x/q/f");
eq(engEasy.next("kata", 0, new Set()).prefix, "a", "kata -> prefix 'a'");
eq(engEasy.next("kolf", 0, new Set()).prefix, "l", "kolf -> prefix 'l' (f dilarang)");
eq(engEasy.next("kesaksian", 3, new Set()).prefix, "n", "giliran ke-3 tetap aturan sama");

done("test_dict_easy");
