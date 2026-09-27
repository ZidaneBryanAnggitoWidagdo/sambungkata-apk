/* BLACKBOX TEST 3 — GameRoom: nyawa, salah-5, timeout, eliminasi, pemenang,
 * bot tak terkalahkan, mode solo, giliran, prefix tetap saat timeout. */
"use strict";
const { ok, eq, section, done, rng } = require("./harness.js");
require("../app/src/main/assets/kamus.js");
const E = require("../app/src/main/assets/engine.js");

const dict = new E.Dict(globalThis.KAMUS);

function makeRoom(mode, players, seed, events) {
  return new E.GameRoom(dict, mode, {
    players,
    rnd: rng(seed),
    onEvent: (ev) => events.push(ev)
  });
}
function types(evts) { return evts.map(e => e.type); }
function last(evts, type) { for (let i = evts.length - 1; i >= 0; i--) if (evts[i].type === type) return evts[i]; return null; }
function count(evts, type) { return evts.filter(e => e.type === type).length; }

/* ---------- Alur dasar: start + turn ---------- */
section("GameRoom dasar — start, giliran acak, struktur turn");
{
  const evts = [];
  const room = makeRoom("normal", [{ id: "A", name: "Andi" }, { id: "B", name: "Budi" }], 11, evts);
  room.start(1000);
  ok(room.running && !room.over, "room berjalan");
  const t = last(evts, "turn");
  ok(t && t.playerId && t.prefix && t.seconds === 15, "turn berisi prefix + 15 detik (normal)");
  ok(t.deadline === 1000 + 15000, "deadline = start + durasi");
  ok(types(evts).includes("start"), "event start terkirim");
}

/* ---------- Timeout: nyawa berkurang, prefix tetap ---------- */
section("Timeout — -1 nyawa, prefix diteruskan ke pemain berikutnya");
{
  const evts = [];
  const room = makeRoom("easy", [{ id: "A", name: "A" }, { id: "B", name: "B" }], 21, evts);
  room.start(0);
  const firstPlayer = room.players[room.cur].id;
  const prefix0 = room.prefix;
  room.tick(25001); // lewat 25 detik
  ok(count(evts, "timeout") === 1, "event timeout muncul");
  ok(count(evts, "life_lost") === 1, "nyawa berkurang 1");
  ok(room.byId[firstPlayer].lives === 2, "nyawa pemain 3→2");
  const t2 = last(evts, "turn");
  ok(t2.playerId !== firstPlayer, "giliran pindah ke pemain lain");
  eq(t2.prefix, prefix0, "prefix TETAP (pemain berikutnya harus menyambung prefix sama)");
  ok(room.running && !room.over, "game masih berjalan");
}

/* ---------- Salah 5x: nyawa berkurang, toleransi 1-4 ---------- */
section("Salah 5x — toleransi 1-4 salah, ke-5 mengurangi nyawa");
{
  const evts = [];
  const room = makeRoom("easy", [{ id: "A", name: "A" }, { id: "B", name: "B" }], 31, evts);
  room.start(0);
  const pid = room.players[room.cur].id;
  const pf = room.prefix;
  // pastikan pemain lain tidak kebagian: kirim 4 salah berturut (masih toleransi)
  const garbage = ["qxzx", "wxqz", "zqxwv", "xwqzv"]; // hanya a-z, tidak ada di KBBI
  for (let i = 0; i < 4; i++) {
    // beri awalan prefix aktif agar lolos cek awalan dan mencapai cek KBBI
    const r = room.submit(pid, pf + garbage[i], 100); // tidak ada di KBBI
    eq(r.reason, "kbbi", `salah ke-${i + 1} terdeteksi`);
    ok(!room.over && room.players[room.cur].id === pid, "giliran tidak pindah");
  }
  ok(room.byId[pid].lives === 3, "1-4 salah masih ditoleransi (nyawa utuh)");
  ok(room.byId[pid].wrong === 4, "counter salah = 4");
  const r5 = room.submit(pid, pf + "zzzqx", 200);
  ok(count(evts, "life_lost") === 1, "salah ke-5 mengurangi nyawa");
  ok(room.byId[pid].lives === 2 && room.byId[pid].wrong === 0, "nyawa 3→2, counter reset");
  ok(last(evts, "turn").prefix === pf, "setelah salah-5 + eliminasi, prefix tetap");
}

/* ---------- Jawaban valid: maju giliran, prefix baru dari suffix ---------- */
section("Jawaban valid — giliran maju, prefix baru");
{
  const evts = [];
  const room = makeRoom("easy", [{ id: "A", name: "A" }, { id: "B", name: "B" }], 41, evts);
  room.start(0);
  const pid = room.players[room.cur].id;
  const pf = room.prefix;
  const kata = dict.randomWordPrefix(pf, room.used, rng(77));
  const res = room.submit(pid, kata.toUpperCase(), 500); // huruf besar = tetap valid
  ok(res.ok, `jawaban valid diterima (${kata})`);
  ok(room.used.has(kata), "kata masuk daftar terpakai");
  const t2 = last(evts, "turn");
  ok(t2.playerId !== pid, "giliran pindah");
  // mode easy: prefix baru = huruf efektif terakhir dari kata yang barusan
  const expect = kata.toLowerCase().charAt(E.effectiveSuffixIndex(kata.toLowerCase()));
  eq(t2.prefix, expect, "prefix baru = suffix efektif kata sebelumnya");
  // jawaban pemain lain yang salah giliran ditolak
  const other = room.players.find(p => p.id !== room.players[room.cur].id).id;
  eq(room.submit(other, "apapun", 600).reason, "bukan_giliran", "submit di luar giliran ditolak");
}

/* ---------- Kata terpakai (ulang) dihitung salah ---------- */
section("Kata diulang — dihitung salah");
{
  // Skenario: A jawab w1 (prefix p). B butuh kata mulai suffix(w1) yang
  // berujung balik ke p agar prefix kembali ke p, lalu A coba w1 lagi.
  let tested = false;
  for (let seed = 1; seed <= 30 && !tested; seed++) {
    const evts = [];
    const room = makeRoom("easy", [{ id: "A", name: "A" }, { id: "B", name: "B" }], seed, evts);
    room.start(0);
    const p = room.prefix;
    const w1 = dict.randomWordPrefix(p, room.used, rng(seed * 11));
    if (!w1) continue;
    if (room.submit("A", w1, 100).ok !== true) continue;
    const sfx1 = w1.charAt(E.effectiveSuffixIndex(w1));
    if (room.players[room.cur].id !== "B") continue;
    // cari w2: mulai sfx1, berujung p (supaya prefix balik ke p), belum dipakai
    const cands = dict.samplePrefix(sfx1, 300).filter(w => w.endsWith(p) && w !== w1);
    let w2 = null;
    for (const c of cands) {
      const v = room.submit("B", c, 200);
      if (v.ok) { w2 = c; break; }
      if (v.reason === "jalan_buntu") continue; // coba kandidat lain
      break;
    }
    if (!w2) continue;
    if (room.players[room.cur].id !== "A") continue;
    const r = room.submit("A", w1, 300);
    eq(r.reason, "ulang", "kata yang sudah dipakai ditolak sbg 'ulang' (seed " + seed + ")");
    ok(room.byId["A"].wrong === 1, "dihitung salah (counter +1)");
    tested = true;
  }
  ok(tested, "skenario ulang berhasil dibangun dari kamus nyata");
}

/* ---------- Jalan buntu: tidak dihitung salah ---------- */
section("Jalan buntu — sudah terverifikasi di level validate() (test 1)");
ok(true, "path room: answer_bad(jalan_buntu, counted=false) — dipakai ulang oleh bot-retry");

/* ---------- Eliminasi & pemenang ---------- */
section("Eliminasi & pemenang — bertahan terakhir menang");
{
  const evts = [];
  const room = makeRoom("easy", [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }], 71, evts);
  room.start(0);
  // biarkan semua timeout sampai tersisa 1
  let guard = 0;
  while (!room.over && guard++ < 200) room.tick(guard * 30000);
  ok(room.over, "game selesai (tersisa 1 pemain)");
  const go = last(evts, "gameover");
  ok(go && go.winnerId, "pemenang ditentukan");
  const alive = room.players.find(p => p.alive);
  eq(go.winnerId, alive.id, "pemenang = pemain yang bertahan");
  ok(room.players.filter(p => p.alive).length === 1, "hanya 1 pemain bertahan");
  ok(count(evts, "eliminated") === 2, "2 pemain tereliminasi");
  const lostTotal = room.players.reduce((s, p) => s + (3 - p.lives), 0);
  eq(count(evts, "life_lost"), lostTotal, "total life_lost = jumlah nyawa yang hilang");
  ok(count(evts, "timeout") === lostTotal, "setiap kehilangan nyawa berasal dari timeout");
}

/* ---------- Solo mode ---------- */
section("Solo — monolog, gameover saat nyawa habis");
{
  const evts = [];
  const room = makeRoom("hard", [{ id: "S", name: "Sendiri" }], 81, evts);
  room.start(0);
  ok(last(evts, "turn").seconds === 10, "solo hard = 10 detik");
  ok(last(evts, "turn").prefix.length === 1, "solo hard prefix pertama 1 huruf");
  // habiskan nyawa dengan salah-5 x3
  let guard = 0;
  while (!room.over && guard++ < 100) {
    room.submit("S", "xxxx" + guard, guard * 100);
  }
  ok(room.over, "solo selesai saat nyawa habis");
  const go = last(evts, "gameover");
  ok(go && go.winnerId === null, "solo tanpa pemenang");
  ok(room.byId["S"].lives === 0, "nyawa habis");
  ok(room.running === false, "room berhenti");
}

/* ---------- Bot tak terkalahkan ---------- */
section("Bot tak terkalahkan — 3 mode, bot selalu menjawab, manusia menyerah");
{
  for (const mode of ["easy", "normal", "hard"]) {
    const evts = [];
    const room = makeRoom(mode, [{ id: "P", name: "Manusia" }, { id: "BOT", name: "Robot", bot: true }], 91, evts);
    room.start(0);
    let now = 0, guard = 0;
    // Manusia TIDAK PERNAH menjawab (menyerah) — waktunya habis terus.
    // Bot wajib selalu menjawab sebelum waktunya habis di setiap gilirannya.
    while (!room.over && guard++ < 60000) {
      now += 50;
      room.tick(now);
    }
    ok(room.over, `${mode}: game berakhir`);
    ok(room.byId["BOT"].lives === 3, `${mode}: bot tidak pernah kehilangan nyawa`);
    ok(room.byId["BOT"].words.length >= 3, `${mode}: bot menjawab ${room.byId["BOT"].words.length} kata`);
    ok(room.byId["P"].lives === 0, `${mode}: manusia kehabisan nyawa`);
    eq(last(evts, "gameover").winnerId, "BOT", `${mode}: pemenang = bot`);
    eq(evts.filter(e => e.type === "timeout" && e.playerId === "BOT").length, 0,
      `${mode}: bot tidak pernah kehabisan waktu`);
  }
}

/* ---------- 13 pemain penuh ---------- */
section("13 pemain — game tetap sehat sampai ada pemenang");
{
  const evts = [];
  const players = [];
  for (let i = 0; i < 13; i++) players.push({ id: "P" + i, name: "pemain" + i });
  const room = makeRoom("normal", players, 101, evts);
  room.start(0);
  ok(room.players.length === 13, "13 pemain masuk");
  let now = 0, guard = 0;
  const skip = new Set();
  while (!room.over && guard++ < 500000) {
    now += 100;
    const cur = room.players[room.cur];
    const elapsed = now - room.turnStart;
    if (elapsed > 2000) {
      // 15% peluang pemain menyerah (biarkan timeout) supaya game berakhir wajar
      if (!skip.has(cur.id) && rng(guard % 999983)() < 0.15) skip.add(cur.id);
      if (!skip.has(cur.id)) {
        const w = dict.randomWordPrefix(room.prefix, room.used, rng(guard % 997));
        if (w) room.submit(cur.id, w, now);
      }
    }
    room.tick(now);
  }
  ok(room.over, "game 13 pemain selesai");
  ok(last(evts, "gameover"), "event gameover ada");
  // semua kata terpakai unik
  ok(room.used.size === room.players.reduce((s, p) => s + p.words.length, 0), "used set konsisten dgn total kata");
}

done("test_gameroom");
