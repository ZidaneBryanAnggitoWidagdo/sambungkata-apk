/* =============================================================
 * engine.js — Mesin logika game "Sambung Kata" (murni, tanpa DOM)
 * Dipakai bersama oleh: WebView (offline & online) + test Node.js
 *
 * Aturan inti (permintaan desainer):
 *  - easy   : prefix = 1 huruf terakhir; 25 detik; ujung x/q/f otomatis
 *             diganti huruf sebelumnya; 1.000+ kata berujung x/q/f di kamus.
 *  - normal : prefix 1-3 huruf (boleh sub-sekuens dari 3 huruf terakhir,
 *             tidak selalu berdampingan); 15 detik; noise: awal mayoritas
 *             1-2 huruf, pertengahan mulai 3 huruf, akhir mayoritas 2-3.
 *  - hard   : prefix 1-6 huruf (sub-sekuens 6 huruf terakhir); 10 detik;
 *             giliran pertama pasti 1 huruf; noise awal condong 3-5,
 *             pertengahan 1 huruf jarang (umumnya 3-6); jika tidak ada
 *             prefix bagus 3-6, sistem boleh turun ke 1-2 huruf.
 *  - Nyawa  : 3. Habis waktu -1 nyawa. Setiap salah ke-5 (kata tidak ada
 *             di kamus / tidak sesuai awalan / diulang) -1 nyawa.
 *  - Pemenang: pemain terakhir yang bertahan.
 * ============================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MODES = {
    easy:   { time: 25000, tail: 1, minWords: 1,  maxLen: 1 },
    normal: { time: 15000, tail: 3, minWords: 12, maxLen: 3 },
    hard:   { time: 10000, tail: 6, minWords: 6,  maxLen: 6 }
  };
  var BANNED_SUFFIX = { x: 1, q: 1, f: 1 };
  var MAX_LIVES = 3;
  var WRONG_FOR_LIFE = 5;
  var LETTERS = "abcdefghijklmnopqrstuvwxyz";

  /* ---------------- Kamus (sorted array + binary search) ---------------- */

  function Dict(raw) {
    var src = raw.split("\n");
    var w = [];
    for (var i = 0; i < src.length; i++) {
      var s = src[i];
      if (s && s.length >= 2) w.push(s);
    }
    this.words = w;
    this.set = new Set(w);
    this.ranges = {};
    for (var j = 0; j < 26; j++) {
      var c = LETTERS.charAt(j);
      var lo = this.lowerBound(c);
      var hi = this.lowerBound(String.fromCharCode(c.charCodeAt(0) + 1));
      if (hi > lo) this.ranges[c] = [lo, hi];
    }
  }

  Dict.prototype.lowerBound = function (s) {
    var lo = 0, hi = this.words.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (this.words[mid] < s) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  Dict.prototype.has = function (w) { return this.set.has(w); };

  Dict.prototype.rangeOf = function (p) {
    var lo = this.lowerBound(p);
    if (lo >= this.words.length || this.words[lo].lastIndexOf(p, 0) !== 0) return null;
    return [lo, this.lowerBound(p + "\uffff")];
  };

  Dict.prototype.countPrefix = function (p) {
    var r = this.rangeOf(p);
    return r ? (r[1] - r[0]) : 0;
  };

  /** Apakah masih ada kata dengan prefix p yang belum dipakai? Sampel cepat. */
  function hasUnused(d, p, usedSet, k) {
    if (!usedSet || usedSet.size === 0) return true;
    var r = d.rangeOf(p);
    if (!r) return false;
    var n = r[1] - r[0];
    if (n <= 12) {
      for (var i = r[0]; i < r[1]; i++) if (!usedSet.has(d.words[i])) return true;
      return false;
    }
    for (var t = 0; t < (k || 8); t++) {
      if (!usedSet.has(d.words[r[0] + ((Math.random() * n) | 0)])) return true;
    }
    return false;
  }

  /** Sampel hingga k kata acak ber-prefix p. */
  Dict.prototype.samplePrefix = function (p, k) {
    var r = this.rangeOf(p);
    if (!r) return [];
    var n = r[1] - r[0], out = [];
    if (n <= k) { for (var i = r[0]; i < r[1]; i++) out.push(this.words[i]); return out; }
    var seen = new Set(), guard = 0;
    while (out.length < k && guard < k * 12) {
      guard++;
      var idx = r[0] + ((Math.random() * n) | 0);
      if (seen.has(idx)) continue;
      seen.add(idx);
      out.push(this.words[idx]);
    }
    return out;
  };

  /** Kata acak ber-prefix p yang belum dipakai (pemindaian dari titik acak). */
  Dict.prototype.randomWordPrefix = function (p, usedSet, rnd) {
    var r = this.rangeOf(p);
    if (!r) return null;
    var n = r[1] - r[0];
    if (n <= 0) return null;
    var gen = rnd || Math.random;
    if (!usedSet || usedSet.size === 0) return this.words[r[0] + ((gen() * n) | 0)];
    var start = (gen() * n) | 0;
    for (var i = 0; i < n; i++) {
      var w = this.words[r[0] + ((start + i) % n)];
      if (!usedSet.has(w)) return w;
    }
    return null;
  };

  /* ---------------- Util prefix ---------------- */

  /** Semua sub-sekuens non-kosong dari s (urut huruf asli, unik). */
  function subsequences(s) {
    var out = [], seen = new Set(), total = 1 << s.length;
    for (var m = 1; m < total; m++) {
      var t = "";
      for (var i = 0; i < s.length; i++) if (m & (1 << i)) t += s.charAt(i);
      if (!seen.has(t)) { seen.add(t); out.push(t); }
    }
    return out;
  }

  /** Apakah p sub-sekuens dari t? (untuk pengujian blackbox) */
  function isSubseq(p, t) {
    var i = 0, j = 0;
    while (i < p.length && j < t.length) {
      if (p.charAt(i) === t.charAt(j)) i++;
      j++;
    }
    return i === p.length;
  }

  /** Mode easy: indeks huruf efektif — x/q/f diganti huruf sebelumnya. */
  function effectiveSuffixIndex(word) {
    var i = word.length - 1;
    while (i > 0 && BANNED_SUFFIX[word.charAt(i)]) i--;
    return i;
  }

  function normalizeWord(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[\s\-'`´]/g, "");
  }

  var RE_WORD = /^[a-z]+$/;

  /* ---------------- Jadwal noise (kurva kesulitan) ---------------- */

  var NOISE = {
    normal: [
      { turn: 0,  w: { 1: 0.70, 2: 0.30, 3: 0.00 } },
      { turn: 5,  w: { 1: 0.45, 2: 0.35, 3: 0.20 } },
      { turn: 11, w: { 1: 0.30, 2: 0.40, 3: 0.30 } },
      { turn: 18, w: { 1: 0.15, 2: 0.45, 3: 0.40 } }
    ],
    hard: [
      { turn: 0,  w: { 1: 1.00, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
      { turn: 1,  w: { 1: 0.08, 2: 0.12, 3: 0.35, 4: 0.27, 5: 0.12, 6: 0.06 } },
      { turn: 7,  w: { 1: 0.04, 2: 0.10, 3: 0.28, 4: 0.30, 5: 0.18, 6: 0.10 } },
      { turn: 13, w: { 1: 0.02, 2: 0.08, 3: 0.26, 4: 0.30, 5: 0.21, 6: 0.13 } }
    ]
  };

  function pickWeights(mode, turnIdx) {
    var rows = NOISE[mode], w = rows[0].w;
    for (var i = 0; i < rows.length; i++) if (turnIdx >= rows[i].turn) w = rows[i].w;
    return w;
  }

  function weightedLen(w, rnd) {
    var keys = Object.keys(w).map(Number).sort(function (a, b) { return a - b; });
    var r = rnd(), acc = 0;
    for (var i = 0; i < keys.length; i++) {
      acc += w[keys[i]];
      if (r <= acc) return keys[i];
    }
    return keys[keys.length - 1];
  }

  /** Urutan panjang kandidat: bobot terbesar dulu (fallback otomatis). */
  function lengthOrder(w) {
    return Object.keys(w).map(Number).sort(function (a, b) {
      var d = w[b] - w[a];
      return d !== 0 ? d : a - b;
    });
  }

  /** Kumpulkan semua prefix panjang L yang "sehat" (cukup kata & belum habis). */
  function collectByLength(d, usedSet, L, out, minWords) {
    if (L === 1) {
      for (var i = 0; i < 26; i++) {
        var c = LETTERS.charAt(i);
        var r = d.ranges[c];
        if (!r || r[1] - r[0] < minWords) continue;
        if (!hasUnused(d, c, usedSet, 6)) continue;
        out.push(c);
      }
      return;
    }
    for (var a = 0; a < 26; a++) {
      var ca = LETTERS.charAt(a);
      var ra = d.ranges[ca];
      if (!ra || ra[1] - ra[0] < minWords) continue;
      for (var b = 0; b < 26; b++) {
        var p2 = ca + LETTERS.charAt(b);
        if (d.countPrefix(p2) < minWords) continue;
        if (L === 2) {
          if (hasUnused(d, p2, usedSet, 6)) out.push(p2);
        } else {
          for (var c2 = 0; c2 < 26; c2++) {
            var p3 = p2 + LETTERS.charAt(c2);
            if (d.countPrefix(p3) < minWords) continue;
            if (hasUnused(d, p3, usedSet, 6)) out.push(p3);
          }
        }
      }
    }
  }

  /* ---------------- PrefixEngine ---------------- */

  function PrefixEngine(dict, mode, rnd) {
    this.dict = dict;
    this.mode = mode;
    this.cfg = MODES[mode];
    this.rnd = rnd || Math.random;
  }

  /**
   * Tentukan prefix berikutnya.
   * @param prevWord kata sebelumnya (null = awal permainan)
   * @param turnIdx  indeks giliran (0-based) untuk kurva noise
   * @param usedSet  kata yang sudah dipakai pada ronde ini
   * @return {prefix} atau null jika tidak ada kandidat hidup (jalan buntu)
   */
  PrefixEngine.prototype.next = function (prevWord, turnIdx, usedSet) {
    var d = this.dict, cfg = this.cfg, mode = this.mode, rnd = this.rnd;

    if (mode === "easy") {
      if (!prevWord) {
        var starts = [];
        for (var c in d.ranges) {
          if (BANNED_SUFFIX[c]) continue; // x/q/f nyaris mustahil disambung
          if (d.ranges[c][1] - d.ranges[c][0] >= 80) starts.push(c);
        }
        if (!starts.length) return null;
        return { prefix: starts[(rnd() * starts.length) | 0] };
      }
      // aturan easy: huruf terakhir; x/q/f diganti huruf sebelumnya
      var idx = effectiveSuffixIndex(prevWord);
      return { prefix: prevWord.charAt(idx) };
    }

    // normal / hard
    var byLen = {};
    function add(p) { (byLen[p.length] || (byLen[p.length] = [])).push(p); }

    if (!prevWord) {
      var w0 = pickWeights(mode, 0);
      var Ls;
      if (mode === "hard") {
        Ls = [1]; // spesifikasi: prefix pertama hard pasti 1 huruf
      } else {
        var L0 = weightedLen(w0, rnd); // sampling bobot agar tidak kaku
        Ls = [L0].concat(lengthOrder(w0).filter(function (x) { return x !== L0; }));
      }
      for (var q = 0; q < Ls.length; q++) {
        var cands0 = [];
        collectByLength(d, usedSet, Ls[q], cands0, cfg.minWords);
        if (cands0.length) return { prefix: cands0[(rnd() * cands0.length) | 0] };
      }
      return null;
    }

    var tail = prevWord.slice(-cfg.tail);
    var subs = subsequences(tail);
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i];
      if (d.countPrefix(s) < cfg.minWords) continue;
      if (!hasUnused(d, s, usedSet, 8)) continue;
      add(s);
    }

    var wts = pickWeights(mode, turnIdx);
    // 1) sampling panjang sesuai bobot noise (agar distribusi tidak kaku)
    // 2) fallback ke panjang lain mengikuti urutan bobot (sistem boleh
    //    menurunkan/menaikkan panjang bila kandidat kosong)
    var Lfirst = weightedLen(wts, rnd);
    var order = [Lfirst];
    var lo = lengthOrder(wts);
    for (var j = 0; j < lo.length; j++) if (lo[j] !== Lfirst) order.push(lo[j]);
    for (j = 0; j < order.length; j++) {
      var arr = byLen[order[j]];
      if (arr && arr.length) return { prefix: arr[(rnd() * arr.length) | 0] };
    }
    return null; // jalan buntu
  };

  /* ---------------- Validasi jawaban ---------------- */

  /**
   * @return {ok:true, word} atau {ok:false, reason, word, ...}
   * reason: kosong|format|pendek|awalan|kbbi|ulang|jalan_buntu
   * 'jalan_buntu' TIDAK dihitung salah (pemain tinggal pilih kata lain,
   * timer tetap berjalan) — mencegah rantai macet.
   */
  function validate(dict, engine, word, prefix, usedSet) {
    var w = normalizeWord(word);
    if (!w) return { ok: false, reason: "kosong", word: w };
    if (!RE_WORD.test(w)) return { ok: false, reason: "format", word: w };
    if (w.length < 2) return { ok: false, reason: "pendek", word: w };
    if (prefix && w.lastIndexOf(prefix, 0) !== 0)
      return { ok: false, reason: "awalan", word: w, prefix: prefix };
    if (!dict.has(w)) return { ok: false, reason: "kbbi", word: w };
    if (usedSet && usedSet.has(w)) return { ok: false, reason: "ulang", word: w };

    // cek jalan buntu: kata tidak boleh mematikan rantai
    var used2 = usedSet ? new Set(usedSet) : new Set();
    used2.add(w);
    if (engine.mode === "easy") {
      var p = w.charAt(effectiveSuffixIndex(w));
      if (!hasUnused(dict, p, used2, 12))
        return { ok: false, reason: "jalan_buntu", word: w };
    } else if (!engine.next(w, 0, used2)) {
      return { ok: false, reason: "jalan_buntu", word: w };
    }
    return { ok: true, word: w };
  }

  /* ---------------- Ruang permainan ---------------- */

  function Player(id, name, bot) {
    this.id = id;
    this.name = name;
    this.bot = !!bot;
    this.lives = MAX_LIVES;
    this.wrong = 0;
    this.alive = true;
    this.connected = true;
    this.words = [];
  }

  /**
   * @param dict  Dict
   * @param mode  'easy'|'normal'|'hard'
   * @param spec  { players:[{id,name,bot}], onEvent(ev), rnd? }
   * Waktu dipakai driver luar (test/UI) lewat parameter `now` (ms) —
   * deterministik dan bebas dari jam sistem.
   */
  function GameRoom(dict, mode, spec) {
    this.dict = dict;
    this.mode = mode;
    this.cfg = MODES[mode];
    this.engine = new PrefixEngine(dict, mode, spec.rnd);
    this.rnd = spec.rnd || Math.random;
    this.onEvent = spec.onEvent || function () {};
    var self = this;
    this.players = (spec.players || []).map(function (p) { return new Player(p.id, p.name, p.bot); });
    this.byId = {};
    this.players.forEach(function (p) { self.byId[p.id] = p; });
    this.used = new Set();
    this.turnIdx = 0;
    this.cur = -1;
    this.prefix = null;
    this.turnStart = 0;
    this.running = false;
    this.over = false;
    this.winnerId = null;
    this._botAt = 0;
    this.startedAt = 0;
  }

  GameRoom.prototype.emit = function (ev) {
    ev.mode = this.mode;
    this.onEvent(ev);
  };

  GameRoom.prototype.alivePlayers = function () {
    return this.players.filter(function (p) { return p.alive; });
  };

  GameRoom.prototype.currentPlayer = function () {
    return this.players[this.cur] || null;
  };

  GameRoom.prototype._nextPrefixFrom = function (prevWord, turnIdx) {
    return this.engine.next(prevWord, turnIdx, this.used);
  };

  GameRoom.prototype.start = function (now) {
    if (this.players.length === 0) throw new Error("tidak ada pemain");
    this.running = true;
    this.over = false;
    this.startedAt = now;
    this.cur = (this.rnd() * this.players.length) | 0; // pemain pertama acak
    var p = this._nextPrefixFrom(null, 0);
    if (!p) throw new Error("kamus tidak mendukung mode ini");
    this.prefix = p.prefix;
    this.turnStart = now;
    this._scheduleBot(now);
    this.emit({ type: "start", order: this.players.map(function (x) { return { id: x.id, name: x.name, bot: x.bot }; }) });
    this._emitTurn();
  };

  GameRoom.prototype._emitTurn = function () {
    var p = this.players[this.cur];
    this.emit({
      type: "turn",
      n: this.turnIdx,
      playerId: p.id,
      playerName: p.name,
      prefix: this.prefix,
      seconds: this.cfg.time / 1000,
      deadline: this.turnStart + this.cfg.time,
      usedCount: this.used.size
    });
  };

  GameRoom.prototype._scheduleBot = function (now) {
    this._botAt = 0;
    var p = this.players[this.cur];
    if (!p || !p.bot || !p.alive) return;
    var d = 1200 + ((this.rnd() * 1800) | 0);
    var cap = this.cfg.time - 2000;
    if (d > cap) d = Math.max(600, cap);
    this._botAt = now + d;
  };

  /** Dipanggil driver tiap ~50-200ms. */
  GameRoom.prototype.tick = function (now) {
    if (!this.running || this.over) return;
    var p = this.players[this.cur];
    if (p && p.bot && p.alive && this._botAt && now >= this._botAt) {
      this._botAt = 0;
      var w = this.dict.randomWordPrefix(this.prefix, this.used, this.rnd);
      var res = w ? this.submit(p.id, w, now) : { ok: false, reason: "kbbi" };
      if (res && !res.ok && res.reason === "jalan_buntu") {
        this._botAt = now + 250; // bot mencoba kata lain, tetap tak terkalahkan
      }
      return;
    }
    if (now - this.turnStart >= this.cfg.time) this.timeout(now);
  };

  GameRoom.prototype.submit = function (pid, word, now) {
    if (!this.running || this.over) return { ok: false, reason: "tidak_berjalan" };
    if (this.players[this.cur].id !== pid) return { ok: false, reason: "bukan_giliran" };
    var p = this.byId[pid];
    if (!p) return { ok: false, reason: "pemain_tidak_ada" };

    var res = validate(this.dict, this.engine, word, this.prefix, this.used);
    if (!res.ok) {
      if (res.reason === "jalan_buntu") {
        this.emit({ type: "answer_bad", playerId: pid, word: res.word, reason: res.reason, counted: false, wrongCount: p.wrong });
        return res;
      }
      p.wrong++;
      var loseNow = p.wrong >= WRONG_FOR_LIFE;
      if (loseNow) p.wrong = 0;
      this.emit({ type: "answer_bad", playerId: pid, word: res.word, reason: res.reason, counted: true, wrongCount: p.wrong });
      if (loseNow) {
        this.loseLife(p, "wrong5", now);
        if (this.over) return res;
        if (!p.alive) this.advance(now, true);
      }
      // giliran tidak maju: pemain boleh mencoba lagi selama waktunya tersisa
      return res;
    }

    this.used.add(res.word);
    p.words.push(res.word);
    this.emit({ type: "answer_ok", playerId: pid, word: res.word });
    this.advance(now, false, res.word);
    return { ok: true, word: res.word };
  };

  GameRoom.prototype.timeout = function (now) {
    if (!this.running || this.over) return;
    var p = this.players[this.cur];
    this.emit({ type: "timeout", playerId: p.id });
    this.loseLife(p, "timeout", now);
    if (this.over) return;
    // prefix tetap, giliran pindah ke pemain hidup berikutnya
    this.advance(now, true);
  };

  GameRoom.prototype.loseLife = function (p, cause, now) {
    p.lives--;
    this.emit({ type: "life_lost", playerId: p.id, cause: cause, lives: p.lives });
    if (p.lives <= 0 && p.alive) {
      p.alive = false;
      this.emit({ type: "eliminated", playerId: p.id });
    }
    this.checkOver();
  };

  GameRoom.prototype.advance = function (now, keepPrefix, prevWord) {
    if (this.over) return;
    var n = this.players.length, steps = 0;
    do {
      this.cur = (this.cur + 1) % n;
      steps++;
    } while (!this.players[this.cur].alive && steps <= n);
    if (!this.players[this.cur].alive) { this.checkOver(); return; }
    this.turnIdx++;
    if (!keepPrefix) {
      var np = this._nextPrefixFrom(prevWord, this.turnIdx);
      if (!np) np = this._nextPrefixFrom(null, this.turnIdx); // jaga-jaga
      if (np) this.prefix = np.prefix;
    }
    this.turnStart = now;
    this._scheduleBot(now);
    this._emitTurn();
  };

  GameRoom.prototype.checkOver = function () {
    if (this.over) return true;
    var alive = this.alivePlayers();
    if (this.players.length === 1) {
      if (alive.length === 0) { this.endGame(null); return true; }
      return false;
    }
    if (alive.length <= 1) { this.endGame(alive[0] ? alive[0].id : null); return true; }
    return false;
  };

  GameRoom.prototype.endGame = function (winnerId) {
    this.over = true;
    this.running = false;
    this.winnerId = winnerId;
    this.emit({
      type: "gameover",
      winnerId: winnerId,
      stats: this.players.map(function (p) {
        return { id: p.id, name: p.name, bot: p.bot, lives: p.lives, alive: p.alive, words: p.words.slice() };
      })
    });
  };

  /* ---------------- Ekspor ---------------- */

  return {
    MODES: MODES,
    MAX_LIVES: MAX_LIVES,
    WRONG_FOR_LIFE: WRONG_FOR_LIFE,
    BANNED_SUFFIX: BANNED_SUFFIX,
    NOISE: NOISE,
    Dict: Dict,
    PrefixEngine: PrefixEngine,
    GameRoom: GameRoom,
    validate: validate,
    normalizeWord: normalizeWord,
    subsequences: subsequences,
    isSubseq: isSubseq,
    effectiveSuffixIndex: effectiveSuffixIndex
  };
});
