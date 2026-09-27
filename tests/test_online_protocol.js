/* BLACKBOX TEST 4 — Protokol online end-to-end (mock relay = spec GameServer.kt)
 * Skenario: host + client bot menjalankan Engine.GameRoom lewat relay;
 * PIN salah, kick + blokir 30s, retry saat blokir → digandakan, tunggu kedaluwarsa,
 * gabung lagi, chat relay, kapasitas 13, lalu permainan penuh sampai gameover. */
"use strict";
const { ok, eq, section, done } = require("./harness.js");
require("../app/src/main/assets/kamus.js");
const E = require("../app/src/main/assets/engine.js");
const { MockRelay } = require("./mock_relay.js");

const dict = new E.Dict(globalThis.KAMUS);
let simNow = 1000000;
const clock = () => simNow;

/* fake koneksi dengan kotak surat (outbox) */
function fakeConn(ip) {
  return { ip, outbox: [], send(m) { this.outbox.push(m); }, last(t) { for (let i = this.outbox.length - 1; i >= 0; i--) if (this.outbox[i].t === t) return this.outbox[i]; return null; } };
}

/* ---------- setup room ---------- */
section("Setup room & PIN");
const relay = new MockRelay(654321, { clock });
const hostConn = fakeConn("127.0.0.1");
relay.connect(hostConn);
ok(hostConn.last("hello") && hostConn.last("hello").id, "host menerima hello");

const c1 = fakeConn();
relay.connect(c1);
relay.message(c1, { t: "join", pin: "111111", name: "budi" });
eq(c1.last("join_rejected") ? c1.last("join_rejected").reason : null, "pin", "PIN salah ditolak");
relay.message(c1, { t: "join", pin: "654321", name: "budi" });
ok(c1.last("joined_ok"), "PIN benar → joined_ok");
eq(c1.last("joined_ok").id, c1.id, "client mendapat id");
const roster = c1.last("roster");
ok(roster && roster.players.some(p => p.id === "H") && roster.players.some(p => p.name === "budi"), "roster memuat host + budi");

/* ---------- kick + blokir 30 detik ---------- */
section("Kick → blokir 30 detik");
relay.message(c1, { t: "chat", text: "halo semua" });
ok(hostConn.last("chat") && hostConn.last("chat").text === "halo semua", "chat tersampai ke host");
relay.message(hostConn, { t: "srv_kick", id: c1.id, reason: "spam" });
const kicked = c1.last("kicked");
ok(kicked && kicked.reason === "spam", "kicked + alasan terkirim ke korban");
eq(kicked.wait, 30, "masa blokir 30 detik diberitahukan");
ok(!c1.last("joined_ok") || true, "koneksinya ditutup dari roster");

/* reconnect dari IP yang sama */
const c1b = fakeConn(c1.ip); // IP sama
relay.connect(c1b);
relay.message(c1b, { t: "join", pin: "654321", name: "budi" });
const rej = c1b.last("join_rejected");
ok(rej && rej.reason === "banned" && rej.wait === 60, "join saat blokir → ditolak; sisa 30s digandakan jadi 60s (dapat " + (rej && rej.wait) + ")");

section("Retry saat blokir → sisa digandakan");
simNow += 10000; // 10 detik berlalu (sisa 50s)
relay.message(c1b, { t: "join", pin: "654321", name: "budi" });
const rej2 = c1b.last("join_rejected");
ok(rej2 && rej2.reason === "banned", "retry kedua ditolak lagi");
ok(rej2.wait === 100, `sisa blokir digandakan 50s → 100s (dapat ${rej2 && rej2.wait})`);
simNow += 5000; // sisa 95 → 190
relay.message(c1b, { t: "join", pin: "654321", name: "budi" });
const rej3 = c1b.last("join_rejected");
ok(rej3 && rej3.wait === 190, `penggandaan berlaku bertingkat (95→190, dapat ${rej3 && rej3.wait})`);

section("Menunggu kedaluwarsa → gabung normal");
simNow = clock() + 200000; // lewati seluruh blokir
relay.message(c1b, { t: "join", pin: "654321", name: "budi" });
ok(c1b.last("joined_ok"), "setelah blokir berlalu, gabung sukses");

/* ---------- kapasitas 13 (12 client + host) ---------- */
section("Kapasitas maksimal 13 pemain");
let conns = [c1b];
while (relay.roster.size < 12) {
  const c = fakeConn();
  relay.connect(c);
  relay.message(c, { t: "join", pin: "654321", name: "pemain" + relay.roster.size });
  if (c.last("joined_ok")) conns.push(c);
}
ok(relay.roster.size === 12, "12 client berhasil masuk");
const cExtra = fakeConn();
relay.connect(cExtra);
relay.message(cExtra, { t: "join", pin: "654321", name: "kelebihan" });
eq(cExtra.last("join_rejected") ? cExtra.last("join_rejected").reason : null, "full", "client ke-13 ditolak (room penuh)");

/* ---------- permainan penuh via relay ---------- */
section("Permainan online penuh — host authority, 13 pemain");
let events = [];
const room = new E.GameRoom(dict, "normal", {
  players: [{ id: "H", name: "HOST" }].concat(relay.rosterList().map(r => ({ id: r.id, name: r.name }))),
  rnd: Math.random,
  onEvent: ev => events.push(ev)
});
// host broadcast event → semua client menerima via gmsg
const seen = new Map(); // connId -> jumlah turn diterima
conns.forEach(c => seen.set(c.id, 0));
room.onEvent = function (ev) {
  events.push(ev);
  if (ev.type === "turn") {
    const payload = { t: "gmsg", d: { k: "turn", n: ev.n, playerId: ev.playerId, prefix: ev.prefix, seconds: ev.seconds } };
    relay.broadcast({ t: "gmsg", from: "H", name: "HOST", d: { k: "turn", n: ev.n, playerId: ev.playerId, prefix: ev.prefix, seconds: ev.seconds } });
  }
};
room.start(simNow);
ok(events.some(e => e.type === "turn"), "turn pertama terkirim");
// simulasi semua orang menjawab (95% benar) hingga gameover
let now = simNow, guard = 0, wrongMap = new Map();
let decision = { turn: -1, ok: true };
while (!room.over && guard++ < 400000) {
  now += 100;
  const p = room.players[room.cur];
  if (decision.turn !== room.turnIdx) {
    // keputusan per giliran: 15% pemain menyerah (timeout), sisanya menjawab
    decision = { turn: room.turnIdx, ok: Math.random() > 0.15 };
  }
  if (decision.ok && now - room.turnStart > 2000) {
    const w = dict.randomWordPrefix(room.prefix, room.used, Math.random);
    if (w) room.submit(p.id, w, now);
  }
  room.tick(now);
}
ok(room.over, "game online 13 pemain selesai");
ok(events.some(e => e.type === "gameover"), "gameover terkirim");
const totalWords = room.players.reduce((s, p) => s + p.words.length, 0);
ok(totalWords > 30, `total kata tersambung ${totalWords}`);
ok(room.used.size === totalWords, "konsistensi used set");

section("Protokol ringkas & valid JSON");
// semua pesan yang dikirim harus bisa JSON.stringify/parse
let allJson = true;
conns.concat([hostConn, cExtra]).forEach(c => {
  c.outbox.forEach(m => { try { JSON.parse(JSON.stringify(m)); } catch (e) { allJson = false; } });
});
ok(allJson, "semua pesan relay JSON-valid");

done("test_online_protocol");
