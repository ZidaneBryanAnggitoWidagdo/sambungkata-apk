/* =============================================================
 * app.js — UI + jaringan Sambung Kata (WebView / browser)
 * Semua logika permainan ada di engine.js; app.js hanya mengatur
 * tampilan, penyimpanan lokal, dan komunikasi online.
 * ============================================================= */
"use strict";
(function () {
  var APP_VERSION = "1.2.0";
  var ENGINE = window.Engine;
  var dict = null;

  /* ---------------- util ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }
  function modal(html) {
    $("modal-card").innerHTML = html;
    $("modal-root").classList.add("on");
  }
  function closeModal() { $("modal-root").classList.remove("on"); }
  function confirmBox(title, desc, okLabel, onOk, danger) {
    modal(
      '<div class="h2" style="margin-bottom:6px">' + esc(title) + '</div>' +
      '<div class="muted">' + esc(desc) + '</div>' +
      '<div class="row mt16">' +
      '<button class="btn" id="cf-no">Batal</button>' +
      '<button class="btn ' + (danger ? "danger" : "primary") + '" id="cf-yes">' + esc(okLabel) + '</button>' +
      '</div>'
    );
    $("cf-no").onclick = closeModal;
    $("cf-yes").onclick = function () { closeModal(); onOk(); };
  }

  /* ---------------- penyimpanan ---------------- */
  function sget(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function sset(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var profile = sget("sk_profile", null);
  if (!profile) {
    profile = { name: "guest", stats: { games: 0, wins: 0, wordsUsed: 0, bestChain: 0, byMode: { easy: 0, normal: 0, hard: 0 } } };
    sset("sk_profile", profile);
  }
  var kamusPribadi = sget("sk_kamus", {}); // word -> {n: count, t: firstSeen, l: lastSeen}

  /* tangga gelar — 5.000 kata unik = puncak */
  var TITLES = [
    [0, "Pemula Kata"],
    [250, "Penjelajah Kata"],
    [1000, "Kolektor Kata"],
    [2500, "Ahli Basa"],
    [4000, "Sastrawan"],
    [5000, "Mahaguru Kata"]
  ];
  function titleFor(n) {
    var t = TITLES[0][1];
    for (var i = 0; i < TITLES.length; i++) if (n >= TITLES[i][0]) t = TITLES[i][1];
    return t;
  }
  function titleProgress(n) {
    for (var i = TITLES.length - 1; i >= 0; i--) {
      if (n >= TITLES[i][0]) {
        if (i === TITLES.length - 1) return { title: TITLES[i][1], next: null, need: 0 };
        var next = TITLES[i + 1];
        return { title: TITLES[i][1], next: next, need: next[0] - n };
      }
    }
    return { title: TITLES[0][1], next: TITLES[1], need: TITLES[1][0] - n };
  }
  function uniqueWordCount() { return Object.keys(kamusPribadi).length; }

  var _lastTitle = titleFor(uniqueWordCount());
  function saveWord(w) {
    if (!w) return false;
    var isNew = !kamusPribadi[w];
    if (isNew) kamusPribadi[w] = { n: 1, t: Date.now(), l: Date.now() };
    else { kamusPribadi[w].n++; kamusPribadi[w].l = Date.now(); }
    sset("sk_kamus", kamusPribadi);
    if (isNew) {
      profile.stats.wordsUsed = uniqueWordCount();
      sset("sk_profile", profile);
      var t = titleFor(uniqueWordCount());
      if (t !== _lastTitle) {
        _lastTitle = t;
        if (t === "Mahaguru Kata") {
          modal('<div style="text-align:center">' +
            '<div class="logo-row" style="justify-content:center;margin-bottom:12px">' + tiles("KATA", "teal") + '</div>' +
            '<div class="h1" style="color:#5adfc9">GELAR TERTINGGI!</div>' +
            '<div class="muted mt8">Luar biasa! Kamusmu mencapai <b style="color:#ffd88a">5.000 kata unik</b>.' +
            '<br>Kini kamu resmi menjadi <b style="color:#ffd88a">Mahaguru Kata</b>.</div>' +
            '<button class="btn primary mt16" id="md-ok">Terima Kasih</button></div>');
          $("md-ok").onclick = closeModal;
        } else {
          toast("Gelar baru: " + t + "!");
        }
      }
    }
    return isNew;
  }

  /* ---------------- navigasi layar ---------------- */
  var SCREENS = ["load", "menu", "play", "diff", "game", "over", "kamus", "profil", "kredit", "online", "host", "join", "client"];
  var _cur = "load";
  var _prev = [];
  function show(name, keepHistory) {
    if (!keepHistory && _cur !== name) _prev.push(_cur);
    SCREENS.forEach(function (s) { $("scr-" + s).classList.toggle("on", s === name); });
    _cur = name;
  }
  function goBack() {
    var p = _prev.pop();
    if (!p || p === "game" || p === "load") { show("menu", true); _prev = []; }
    else show(p, true);
  }

  /* ---------------- dekorasi ---------------- */
  function tiles(word, cls, size) {
    var out = "";
    for (var i = 0; i < word.length; i++) {
      out += '<span class="tile ' + (cls || "") + '" style="' + (size || "") + '">' + esc(word[i]) + '</span>';
    }
    return out;
  }

  /* ---------------- kotak huruf ketikan ----------------
   * Ketikan pemain direkam sebagai kotak huruf di atas label giliran:
   * ngetik → kotak muncul, hapus → kotak hilang, kirim → hijau (benar)
   * / merah (salah). Input asli tersembunyi (opacity:0) menutupi area
   * kotak, jadi tap di sana langsung memunculkan keyboard.
   */
  function renderTyped(state) {
    var wrap = $("typed-tiles");
    var inp = $("word-input");
    if (!wrap || !inp) return;
    if (Date.now() < _typedFreeze) return; // kotak berwarna sedang ditahan
    var v = (inp.value || "").toLowerCase().replace(/[^a-z]/g, "");
    var html = "";
    for (var i = 0; i < v.length; i++) html += '<span class="tb">' + esc(v.charAt(i)) + '</span>';
    var wait = inp.disabled;
    if (!v.length) html = '<span class="ph">' + (wait ? "menunggu giliranmu…" : "ketik kata di sini…") + '</span>';
    wrap.innerHTML = html;
    if (state) {
      wrap.classList.remove("ok", "bad"); void wrap.offsetWidth;
      wrap.classList.add(state);
    } else {
      wrap.classList.remove("ok", "bad");
    }
    var tw = $("typed-wrap");
    if (tw) tw.classList.toggle("typing", !!v.length);
  }

  function resetTyped() {
    var inp = $("word-input");
    if (inp) inp.value = "";
    if (Date.now() >= _typedFreeze) renderTyped(null);
  }

  /* Freeze: kotak berwarna (hijau/merah) TAHAN tampil ±1 detik meski
   * giliran langsung berganti — ketikan baru membatalkan freeze. */
  var _typedFreeze = 0;
  function flashTyped(state, word) {
    var wrap = $("typed-tiles");
    if (!wrap) return;
    var v = (word || "").toLowerCase();
    var html = "";
    for (var i = 0; i < v.length; i++) html += '<span class="tb">' + esc(v.charAt(i)) + '</span>';
    if (!v.length) html = '<span class="ph">…</span>';
    wrap.innerHTML = html;
    wrap.classList.remove("ok", "bad"); void wrap.offsetWidth; wrap.classList.add(state);
    _typedFreeze = Date.now() + 1000;
    setTimeout(function () { _typedFreeze = 0; renderTyped(null); }, 1000);
  }

  /* ---------------- deteksi keyboard (IME) ----------------
   * Saat keyboard terbuka visualViewport menyusut — tandai body.kb-open
   * supaya CSS merapatkan konten game ke atas dan kotak huruf + tombol
   * kirim tidak tertutup keyboard di layar kecil.
   */
  var vvMaxH = 0;
  function kbCheck() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : window.innerHeight;
    if (h > vvMaxH) vvMaxH = h;
    var open = vvMaxH > 0 && h < vvMaxH * 0.72;
    document.body.classList.toggle("kb-open", open);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", kbCheck);
    window.visualViewport.addEventListener("scroll", kbCheck);
  } else {
    window.addEventListener("resize", kbCheck);
  }
  kbCheck(); // baseline tinggi viewport (penting utk deteksi pertama)
  function buildBg() {
    var bg = $("bg");
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (var i = 0; i < 16; i++) {
      var s = 30 + Math.floor(Math.random() * 60);
      var d = el("div", "ft", letters[(Math.random() * 26) | 0]);
      d.style.width = s + "px"; d.style.height = s + "px";
      d.style.fontSize = (s * 0.5) + "px";
      d.style.left = (Math.random() * 96) + "%";
      var dur = 16 + Math.random() * 26;
      d.style.animationDuration = dur + "s";
      d.style.animationDelay = (-Math.random() * dur) + "s";
      bg.appendChild(d);
    }
  }

  /* ---------------- profil ---------------- */
  var RE_NAME = /^[A-Za-z0-9_]{1,15}$/;
  function refreshProfileUI() {
    $("m-profil-name").textContent = profile.name;
    $("pr-av").textContent = (profile.name || "g").charAt(0);
    var st = profile.stats;
    $("pr-stats").innerHTML =
      statCell(st.games, "Permainan") + statCell(st.wins, "Menang") +
      statCell(st.wordsUsed, "Kata Unik") + statCell(st.bestChain, "Rantai Terbaik");
  }
  function statCell(v, label) {
    return '<div class="stat-cell"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ---------------- kamusku ---------------- */
  function renderKamus(filter) {
    var words = Object.keys(kamusPribadi).sort();
    if (filter) words = words.filter(function (w) { return w.indexOf(filter) === 0; });
    words.sort(function (a, b) { return kamusPribadi[b].n - kamusPribadi[a].n || (a < b ? -1 : 1); });
    var n = uniqueWordCount();
    $("kamus-total").textContent = n;
    var pr = titleProgress(n);
    $("kamus-title").textContent = "Gelar: " + pr.title;
    $("kamus-next").textContent = pr.next
      ? (pr.need + " kata lagi menuju \"" + pr.next[1] + "\" (" + pr.next[0] + " kata)")
      : "Gelar tertinggi tercapai!";
    var list = $("kamus-list");
    list.innerHTML = "";
    if (!words.length) {
      list.appendChild(el("div", "muted", "Belum ada kata. Mainkan permainan untuk mengumpulkan kata — kata yang kamu pakai otomatis tersimpan di sini."));
    }
    var frag = document.createDocumentFragment();
    words.slice(0, 400).forEach(function (w) {
      var row = el("div", "krow");
      row.innerHTML = '<span class="kw">' + esc(w) + '</span><span class="kc">dipakai ' + kamusPribadi[w].n + 'x</span>';
      frag.appendChild(row);
    });
    list.appendChild(frag);
    var ladder = $("title-ladder");
    ladder.innerHTML = "";
    TITLES.forEach(function (t) {
      var r = el("div", "trow" + (n >= t[0] ? " reached" : ""));
      r.innerHTML = '<span class="tdot"></span><b style="min-width:52px">' + t[0] + '</b> ' + t[1] + (n >= t[0] ? " &check;" : "");
      ladder.appendChild(r);
    });
  }

  /* ================================================================
   * PERMAINAN OFFLINE (singleplayer vs bot, main sendiri)
   * ================================================================ */
  var G = null; // objek game aktif

  var REASON_TXT = {
    kosong: "kosong", pendek: "terlalu pendek", format: "karakter tidak sah",
    awalan: "salah awalan", kbbi: "tidak ada di KBBI", ulang: "kata sudah dipakai",
    jalan_buntu: "akan membuat rantai buntu — cari kata lain"
  };

  function heartSvg(on) {
    return '<svg viewBox="0 0 24 24" fill="' + (on ? "#ff5d6c" : "#3a4570") + '"><path d="M12 21s-7.5-4.7-10-9.2C.4 8.6 2.4 5 6 5c2.2 0 3.6 1.2 4.4 2.5.4.6 1.2.6 1.6 0C12.8 6.2 14.2 5 16.4 5c3.6 0 5.6 3.6 4 6.8C19.5 16.3 12 21 12 21z"/></svg>';
  }

  function OfflineGame(mode, kind) {
    this.mode = mode;
    this.kind = kind; // 'sp' | 'solo'
    var self = this;
    var me = { id: "ME", name: profile.name };
    var players = [me];
    if (kind === "sp") players.push({ id: "BOT", name: "Robot", bot: true });
    this.room = new ENGINE.GameRoom(dict, mode, {
      players: players,
      onEvent: function (ev) { self.onEvent(ev); }
    });
    this.ticker = null;
    this.chainNow = 0;
  }

  OfflineGame.prototype.start = function () {
    var self = this;
    $("g-mode").textContent = this.mode.toUpperCase() + (this.kind === "sp" ? " · VS BOT" : " · SOLO");
    $("feed").innerHTML = "";
    resetTyped();
    show("game");
    this.room.start(Date.now());
    this.ticker = setInterval(function () {
      self.room.tick(Date.now());
      self.updateTimer();
    }, 100);
  };

  OfflineGame.prototype.destroy = function () {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    G = null;
  };

  OfflineGame.prototype.updateTimer = function () {
    var rem = Math.max(0, this.room.turnStart + this.room.cfg.time - Date.now());
    var frac = rem / this.room.cfg.time;
    var ring = $("timer-ring");
    var C = 201;
    ring.setAttribute("stroke-dashoffset", String(C * (1 - frac)));
    ring.setAttribute("stroke", frac > 0.5 ? "#5adfc9" : frac > 0.22 ? "#f7a928" : "#ff5d6c");
    $("timer-num").textContent = Math.ceil(rem / 1000);
    $("timer-num").style.color = frac > 0.22 ? "#eef1fb" : "#ff8091";
  };

  OfflineGame.prototype.isMyTurn = function () {
    var p = this.room.currentPlayer();
    return p && p.id === "ME" && this.room.running && !this.room.over;
  };

  OfflineGame.prototype.onEvent = function (ev) {
    var self = this;
    switch (ev.type) {
      case "start":
      case "turn": this.renderTurn(ev); break;
      case "answer_ok":
        this.chainNow++;
        if (ev.playerId === "ME") {
          var isNew = saveWord(ev.word);
          feedItem(ev, true, isNew ? "BARU · masuk Kamusku" : "");
          profile.stats.bestChain = Math.max(profile.stats.bestChain, this.chainNow);
        } else {
          feedItem(ev, true, "");
        }
        sset("sk_profile", profile);
        break;
      case "answer_bad": {
        var p = this.room.byId[ev.playerId];
        feedItem(ev, false, (ev.counted ? ((p ? p.wrong : 0) + "/5 salah") : REASON_TXT[ev.reason]));
        if (ev.playerId === "ME") {
          toast(ev.reason === "jalan_buntu" ? REASON_TXT.jalan_buntu : "Ditolak: " + REASON_TXT[ev.reason] || ev.reason);
        }
        this.renderPlayers();
        break;
      }
      case "timeout":
        this.chainNow = 0;
        feedItem({ playerId: ev.playerId, word: null }, false, "waktu habis");
        break;
      case "life_lost":
        this.renderPlayers();
        var pl = this.room.byId[ev.playerId];
        toast((pl ? pl.name : "?") + " kehilangan nyawa (" + (ev.cause === "timeout" ? "waktu habis" : "5x salah") + ")");
        break;
      case "eliminated":
        this.renderPlayers();
        break;
      case "gameover": this.gameOver(ev); break;
    }
    if (ev.type !== "gameover") this.renderPlayers();
  };

  OfflineGame.prototype.renderTurn = function (ev) {
    var p = this.room.currentPlayer();
    $("prefix-tiles").innerHTML = tiles(this.room.prefix, "", "");
    $("g-sub").textContent = "giliran " + (this.room.turnIdx + 1) + " · " + this.room.used.size + " kata terpakai";
    var mine = this.isMyTurn();
    $("turn-label").innerHTML = mine
      ? "Giliranmu! Sambung dari <b>" + esc(this.room.prefix.toUpperCase()) + "</b>"
      : "<b>" + esc(p ? p.name : "?") + "</b> sedang berpikir...";
    $("word-input").disabled = !mine;
    resetTyped();
    if (mine) $("word-input").focus();
    this.updateTimer();
  };

  OfflineGame.prototype.renderPlayers = function () {
    var strip = $("players-strip");
    var cur = this.room.currentPlayer();
    strip.innerHTML = "";
    var self = this;
    this.room.players.forEach(function (p) {
      var hearts = "";
      for (var i = 0; i < 3; i++) hearts += heartSvg(i < p.lives);
      var dots = "";
      for (var j = 0; j < Math.min(p.wrong, 4); j++) dots += "<i></i>";
      var c = el("div", "pcard" + (cur && cur.id === p.id ? " active" : "") + (p.alive ? "" : " dead"));
      c.innerHTML = '<div class="av">' + esc(p.name.charAt(0)) + '</div>' +
        '<div><div class="pn">' + esc(p.name) + (p.bot ? " 🤖" : "") + '</div>' +
        '<div class="lives">' + hearts + '</div></div>' +
        '<div class="wrongdots" title="salah">' + dots + '</div>';
      strip.appendChild(c);
    });
  };

  function feedItem(ev, ok, extra) {
    var feed = $("feed");
    var p = G && G.room.byId[ev.playerId];
    var name = p ? p.name : (ev.playerName || "?");
    var row = el("div", "fitem " + (ok ? "ok" : "bad"));
    row.innerHTML = '<span class="fn">' + esc(name) + '</span>' +
      '<span class="fw">' + esc(ev.word ? ev.word : (ok ? "" : "—")) + '</span>' +
      '<span class="fr">' + esc(extra || "") + '</span>';
    feed.appendChild(row);
    while (feed.children.length > 6) feed.removeChild(feed.firstChild);
  }

  OfflineGame.prototype.gameOver = function (ev) {
    var self = this;
    this.destroy();
    var isWin = ev.winnerId === "ME";
    var solo = this.kind === "solo";
    var myWords = 0;
    ev.stats.forEach(function (s) { if (s.id === "ME") myWords = s.words.length; });
    profile.stats.games++;
    profile.stats.byMode[this.mode] = (profile.stats.byMode[this.mode] || 0) + 1;
    if (isWin) profile.stats.wins++;
    sset("sk_profile", profile);
    refreshProfileUI();

    $("over-tiles").innerHTML = tiles(isWin ? "MENANG" : solo ? "TAMAT" : "KALAH", isWin ? "" : "red", "");
    $("over-title").textContent = solo ? "Permainan Selesai" : isWin ? "Kamu Bertahan!" : "Robot Menang";
    $("over-sub").textContent = solo
      ? "Perjalanan monologmu berakhir — kata-katamu tersimpan di Kamusku."
      : isWin ? "Kamu terakhir yang bertahan. Luar biasa!" : "Bot tak terkalahkan kali ini. Coba lagi!";

    var html = '<div class="statrow"><span>Kata yang kamu sambung</span><b>' + myWords + '</b></div>' +
      '<div class="statrow"><span>Kata baru masuk Kamusku</span><b>+' + (this._newWords || 0) + '</b></div>' +
      '<div class="statrow"><span>Total kata unik Kamusku</span><b>' + uniqueWordCount() + '</b></div>';
    ev.stats.forEach(function (s) {
      html += '<div class="statrow"><span>' + esc(s.name) + (s.bot ? " (bot)" : "") + '</span><b>' + s.words.length + ' kata · ' + s.lives + ' nyawa</b></div>';
    });
    $("over-stats").innerHTML = html;

    $("over-again").onclick = function () { startOffline(self.mode, self.kind); };
    $("over-menu").onclick = function () { show("menu", true); _prev = []; };
    show("over");
  };
  OfflineGame.prototype._newWords = 0;

  function startOffline(mode, kind) {
    if (G) G.destroy();
    var g = new OfflineGame(mode, kind);
    G = g;
    g._newWords = 0;
    g.start();
  }

  /* submit jawaban — routing 3 jalur:
   *  1) offline  : G (singleplayer / solo)
   *  2) online   : HOST — submit langsung ke GameRoom lokal
   *  3) online   : CLIENT — kirim ke host lewat gmsg {k:"answer"}
   */
  function submitMyWord() {
    var inp = $("word-input");
    if (inp.disabled) return;
    var w = inp.value;
    if (!w) return;
    /* 1) offline */
    if (G) {
      if (!G.isMyTurn()) return;
      var before = uniqueWordCount();
      var res = G.room.submit("ME", w, Date.now());
      if (uniqueWordCount() > before) G._newWords++;
      if (res.ok) { inp.value = ""; flashTyped("ok", res.word); }
      else flashTyped("bad", res.word || w);
      inp.focus();
      return;
    }
    /* 2) online HOST */
    if (Host.active && Host.inGame && Host.room) {
      if (!Host.room.running || Host.room.over) return;
      var cur = Host.room.currentPlayer();
      if (!cur || cur.id !== "H") return;
      var res2 = Host.room.submit("H", w, Date.now());
      if (res2.ok) { inp.value = ""; flashTyped("ok", res2.word); }
      else flashTyped("bad", res2.word || w);
      inp.focus();
      return;
    }
    /* 3) online CLIENT */
    if (Client.active && Client.phase === "ingame") {
      if (Client.curPlayerId !== Client.myId) return; // bukan giliranmu
      send({ t: "gmsg", d: { k: "answer", word: w } });
      return; // input dibersihkan saat balasan "answer ok" dari host tiba
    }
  }

  /* ================================================================
   * ONLINE — jembatan Android + WebSocket
   * Kotlin menyediakan: startServer/stopServer/discoverRooms/getMyIp/
   * wsConnect/wsSend/wsClose + Bluetooth: btStartHost/btConnect/btSend/...
   * Event masuk lewat window.__onBridgeEvent.
   * Di browser (tanpa bridge) online dinonaktifkan dengan pesan jelas.
   * ================================================================ */
  var HAS_BRIDGE = typeof window.AndroidBridge !== "undefined" &&
    typeof window.AndroidBridge.startServer === "function";
  var HAS_BT = HAS_BRIDGE && typeof window.AndroidBridge.btStartHost === "function";

  /* kanal koneksi yang dipilih di lobi online: 'wifi' | 'bt' */
  var Online = { channel: "wifi" };

  /* ---- adapter koneksi (1 koneksi aktif per perangkat) ----
   * NetMode 'ws'  : WebSocket (WiFi/LAN — loopback utk host)
   * NetMode 'bt'  : bridge Bluetooth (RFCOMM via Kotlin)
   */
  var NetMode = "ws";
  var Net = {
    onOpen: null, onMsg: null, onClose: null,
    _ws: null,
    connect: function (url) {
      var self = this;
      if (NetMode === "bt") { setTimeout(function () { self.onOpen && self.onOpen(); }, 0); return; }
      this.close();
      if (HAS_BRIDGE) {
        window.AndroidBridge.wsConnect(url);
      } else if (typeof WebSocket !== "undefined") {
        var ws = new WebSocket(url);
        this._ws = ws;
        ws.onopen = function () { self.onOpen && self.onOpen(); };
        ws.onmessage = function (e) { self.onMsg && self.onMsg(e.data); };
        ws.onclose = function () { self.onClose && self.onClose(); };
        ws.onerror = function () {};
      } else {
        setTimeout(function () { self.onClose && self.onClose(); }, 100);
      }
    },
    send: function (s) {
      if (NetMode === "bt") { try { window.AndroidBridge.btSend(s); } catch (e) {} return; }
      if (HAS_BRIDGE) window.AndroidBridge.wsSend(s);
      else if (this._ws && this._ws.readyState === 1) this._ws.send(s);
    },
    close: function () {
      if (NetMode === "bt") { try { window.AndroidBridge.btDisconnect(); } catch (e) {} return; }
      if (HAS_BRIDGE) { try { window.AndroidBridge.wsClose(); } catch (e) {} }
      else if (this._ws) { try { this._ws.onclose = null; this._ws.close(); } catch (e) {} this._ws = null; }
    }
  };

  function bridgeEvent(ev) {
    /* dipanggil dari Kotlin */
    try {
      if (ev.k === "ws_open") Net.onOpen && Net.onOpen();
      else if (ev.k === "ws_msg") Net.onMsg && Net.onMsg(ev.data);
      else if (ev.k === "ws_close") Net.onClose && Net.onClose();
      else if (ev.k === "bt_open") Net.onOpen && Net.onOpen();
      else if (ev.k === "bt_msg") Net.onMsg && Net.onMsg(ev.data);
      else if (ev.k === "bt_close") Net.onClose && Net.onClose();
      else if (ev.k === "room_found") window.__roomFound && window.__roomFound(ev);
      else if (ev.k === "server_started") window.__serverStarted && window.__serverStarted(ev);
      else if (ev.k === "server_error") window.__serverError && window.__serverError(ev);
      else if (ev.k === "bt_server_started") window.__btServerStarted && window.__btServerStarted(ev);
      else if (ev.k === "bt_server_stopped") window.__btServerStopped && window.__btServerStopped(ev);
      else if (ev.k === "bt_perms") window.__btPerms && window.__btPerms(ev);
      else if (ev.k === "bt_device") window.__btDevice && window.__btDevice(ev);
      else if (ev.k === "bt_scan_done") window.__btScanDone && window.__btScanDone(ev);
      else if (ev.k === "bt_enable_result") window.__btEnableResult && window.__btEnableResult(ev);
      else if (ev.k === "bt_discoverable_result") window.__btDiscResult && window.__btDiscResult(ev);
      else if (ev.k === "bt_error") toast("Bluetooth: " + (ev.err || "gagal"));
    } catch (e) { console.error("bridgeEvent", e); }
  }
  window.__onBridgeEvent = bridgeEvent;

  function send(obj) { Net.send(JSON.stringify(obj)); }

  /* =================== SESI HOST =================== */
  var Host = {
    active: false, pin: "", ip: "", port: 8787, mode: "normal",
    channel: "wifi", btDeviceName: "",
    roster: {}, // id -> {name, ip}
    myId: "H",
    room: null, ticker: null, inGame: false,
    create: function () {
      var self = this;
      if (!HAS_BRIDGE) { toast("Mode online hanya tersedia di aplikasi Android."); return; }
      this.channel = Online.channel;
      this.pin = String(100000 + Math.floor(Math.random() * 900000));
      this.inGame = false;
      this.roster = {};
      if (this.channel === "bt") {
        if (!HAS_BT) { toast("Bluetooth tidak didukung perangkat/versi ini."); return; }
        window.__btServerStarted = function (ev) {
          self.btDeviceName = ev.deviceName || "perangkat ini";
          $("pin-display").textContent = self.pin;
          $("host-ip").textContent = "Bluetooth · " + self.btDeviceName;
          $("host-chan").textContent = "BLUETOOTH";
          $("bt-visible").style.display = "";
          NetMode = "bt";
          self.connectConsole();
        };
        window.AndroidBridge.btStartHost(this.pin, profile.name);
      } else {
        window.__serverStarted = function (ev) {
          self.ip = ev.ip; self.port = ev.port;
          $("pin-display").textContent = self.pin;
          $("host-ip").textContent = "WiFi · IP kamu: " + self.ip + "  ·  port " + self.port;
          $("host-chan").textContent = "WIFI";
          $("bt-visible").style.display = "none";
          self.connectConsole();
        };
        window.__serverError = function (ev) { toast("Gagal membuat server: " + (ev.err || "?")); };
        window.AndroidBridge.startServer(this.pin, profile.name);
      }
      $("pin-display").textContent = "......";
      $("host-ip").textContent = "menyalakan server...";
      $("host-chan").textContent = this.channel === "bt" ? "BLUETOOTH" : "WIFI";
      $("bt-visible").style.display = "none";
      show("host", true); _prev = [];
      this.active = true;
      this.renderPlayers();
    },
    connectConsole: function () {
      var self = this;
      Net.onOpen = function () { /* konsol host tersambung */ };
      Net.onMsg = function (data) { self.onMsg(data); };
      Net.onClose = function () { if (self.active && !self.inGame) toast("Koneksi konsol terputus"); };
      Net.connect("ws://127.0.0.1:" + this.port);
    },
    onMsg: function (data) {
      var m; try { m = JSON.parse(data); } catch (e) { return; }
      var self = this;
      switch (m.t) {
        case "hello": this.myId = m.id || "H"; break;
        case "roster":
          this.roster = {};
          (m.players || []).forEach(function (p) {
            // entri host ("H") dirender terpisah oleh renderPlayers — jangan dobel
            if (p.id !== "H") self.roster[p.id] = { name: p.name };
          });
          this.renderPlayers();
          break;
        case "joined":
          if (this.inGame) {
            // penonton: kirim info game berjalan
            send({ t: "srv_direct", id: m.id, msg: { t: "gmsg", from: "H", name: profile.name, d: { k: "sysmsg", text: "Permainan sedang berjalan — tunggu ronde berikutnya." } } });
          }
          this.renderPlayers();
          addChat("SISTEM", m.name + " masuk room", true);
          break;
        case "left":
          addChat("SISTEM", (this.roster[m.id] ? this.roster[m.id].name : "pemain") + " keluar", true);
          delete this.roster[m.id];
          this.renderPlayers();
          if (this.inGame && this.room) this.hostDropPlayer(m.id);
          break;
        case "gmsg":
          if (this.inGame && this.room) this.hostGameMsg(m);
          break;
        case "chat":
          addChat(m.name, m.text, false);
          break;
      }
    },
    hostGameMsg: function (m) {
      var d = m.d || {};
      if (d.k === "answer" && this.room.running) {
        this.room.submit(m.from, d.word, Date.now());
      } else if (d.k === "chat") {
        addChat(m.name, d.text, false);
      }
    },
    hostDropPlayer: function (id) {
      var p = this.room.byId[id];
      if (p && p.alive) { p.alive = false; this.broadcast({ k: "elim", playerId: id }); this.broadcast({ k: "sysmsg", text: (p.name || "pemain") + " terputus — gugur." }); this.room.checkOver(); }
    },
    renderPlayers: function () {
      var wrap = $("room-players");
      if (!wrap) return;
      wrap.innerHTML = "";
      var count = 1, self = this;
      var meRow = el("div", "rprow host");
      meRow.innerHTML = '<div class="rpname">' + esc(profile.name) + '</div><span class="badge-host">HOST</span>';
      wrap.appendChild(meRow);
      Object.keys(this.roster).forEach(function (id) {
        count++;
        var r = el("div", "rprow");
        r.innerHTML = '<div class="rpname">' + esc(self.roster[id].name) + '</div>' +
          '<button class="iconbtn" style="width:34px;height:34px" data-kick="' + esc(id) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff8091" stroke-width="2.4"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>';
        wrap.appendChild(r);
      });
      $("host-count").textContent = count;
      wrap.querySelectorAll("[data-kick]").forEach(function (b) {
        b.onclick = function () { self.askKick(b.getAttribute("data-kick")); };
      });
      $("host-start").disabled = count < 2 || this.inGame;
      $("host-start").textContent = this.inGame ? "Permainan Berjalan..." : "Mulai Permainan";
    },
    askKick: function (id) {
      var self = this;
      var name = this.roster[id] ? this.roster[id].name : id;
      modal('<div class="h2">Keluarkan ' + esc(name) + '?</div>' +
        '<div class="muted mt8">Pemain tidak bisa masuk selama 30 detik. Jika mencoba masuk lagi saat masih diblokir, waktunya digandakan.</div>' +
        '<input id="kick-reason" placeholder="alasan (dikirim ke pemain)" style="width:100%;border:2px solid #303a5f;background:#171d33;color:#eef1fb;border-radius:12px;padding:12px 14px;font-family:inherit;margin-top:12px;outline:none">' +
        '<div class="row mt16"><button class="btn" id="kk-no">Batal</button><button class="btn danger" id="kk-yes">Keluarkan</button></div>');
      $("kk-no").onclick = closeModal;
      $("kk-yes").onclick = function () {
        var reason = $("kick-reason").value.trim() || "dikeluarkan host";
        send({ t: "srv_kick", id: id, reason: reason });
        closeModal();
      };
    },
    broadcast: function (d) { send({ t: "gmsg", d: d }); },
    startGame: function () {
      var self = this;
      if (Object.keys(this.roster).length < 1) { toast("Butuh minimal 1 pemain lain."); return; }
      this.inGame = true;
      var players = [{ id: "H", name: profile.name }];
      Object.keys(this.roster).forEach(function (id) { players.push({ id: id, name: self.roster[id].name }); });
      var newWords = 0;
      this.room = new ENGINE.GameRoom(dict, this.mode, {
        players: players,
        onEvent: function (ev) { self.onGameEvent(ev); }
      });
      $("chat-box").innerHTML = "";
      addChat("SISTEM", "Permainan dimulai! Mode " + this.mode.toUpperCase(), true);
      /* host ikut pindah ke layar game (dulu hilang — host diam di layar room) */
      show("game", true); _prev = [];
      this.room.start(Date.now());
      this.ticker = setInterval(function () {
        self.room.tick(Date.now());
        if (self.room.running) {
          var rem = Math.max(0, self.room.turnStart + self.room.cfg.time - Date.now());
          var frac = rem / self.room.cfg.time;
          var ring = $("timer-ring"); var C = 201;
          ring.setAttribute("stroke-dashoffset", String(C * (1 - frac)));
          ring.setAttribute("stroke", frac > 0.5 ? "#5adfc9" : frac > 0.22 ? "#f7a928" : "#ff5d6c");
          $("timer-num").textContent = Math.ceil(rem / 1000);
        }
      }, 100);
    },
    onGameEvent: function (ev) {
      var self = this;
      if (ev.type === "start") {
        this.broadcast({ k: "hello", phase: "ingame", mode: this.mode, hostName: profile.name });
      }
      if (ev.type === "turn") {
        this.broadcast({ k: "turn", n: ev.n, playerId: ev.playerId, playerName: ev.playerName, prefix: ev.prefix, seconds: ev.seconds });
        this.renderGameTurn();
      } else if (ev.type === "answer_ok") {
        this.broadcast({ k: "answer", playerId: ev.playerId, word: ev.word, ok: true });
        if (ev.playerId === "H") saveWord(ev.word);
        this.renderGameFeed(ev.playerId, ev.word, true, "");
      } else if (ev.type === "answer_bad") {
        var p = this.room.byId[ev.playerId];
        this.broadcast({ k: "answer", playerId: ev.playerId, word: ev.word, ok: false, reason: ev.reason, counted: ev.counted });
        this.renderGameFeed(ev.playerId, ev.word, false, (ev.counted ? ((p ? p.wrong : 0) + "/5 salah") : REASON_TXT[ev.reason]));
      } else if (ev.type === "timeout") {
        this.broadcast({ k: "timeout", playerId: ev.playerId });
        this.renderGameFeed(ev.playerId, null, false, "waktu habis");
      } else if (ev.type === "life_lost") {
        var pl = this.room.byId[ev.playerId];
        this.broadcast({ k: "life", playerId: ev.playerId, lives: ev.lives, cause: ev.cause });
        toast((pl ? pl.name : "?") + " kehilangan nyawa");
      } else if (ev.type === "eliminated") {
        this.broadcast({ k: "elim", playerId: ev.playerId });
      } else if (ev.type === "gameover") {
        this.inGame = false;
        clearInterval(this.ticker);
        this.broadcast({ k: "over", winnerId: ev.winnerId, stats: ev.stats });
        this.showGameOver(ev);
      }
      this.renderPlayers();
    },
    renderGameTurn: function () {
      var p = this.room.currentPlayer();
      $("g-mode").textContent = this.mode.toUpperCase() + " · ONLINE";
      $("g-sub").textContent = "giliran " + (this.room.turnIdx + 1) + " · " + this.room.used.size + " kata";
      $("prefix-tiles").innerHTML = tiles(this.room.prefix, "", "");
      var mine = p && p.id === "H" && this.room.running;
      $("turn-label").innerHTML = mine
        ? "Giliranmu! Sambung dari <b>" + esc(this.room.prefix.toUpperCase()) + "</b>"
        : "<b>" + esc(p ? p.name : "?") + "</b> sedang berpikir...";
      $("word-input").disabled = !mine;
      resetTyped();
      if (mine) $("word-input").focus();
      this.renderGamePlayers();
    },
    renderGamePlayers: function () {
      var strip = $("players-strip");
      var cur = this.room.currentPlayer();
      strip.innerHTML = "";
      var self = this;
      this.room.players.forEach(function (p) {
        var hearts = "";
        for (var i = 0; i < 3; i++) hearts += heartSvg(i < p.lives);
        var dots = "";
        for (var j = 0; j < Math.min(p.wrong, 4); j++) dots += "<i></i>";
        var c = el("div", "pcard" + (cur && cur.id === p.id ? " active" : "") + (p.alive ? "" : " dead"));
        c.innerHTML = '<div class="av">' + esc((p.name || "?").charAt(0)) + '</div>' +
          '<div><div class="pn">' + esc(p.name || "?") + '</div>' +
          '<div class="lives">' + hearts + '</div></div>' +
          '<div class="wrongdots">' + dots + '</div>';
        strip.appendChild(c);
      });
    },
    renderGameFeed: function (pid, word, ok, extra) {
      var p = this.room.byId[pid];
      feedItem({ playerId: pid, word: word, playerName: p ? p.name : "?" }, ok, extra);
    },
    showGameOver: function (ev) {
      var isWin = ev.winnerId === "H";
      $("over-tiles").innerHTML = tiles(isWin ? "MENANG" : "TAMAT", isWin ? "" : "red", "");
      $("over-title").textContent = isWin ? "Kamu Bertahan!" : "Permainan Selesai";
      $("over-sub").textContent = ev.winnerId
        ? "Pemenang: " + esc((this.room.byId[ev.winnerId] || {}).name || "?")
        : "Tidak ada pemenang.";
      var html = "";
      ev.stats.forEach(function (s) {
        html += '<div class="statrow"><span>' + esc(s.name) + '</span><b>' + s.words.length + ' kata · ' + s.lives + ' nyawa</b></div>';
      });
      $("over-stats").innerHTML = html;
      $("over-again").onclick = function () { show("host", true); _prev = []; };
      $("over-menu").onclick = function () { show("menu", true); _prev = []; };
      show("over");
    },
    stop: function () {
      this.active = false; this.inGame = false;
      if (this.ticker) clearInterval(this.ticker);
      if (this.room) { this.room.over = true; this.room.running = false; }
      try { this.broadcast({ k: "sysmsg", text: "Host menutup room." }); } catch (e) {}
      Net.close();
      if (this.channel === "bt") {
        if (HAS_BT) { try { window.AndroidBridge.btStopHost(); } catch (e) {} }
        NetMode = "ws";
      } else if (HAS_BRIDGE) { try { window.AndroidBridge.stopServer(); } catch (e) {} }
      this.roster = {};
    }
  };

  /* =================== SESI CLIENT =================== */
  var Client = {
    active: false, pin: "", ip: "", port: 8787,
    channel: "wifi", btAddr: "",
    myId: null, name: "",
    phase: "lobby", mode: null,
    players: [], // [{id,name,lives,alive}] — dari broadcast host
    turnDeadline: 0, curPlayerId: null, prefix: "",
    bannedUntil: 0, banTimer: null,
    join: function (ip, pin) {
      var self = this;
      this.ip = ip; this.pin = pin; this.name = profile.name;
      this.port = 8787;
      this.channel = "wifi";
      this.active = true;
      Net.onOpen = function () { self.sendJoin(); };
      Net.onMsg = function (data) { self.onMsg(data); };
      Net.onClose = function () {
        if (!self.active) return;
        if (self.phase === "joining") toast("Tidak bisa terhubung ke " + ip + " — cek IP/jaringan.");
        else if (self.phase !== "banned" && self.phase !== "kicked") toast("Koneksi ke host terputus.");
        self.phase = "disconnected";
      };
      this.phase = "joining";
      NetMode = "ws";
      Net.connect("ws://" + ip + ":" + this.port);
    },
    /* masuk lewat Bluetooth — addr = MAC perangkat host */
    joinBt: function (addr, pin) {
      var self = this;
      this.btAddr = addr; this.pin = pin; this.name = profile.name;
      this.channel = "bt";
      this.active = true;
      Net.onOpen = function () { self.sendJoin(); };
      Net.onMsg = function (data) { self.onMsg(data); };
      Net.onClose = function () {
        if (!self.active) return;
        if (self.phase === "joining") toast("Tidak bisa terhubung ke perangkat host.");
        else if (self.phase !== "banned" && self.phase !== "kicked") toast("Koneksi Bluetooth terputus.");
        self.phase = "disconnected";
      };
      this.phase = "joining";
      NetMode = "bt";
      $("bt-status").textContent = "menyambung ke " + addr + "...";
      try { window.AndroidBridge.btConnect(addr); } catch (e) {
        toast("Gagal memulai koneksi Bluetooth.");
      }
    },
    sendJoin: function () {
      send({ t: "join", pin: this.pin, name: this.name });
    },
    onMsg: function (data) {
      var m; try { m = JSON.parse(data); } catch (e) { return; }
      var self = this;
      switch (m.t) {
        case "join_rejected":
          if (m.reason === "banned") {
            self.showBanned(m.wait || 30, "Kamu masih diblokir dari room ini.");
          } else if (m.reason === "pin") {
            toast("PIN salah — coba lagi.");
          } else if (m.reason === "full") {
            toast("Room penuh (maks 13 pemain).");
            self.leave();
          } else if (m.reason === "started") {
            toast("Permainan sudah berjalan — tunggu ronde berikutnya.");
          }
          break;
        case "joined_ok":
          self.myId = m.id;
          self.phase = "lobby";
          $("client-pin").textContent = self.pin;
          $("client-status").textContent = "menunggu host memulai...";
          show("client", true); _prev = [];
          self.renderPlayers2(m.players || []);
          break;
        case "roster":
          if (self.phase === "lobby") self.renderPlayers2(m.players || []);
          break;
        case "kicked":
          self.showKicked(m.reason || "dikeluarkan host", m.wait || 30);
          break;
        case "gmsg":
          self.onGame(m.d || {}, m);
          break;
        case "chat":
          addChat(m.name, m.text, false);
          break;
      }
    },
    onGame: function (d, raw) {
      var self = this;
      switch (d.k) {
        case "hello":
          self.phase = "ingame";
          self.mode = d.mode || self.mode;
          $("client-status").textContent = "permainan berjalan — mode " + (d.mode || "").toUpperCase();
          /* host memulai permainan — pindah ke layar game */
          show("game", true); _prev = [];
          break;
        case "turn":
          self.prefix = d.prefix;
          self.curPlayerId = d.playerId;
          self.turnDeadline = Date.now() + (d.seconds || 15) * 1000;
          $("g-mode").textContent = (Client.mode || "").toUpperCase() + " · ONLINE";
          $("g-sub").textContent = "giliran " + ((d.n || 0) + 1);
          $("prefix-tiles").innerHTML = tiles(d.prefix, "", "");
          var mine = d.playerId === self.myId;
          $("turn-label").innerHTML = mine
            ? "Giliranmu! Sambung dari <b>" + esc(d.prefix.toUpperCase()) + "</b>"
            : "<b>" + esc(d.playerName || "?") + "</b> sedang berpikir...";
          $("word-input").disabled = !mine;
          resetTyped();
          if (mine) $("word-input").focus();
          self.renderGamePlayers();
          break;
        case "answer":
          feedItem({ playerId: d.playerId, playerName: self.nameOf(d.playerId), word: d.word }, d.ok,
            d.ok ? "" : (d.counted ? REASON_TXT[d.reason] || d.reason : "ditolak: " + (REASON_TXT[d.reason] || d.reason)));
          if (d.ok && d.playerId === self.myId) {
            saveWord(d.word);
            var wi = $("word-input");
            if (wi) { wi.value = ""; wi.focus(); }
          }
          /* kotak hurufku berubah hijau (benar) / merah (salah) */
          if (d.playerId === self.myId) flashTyped(d.ok ? "ok" : "bad", d.word);
          break;
        case "timeout":
          feedItem({ playerId: d.playerId, playerName: self.nameOf(d.playerId), word: null }, false, "waktu habis");
          break;
        case "life": {
          var p = self.players.find(function (x) { return x.id === d.playerId; });
          if (p) p.lives = d.lives;
          self.renderGamePlayers();
          toast(self.nameOf(d.playerId) + " kehilangan nyawa (" + (d.cause === "timeout" ? "waktu habis" : "5x salah") + ")");
          break;
        }
        case "elim": {
          var p2 = self.players.find(function (x) { return x.id === d.playerId; });
          if (p2) p2.alive = false;
          self.renderGamePlayers();
          break;
        }
        case "over":
          self.showGameOver(d);
          break;
        case "sysmsg":
          toast(d.text || "");
          break;
        case "chat":
          addChat(d.name || raw.name, d.text, false);
          break;
      }
    },
    nameOf: function (id) {
      if (id === this.myId) return this.name;
      var p = this.players.find(function (x) { return x.id === id; });
      return p ? p.name : (id === "H" ? "HOST" : "?");
    },
    renderPlayers2: function (list) {
      this.players = list.map(function (p) {
        return { id: p.id, name: p.name, lives: (p.lives == null ? 3 : p.lives), alive: (p.alive == null ? true : p.alive) };
      });
      var wrap = $("room-players2");
      if (!wrap) return;
      wrap.innerHTML = "";
      var self = this;
      list.forEach(function (p) {
        var r = el("div", "rprow" + (p.id === "H" ? " host" : ""));
        r.innerHTML = '<div class="rpname">' + esc(p.name) + '</div>' + (p.id === "H" ? '<span class="badge-host">HOST</span>' : "");
        wrap.appendChild(r);
      });
    },
    renderGamePlayers: function () {
      var strip = $("players-strip");
      strip.innerHTML = "";
      var self = this;
      this.players.forEach(function (p) {
        var hearts = "";
        for (var i = 0; i < 3; i++) hearts += heartSvg(i < p.lives);
        var c = el("div", "pcard" + (self.curPlayerId === p.id ? " active" : "") + (p.alive === false ? " dead" : ""));
        c.innerHTML = '<div class="av">' + esc((p.name || "?").charAt(0)) + '</div>' +
          '<div><div class="pn">' + esc(p.name || "?") + '</div><div class="lives">' + hearts + '</div></div>';
        strip.appendChild(c);
      });
    },
    showGameOver: function (d) {
      this.phase = "over";
      var isWin = d.winnerId === this.myId;
      $("over-tiles").innerHTML = tiles(isWin ? "MENANG" : "TAMAT", isWin ? "" : "red", "");
      $("over-title").textContent = isWin ? "Kamu Bertahan!" : "Permainan Selesai";
      $("over-sub").textContent = d.winnerId ? "Pemenang: " + esc(this.nameOf(d.winnerId)) : "Tidak ada pemenang.";
      var html = "";
      (d.stats || []).forEach(function (s) {
        html += '<div class="statrow"><span>' + esc(s.name) + '</span><b>' + s.words.length + ' kata · ' + s.lives + ' nyawa</b></div>';
      });
      $("over-stats").innerHTML = html;
      $("over-again").textContent = "Kembali ke Room";
      $("over-again").onclick = function () {
        $("over-again").textContent = "Main Lagi";
        show("client", true); _prev = [];
        Client.phase = "lobby";
        $("client-status").textContent = "menunggu host...";
      };
      $("over-menu").onclick = function () { Client.leave(); show("menu", true); _prev = []; };
      show("over");
    },
    showKicked: function (reason, wait) {
      this.phase = "kicked";
      var self = this;
      Net.close();
      $("overlay-card").innerHTML =
        '<div style="font-size:44px;font-weight:900;color:#ff8091">DIKELUARKAN</div>' +
        '<div class="muted mt8">Alasan: ' + esc(reason) + '</div>' +
        '<div class="muted mt8">Kamu tidak bisa masuk room ini selama <b id="kick-cd">' + wait + '</b> detik.</div>' +
        '<button class="btn danger mt16" id="kick-back">Keluar dari Room</button>';
      $("overlay").classList.add("on");
      $("kick-back").onclick = function () {
        $("overlay").classList.remove("on");
        self.leave();
        show("online", true); _prev = [];
      };
    },
    showBanned: function (wait, msg) {
      this.phase = "banned";
      var self = this;
      var remain = wait;
      $("overlay-card").innerHTML =
        '<div style="font-size:22px;font-weight:900;color:#ff8091">Masih Diblokir</div>' +
        '<div class="muted mt8">' + esc(msg || "") + '</div>' +
        '<div id="ban-count">' + remain + '</div>' +
        '<div class="muted">Jika kamu mencoba masuk lagi sebelum waktunya habis, masa blokir <b>digandakan</b>.</div>' +
        '<div class="row mt16"><button class="btn" id="ban-back">Batal</button><button class="btn danger" id="ban-retry">Coba Masuk Lagi</button></div>';
      $("overlay").classList.add("on");
      clearInterval(this.banTimer);
      this.banTimer = setInterval(function () {
        remain = Math.max(0, remain - 1);
        var bc = $("ban-count");
        if (bc) bc.textContent = remain;
        if (remain <= 0) {
          clearInterval(self.banTimer);
          var br = $("ban-retry");
          if (br) { br.classList.remove("danger"); br.classList.add("teal"); br.textContent = "Masuk Sekarang"; }
        }
      }, 1000);
      $("ban-back").onclick = function () {
        clearInterval(self.banTimer);
        $("overlay").classList.remove("on");
        self.leave();
        show("online", true); _prev = [];
      };
      $("ban-retry").onclick = function () {
        clearInterval(self.banTimer);
        $("overlay").classList.remove("on");
        self.phase = "joining";
        self.sendJoin();
      };
    },
    leave: function () {
      this.active = false;
      clearInterval(this.banTimer);
      Net.close();
      if (this.channel === "bt") NetMode = "ws";
      if (HAS_BT) { try { window.AndroidBridge.btStopScan(); } catch (e) {} }
    }
  };

  /* =================== SCAN BLUETOOTH (layar gabung) =================== */
  var BtScan = {
    devices: {}, // addr -> {name, addr}
    reset: function () { this.devices = {}; var l = $("bt-devices"); if (l) l.innerHTML = ""; },
    add: function (ev) {
      if (!ev.addr || this.devices[ev.addr]) return;
      this.devices[ev.addr] = { name: ev.name || "Perangkat tanpa nama", addr: ev.addr };
      this.render();
    },
    render: function () {
      var list = $("bt-devices");
      if (!list) return;
      var keys = Object.keys(this.devices);
      var empty = $("bt-devices-empty");
      if (empty) empty.style.display = keys.length ? "none" : "";
      list.innerHTML = "";
      var self = this;
      keys.forEach(function (a) {
        var d = self.devices[a];
        var r = el("div", "roomrow");
        r.setAttribute("data-addr", a);
        r.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5adfc9" stroke-width="2"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>' +
          '<span class="rn">' + esc(d.name) + '</span><span class="ri">' + esc(a) + '</span>';
        r.onclick = function () { self.pick(a); };
        list.appendChild(r);
      });
    },
    pick: function (addr) {
      var pin = $("join-pin").value.trim();
      if (!/^[0-9]{6}$/.test(pin)) { toast("Isi PIN 6 digit dari host dulu."); $("join-pin").focus(); return; }
      Client.leave();
      Client.joinBt(addr, pin);
    },
    scanDone: function () {
      var s = $("bt-status");
      if (s) s.textContent = "Pemindaian selesai — pastikan host sudah menekan Buat Room & terlihat (discoverable).";
    }
  };

  /* =================== CHAT =================== */
  function addChat(name, text, sys) {
    var boxes = [$("chat-box"), $("chat-box2"), $("chat-box3")];
    boxes.forEach(function (b) {
      if (!b) return;
      var m = el("div", "cmsg" + (name === profile.name ? " mine" : ""));
      m.innerHTML = sys
        ? '<span class="muted">' + esc(text) + '</span>'
        : '<span class="cn">' + esc(name) + '</span><br>' + esc(text);
      b.appendChild(m);
      b.scrollTop = b.scrollHeight;
      while (b.children.length > 60) b.removeChild(b.firstChild);
    });
  }

  /* =================== DISCOVERY (browser stub & bridge) =================== */
  window.__roomFound = function (ev) {
    var list = $("room-list");
    if (!list) return;
    var empty = $("room-list-empty");
    if (empty) empty.remove();
    var existing = list.querySelector('[data-ip="' + ev.ip + '"]');
    if (existing) return;
    var r = el("div", "roomrow");
    r.setAttribute("data-ip", ev.ip);
    r.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5adfc9" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '<span class="rn">' + esc(ev.name) + '</span><span class="ri">' + esc(ev.ip) + '</span>';
    r.onclick = function () {
      $("join-ip").value = ev.ip;
      $("join-pin").focus();
      toast("Room dipilih — masukkan PIN dari host.");
    };
    list.appendChild(r);
  };

  /* =================== BINDING & INIT =================== */
  function bind() {
    // menu
    $("m-play").onclick = function () { show("play"); };
    $("m-kamus").onclick = function () { renderKamus(""); show("kamus"); };
    $("m-profil").onclick = function () { refreshProfileUI(); show("profil"); };
    $("m-kredit").onclick = function () { show("kredit"); };
    // pilih jenis
    $("p-sp").onclick = function () { show("diff"); _diffTarget = "sp"; };
    $("p-solo").onclick = function () { show("diff"); _diffTarget = "solo"; };
    $("p-online").onclick = function () { show("online"); };
    // kesulitan
    document.querySelectorAll("#diff-list [data-diff]").forEach(function (b) {
      b.onclick = function () { startOffline(b.getAttribute("data-diff"), _diffTarget); };
    });
    // kembali
    document.querySelectorAll("[data-back]").forEach(function (b) {
      b.onclick = function () { goBack(); };
    });
    // kamusku
    $("kamus-search").addEventListener("input", function () {
      renderKamus(this.value.toLowerCase().replace(/[^a-z]/g, ""));
    });
    // profil
    $("name-save").onclick = function () {
      var v = $("name-input").value.trim();
      if (!RE_NAME.test(v)) {
        toast("Nama: maks 15 karakter, hanya huruf/angka/garis bawah, tanpa spesial.");
        $("name-input").classList.add("err");
        setTimeout(function () { $("name-input").classList.remove("err"); }, 400);
        return;
      }
      profile.name = v;
      sset("sk_profile", profile);
      refreshProfileUI();
      $("m-profil-name").textContent = v;
      toast("Nama disimpan: " + v);
    };
    $("pr-reset").onclick = function () {
      confirmBox("Hapus Semua Data?", "Kamusku, profil, dan statistik akan dihapus permanen.", "Hapus", function () {
        localStorage.removeItem("sk_kamus");
        localStorage.removeItem("sk_profile");
        location.reload();
      }, true);
    };
    // kredit
    $("btn-copy-gopay").onclick = function () {
      var num = "+6287802078095";
      if (HAS_BRIDGE && window.AndroidBridge.copyText) { window.AndroidBridge.copyText(num); toast("Nomor disalin: " + num); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(num).then(function () { toast("Nomor disalin: " + num); },
          function () { toast("Nomor GoPay: " + num); });
      } else toast("Nomor GoPay: " + num);
    };
    // game offline — kotak huruf
    $("word-input").addEventListener("input", function () {
      _typedFreeze = 0; // ketikan baru membatalkan tahanan warna
      renderTyped(null);
    });
    $("btn-send").onclick = submitMyWord;
    $("word-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitMyWord(); }
    });
    $("g-exit").onclick = function () {
      /* host online: akhiri permainan, kembali ke room (pemain tetap terhubung) */
      if (Host.active && Host.inGame) {
        confirmBox("Akhiri permainan?", "Permainan online akan diakhiri dan kamu kembali ke room.", "Akhiri", function () {
          if (Host.room) { Host.room.over = true; Host.room.running = false; }
          if (Host.ticker) { clearInterval(Host.ticker); Host.ticker = null; }
          Host.inGame = false;
          try { Host.broadcast({ k: "over", winnerId: null, stats: [] }); } catch (e) {}
          Host.renderPlayers(); // aktifkan lagi tombol "Mulai Permainan"
          show("host", true); _prev = [];
        }, true);
        return;
      }
      /* client online: keluar dari room */
      if (Client.active) {
        confirmBox("Keluar dari room online?", "Kamu akan keluar dari permainan online yang sedang berjalan.", "Keluar", function () {
          Client.leave();
          show("menu", true); _prev = [];
        }, true);
        return;
      }
      confirmBox("Keluar dari permainan?", "Progres ronde ini akan hilang. Kata yang sudah tersimpan tetap aman di Kamusku.", "Keluar", function () {
        if (G) G.destroy();
        show("menu", true); _prev = [];
      }, true);
    };
    // online — pilih kanal & aksi
    document.querySelectorAll("#online-chan button").forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll("#online-chan button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        Online.channel = b.getAttribute("data-ch");
        $("online-hint").textContent = Online.channel === "bt"
          ? "Pakai Bluetooth: host tekan Buat Room, pemain lain pilih nama perangkat host. Tidak butuh internet/WiFi."
          : "Pastikan semua pemain terhubung ke WiFi atau hotspot yang sama. Room terdeteksi otomatis di jaringan yang sama.";
      };
    });
    $("on-create").onclick = function () {
      if (Online.channel === "bt") btGate(function () { Host.create(); });
      else Host.create();
    };
    $("on-join").onclick = function () { showJoinChannel(Online.channel); };
    // tombol "perlihatkan perangkat" di room host BT
    $("bt-visible").onclick = function () {
      if (HAS_BT) { window.AndroidBridge.btMakeDiscoverable(); toast("Izinkan perangkat lain menemukanmu."); }
    };
    // bt scan di layar join
    $("bt-rescan").onclick = function () {
      BtScan.reset();
      $("bt-status").textContent = "memindai perangkat terdekat...";
      if (HAS_BT) window.AndroidBridge.btStartScan();
    };
    $("join-btn").onclick = function () {
      var ip = $("join-ip").value.trim();
      var pin = $("join-pin").value.trim();
      if (!/^[0-9]{6}$/.test(pin)) { toast("PIN harus 6 digit angka."); return; }
      if (!/^[0-9.]{7,15}$/.test(ip)) { toast("IP host tidak valid."); return; }
      Client.leave();
      Client.join(ip, pin);
    };
    // host room
    document.querySelectorAll("#host-mode-seg button").forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll("#host-mode-seg button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        Host.mode = b.getAttribute("data-m");
      };
    });
    $("host-start").onclick = function () { Host.startGame(); };
    $("host-exit").onclick = function () {
      confirmBox("Tutup room?", "Semua pemain akan terputus.", "Tutup", function () {
        Host.stop();
        show("online", true); _prev = [];
      }, true);
    };
    $("pin-copy").onclick = function () {
      var s = "PIN: " + Host.pin +
        (Host.channel === "bt" ? " | Bluetooth: " + Host.btDeviceName : " | IP: " + Host.ip);
      if (HAS_BRIDGE && window.AndroidBridge.copyText) { window.AndroidBridge.copyText(s); toast("Disalin: " + s); }
      else toast(s);
    };
    // chat host & client
    function sendChat(inputId, fn) {
      var v = $(inputId).value.trim();
      if (!v) return;
      $(inputId).value = "";
      fn(v);
    }
    $("chat-send").onclick = function () {
      sendChat("chat-input", function (v) {
        send({ t: "chat", text: v });
        addChat(profile.name, v, false);
      });
    };
    $("chat-send2").onclick = function () {
      sendChat("chat-input2", function (v) {
        send({ t: "chat", text: v });
        addChat(profile.name, v, false);
      });
    };
    $("chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") $("chat-send").click(); });
    $("chat-input2").addEventListener("keydown", function (e) { if (e.key === "Enter") $("chat-send2").click(); });
    // client exit
    $("client-exit").onclick = function () {
      confirmBox("Keluar dari room?", "Kamu bisa gabung lagi kapan saja pakai PIN.", "Keluar", function () {
        Client.leave();
        show("online", true); _prev = [];
      }, true);
    };
  }

  var _diffTarget = "sp";

  /* =================== BANTUAN KANAL ONLINE =================== */

  /* pastikan izin + Bluetooth aktif, lalu jalankan lanjutan */
  function btGate(next) {
    if (!HAS_BT) { toast("Bluetooth tidak didukung di perangkat ini."); return; }
    window.__btPerms = function (ev) {
      window.__btPerms = null;
      if (!ev.granted) { toast("Izin Bluetooth ditolak — tidak bisa lanjut."); return; }
      if (window.AndroidBridge.btEnabled()) { next(); return; }
      window.__btEnableResult = function (ev2) {
        window.__btEnableResult = null;
        if (ev2.ok) next();
        else toast("Bluetooth belum aktif.");
      };
      window.AndroidBridge.btEnable();
    };
    window.AndroidBridge.btEnsurePermissions();
  }

  function showJoinChannel(channel) {
    show("join");
    $("join-wifi-pane").style.display = channel === "wifi" ? "" : "none";
    $("join-bt-pane").style.display = channel === "bt" ? "" : "none";
    $("join-title-sub").textContent = channel === "bt" ? "Bluetooth" : "WiFi / Hotspot";
    if (channel === "wifi") {
      if (!HAS_BRIDGE) toast("Pencarian otomatis hanya di aplikasi Android — masuk manual lewat IP.");
      else if (window.AndroidBridge.discoverRooms) window.AndroidBridge.discoverRooms();
      $("room-list").innerHTML = '<div class="muted" id="room-list-empty">Mencari room di jaringan...</div>';
    } else {
      btGate(function () {
        BtScan.reset();
        $("bt-status").textContent = "memindai perangkat terdekat...";
        window.AndroidBridge.btStartScan();
      });
    }
  }

  /* event dari bridge: perangkat BT ditemukan / scan selesai */
  window.__btDevice = function (ev) { BtScan.add(ev); };
  window.__btScanDone = function () { BtScan.scanDone(); };

  /* tombol back Android */
  window.__onAndroidBack = function () {
    if ($("modal-root").classList.contains("on")) { closeModal(); return "handled"; }
    if ($("overlay").classList.contains("on")) { return "handled"; }
    if (_cur === "menu") return "exit";
    if (_cur === "game") { $("g-exit").click(); return "handled"; }
    if (_cur === "host") { $("host-exit").click(); return "handled"; }
    if (_cur === "client") { $("client-exit").click(); return "handled"; }
    if (_cur === "over") { show("menu", true); _prev = []; return "handled"; }
    goBack();
    return "handled";
  };

  function buildLogos() {
    $("load-logo").innerHTML = tiles("SAMBUNG", "", "width:30px;height:34px;font-size:17px;margin:2px;");
    $("logo-row1").innerHTML = tiles("SAMBUNG", "", "");
    $("logo-row2").innerHTML = tiles("KATA", "teal", "");
    $("kr-logo").innerHTML = tiles("SAMBUNG KATA", "", "width:24px;height:27px;font-size:13px;margin:2px;");
    $("over-tiles").innerHTML = tiles("SAMBUNG KATA", "", "width:24px;height:27px;font-size:13px;margin:2px;");
  }

  function init() {
    buildBg();
    buildLogos();
    bind();
    refreshProfileUI();
    $("appver").textContent = APP_VERSION;
    // kamus.js & engine.js sudah dimuat sinkron sebelum app.js
    try {
      dict = new ENGINE.Dict(window.KAMUS);
      $("load-fill").style.width = "100%";
      $("load-text").textContent = KAMUS_VER.n + " kata siap!";
      setTimeout(function () { show("menu", true); _prev = []; }, 450);
    } catch (e) {
      $("load-text").textContent = "Gagal memuat kamus: " + e.message;
    }
    /* tik jam client utk countdown online */
    setInterval(function () {
      if (Client.active && Client.phase === "ingame" && _cur === "game" && Client.turnDeadline) {
        var rem = Math.max(0, Client.turnDeadline - Date.now());
        var frac = rem / ((Engine.MODES[Client.mode] ? Engine.MODES[Client.mode].time : 15000));
        var ring = $("timer-ring"); var C = 201;
        ring.setAttribute("stroke-dashoffset", String(C * (1 - Math.min(1, frac))));
        ring.setAttribute("stroke", frac > 0.5 ? "#5adfc9" : frac > 0.22 ? "#f7a928" : "#ff5d6c");
        $("timer-num").textContent = Math.ceil(rem / 1000);
      }
    }, 100);
  }

  /* hook debug/blackbox test */
  window.__DBG = {
    get dict() { return dict; },
    get profile() { return profile; },
    get kamusPribadi() { return kamusPribadi; },
    get G() { return G; },
    get Host() { return Host; },
    get Client() { return Client; },
    Engine: ENGINE,
    startOffline: startOffline,
    saveWord: saveWord,
    kbCheck: kbCheck,
    renderTyped: renderTyped
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
