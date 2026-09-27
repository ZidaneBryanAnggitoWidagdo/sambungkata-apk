/* =============================================================
 * mock_relay.js — SPEC protokol server (cermin GameServer.kt)
 * Dipakai test Node UNTUK memverifikasi semantik online sebelum
 * ditulis ulang di Kotlin. Aturan yang diimplementasikan:
 *  - join dengan PIN 6 digit; PIN salah boleh dicoba ulang
 *  - kapasitas maksimal 12 client (+1 host) = 13 pemain
 *  - kick: kirim alasan ke target, tutup koneksi, blokir IP 30 detik
 *  - mencoba join saat masih diblokir → sisa masa blokir DIGANDAKAN
 *  - blokir kedaluwarsa → boleh gabung lagi normal
 *  - relay chat & pesan game (gmsg) ke SEMUA kecuali pengirim
 *  - roster broadcast tiap join/left
 * ============================================================= */
"use strict";
const crypto = require("crypto");

function id() { return crypto.randomBytes(4).toString("hex"); }

/** conn: {ip, send(obj), close()} — callback onMessage(conn, msgObj) */
class MockRelay {
  constructor(pin, opts) {
    opts = opts || {};
    this.pin = String(pin);
    this.maxClients = opts.maxClients != null ? opts.maxClients : 12;
    this.banMs = opts.banMs != null ? opts.banMs : 30000;
    this.conns = new Set();          // semua koneksi termasuk host
    this.roster = new Map();         // connId -> {name} (client joined saja)
    this.bans = new Map();           // ip -> {until, attempts}
    this.onEvent = opts.onEvent || function () {};
    this.clock = opts.clock || Date.now;
    this.nextId = 1;
  }

  connect(conn) {
    conn.ip = conn.ip || "10.0.0." + (this.nextId++);
    conn.id = id();
    this.conns.add(conn);
    this.onEvent({ type: "conn_open", id: conn.id, ip: conn.ip });
    conn.send({ t: "hello", id: conn.id });
    // beri tahu host (koneksi 127.0.0.1) tentang koneksi baru
    this.toHost({ t: "conn", id: conn.id, ip: conn.ip });
    return conn.id;
  }

  isHost(conn) { return conn.ip === "127.0.0.1"; }

  disconnect(conn) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    if (this.roster.has(conn.id)) {
      this.roster.delete(conn.id);
      this.broadcastRoster();
      this.toHost({ t: "left", id: conn.id });
    }
    this.onEvent({ type: "conn_close", id: conn.id });
  }

  toHost(msg) {
    this.conns.forEach(function (c) { if (c.ip === "127.0.0.1") c.send(msg); });
  }

  broadcast(msg, exceptId) {
    this.conns.forEach(function (c) {
      if (c.id !== exceptId) c.send(msg);
    });
  }

  broadcastRoster() {
    var players = [{ id: "H", name: "HOST" }];
    this.roster.forEach(function (v, k) { players.push({ id: k, name: v.name }); });
    this.broadcast({ t: "roster", players: players });
    this.toHost({ t: "roster", players: players });
  }

  message(conn, msg) {
    var now = this.clock();
    if (this.isHost(conn)) {
      // perintah server dari host
      if (msg.t === "srv_kick") return this.kick(conn, msg.id, msg.reason, now);
      if (msg.t === "srv_direct") {
        this.conns.forEach(function (c) { if (c.id === msg.id) c.send(msg.msg); });
        return;
      }
    }
    switch (msg.t) {
      case "join": return this.join(conn, msg, now);
      case "gmsg": {
        var info = this.roster.get(conn.id);
        if (!info) return;
        this.broadcast({ t: "gmsg", from: conn.id, name: info.name, d: msg.d }, conn.id);
        return;
      }
      case "chat": {
        var info2 = this.roster.get(conn.id);
        if (!info2) return;
        this.broadcast({ t: "chat", from: conn.id, name: info2.name, text: String(msg.text || "").slice(0, 300) }, conn.id);
        return;
      }
    }
  }

  join(conn, msg, now) {
    var b = this.bans.get(conn.ip);
    if (b && b.until > now) {
      var remaining = b.until - now;
      b.until = now + remaining * 2;   // GANDAKAN sisa blokir
      b.attempts++;
      conn.send({ t: "join_rejected", reason: "banned", wait: Math.ceil(remaining * 2 / 1000) });
      this.onEvent({ type: "join_banned_doubled", ip: conn.ip, newWaitMs: remaining * 2 });
      return;
    }
    if (String(msg.pin) !== this.pin) {
      conn.send({ t: "join_rejected", reason: "pin" });
      this.onEvent({ type: "join_wrong_pin", ip: conn.ip });
      return;
    }
    if (this.roster.size >= this.maxClients) {
      conn.send({ t: "join_rejected", reason: "full" });
      this.onEvent({ type: "join_full", ip: conn.ip });
      return;
    }
    var name = String(msg.name || "anon").slice(0, 15);
    this.roster.set(conn.id, { name: name });
    conn.send({ t: "joined_ok", id: conn.id, players: [{ id: "H", name: "HOST" }].concat(this.rosterList()) });
    this.broadcastRoster();
    this.toHost({ t: "joined", id: conn.id, name: name, ip: conn.ip });
    this.onEvent({ type: "joined", id: conn.id, name: name });
  }

  rosterList() {
    var out = [];
    this.roster.forEach(function (v, k) { out.push({ id: k, name: v.name }); });
    return out;
  }

  kick(byConn, targetId, reason, now) {
    var target = null;
    this.conns.forEach(function (c) { if (c.id === targetId) target = c; });
    if (!target || !this.roster.has(targetId)) return;
    var name = this.roster.get(targetId).name;
    target.send({ t: "kicked", reason: String(reason || "").slice(0, 200), wait: Math.ceil(this.banMs / 1000) });
    this.roster.delete(targetId);
    this.conns.delete(target);
    this.bans.set(target.ip, { until: now + this.banMs, attempts: 1 });
    this.broadcastRoster();
    this.toHost({ t: "left", id: targetId });
    this.onEvent({ type: "kicked", id: targetId, name: name, ip: target.ip });
  }
}

module.exports = { MockRelay };
