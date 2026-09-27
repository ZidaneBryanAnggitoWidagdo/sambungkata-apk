# Sambung Kata — Game Sambung Kata KBBI untuk Android

Game sambung kata berbasis KBBI (108.344 kata) untuk Android 9+, dibuat oleh **zdn_gg**.

Seluruh layar adalah **WebView fullscreen** yang memuat satu paket web (HTML + CSS + JS) —
logika permainan 100% JavaScript, sedangkan Kotlin berperan sebagai "cangkang" aplikasi
(WebView fullscreen, server multiplayer, dan penemuan room).

## Fitur

### Mode Permainan
- **Singleplayer vs Bot** — lawan bot *tak terkalahkan* (selalu menjawab tepat waktu). Bertahanlah selama mungkin!
- **Main Sendiri (Solo)** — monolog dengan dirimu sendiri, kata yang kamu pakai tetap terkumpul.
- **Online (WiFi/Hotspot yang sama)** — buat room atau gabung pakai **PIN 6 digit**. Maksimal **13 pemain**.

### Tiga Kesulitan
| Mode | Waktu | Awalan (prefix) | Catatan |
|------|-------|-----------------|---------|
| EASY | 25 detik | 1 huruf terakhir | Ujung kata `x/q/f` otomatis diganti huruf sebelumnya |
| NORMAL | 15 detik | 1–3 huruf dari akhir kata | Kurva noise: awal 1–2 huruf → pertengahan mulai 3 huruf → akhir 2–3 huruf |
| HARD | 10 detik | hingga 6 huruf | Giliran pertama pasti 1 huruf; jika tak ada prefix bagus 3–6 huruf, sistem boleh turun ke 1–2 |

- Awalan bisa **tidak berdampingan** (sub-sekuens dari huruf-huruf akhir kata, divalidasi kamus).
- Sistem **anti-jalan-buntu**: kata yang membuat rantai mati ditolak *tanpa* dihitung salah.
- Kata tidak sesuai KBBI / salah awalan / diulang = salah. **Salah ke-5 → -1 nyawa** (1–4 masih toleransi).
- Habis waktu → **-1 nyawa** (prefix tetap, giliran pindah ke pemain berikutnya).
- Setiap pemain punya **3 nyawa**; **pemain terakhir yang bertahan menang**.

### Sistem Lain
- **Kamusku** — semua kata yang kamu pakai (offline & online) tersimpan di indeks pribadi untuk dipelajari.
- **Gelar**: 0 Pemula Kata → 250 Penjelajah Kata → 1.000 Kolektor Kata → 2.500 Ahli Basa → 4.000 Sastrawan → **5.000 kata unik = Mahaguru Kata**.
- **Profil** — akun tamu otomatis tanpa login; nama bisa diganti (maks 15 karakter, tanpa karakter spesial).
- **Online**: chat room (tidak disimpan), host bisa **kick** pemain dengan alasan; yang dikick **tidak bisa masuk 30 detik** — mencoba masuk saat masih diblokir **menggandakan** sisa masa blokir.
- **Kredit & Donasi** — dukung zdn_gg via GoPay `+6287802078095`.

## Cara Build

```bash
# 1. Buka di Android Studio (Koala/baru, JDK 17) atau:
./gradlew assembleDebug
# 2. APK ada di app/build/outputs/apk/debug/app-debug.apk
```

- minSdk **28** (Android 9), targetSdk 34.
- Satu-satunya dependency: `org.java-websocket:Java-WebSocket:1.5.7`.

## Cara Main Online

1. Semua pemain terhubung ke **WiFi atau hotspot yang sama**.
2. Host: *Bermain → Online → Buat Room* — muncul PIN 6 digit & IP.
3. Teman: *Bermain → Online → Gabung Room* — room host otomatis terdeteksi
   (atau masuk manual dengan IP host), lalu masukkan PIN dari host.
4. Host memilih mode (easy/normal/hard) lalu tekan **Mulai Permainan**.

## Arsitektur

```
┌─────────────────────────── APK ────────────────────────────┐
│  MainActivity (Kotlin)                                     │
│   ├─ WebView fullscreen ← file:///android_asset/index.html │
│   ├─ GameServer (WebSocket, port 8787) — host multiplayer  │
│   ├─ NsdHelper (mDNS _sambungkata._tcp.) — discovery room  │
│   └─ Bridge "AndroidBridge" (ws client, copy, vibrate...)  │
│                                                            │
│  Paket Web (assets/)                                       │
│   ├─ index.html — UI semua layar (tema "Papan Huruf")      │
│   ├─ kamus.js — 108.344 kata terurut (1 string, 1.06 MB)   │
│   ├─ engine.js — logika game murni (kamus, noise, ruang)   │
│   └─ app.js — UI, penyimpanan lokal, sesi online           │
└────────────────────────────────────────────────────────────┘
```

**Kenapa kamus.js (sorted string + binary search)?**
Mesin awalan melakukan 50–300 query prefix per giliran. Sorted array di memori JS
memberi lookup ~0,8 µs/query (diukur: 1.000 query = 0,79 ms), parse awal < 300 ms,
tanpa jembatan JS↔Kotlin per query. SQLite kalah cepat untuk pola akses ini karena
setiap query harus melewati bridge asinkron.

## Testing (blackbox, otomatis)

```bash
# 1) Engine: kamus, validasi, easy x/q/f (35 test)
node tests/test_dict_easy.js
# 2) Noise normal+hard: kurva kesulitan, fallback, rantai 300 langkah (3.163 test)
node tests/test_noise_normal_hard.js
# 3) GameRoom: nyawa, salah-5, timeout, bot, solo, 13 pemain (67 test)
node tests/test_gameroom.js
# 4) Protokol online: PIN, kick, blokir 30s & penggandaan, kapasitas (22 test)
node tests/test_online_protocol.js
# 5) UI end-to-end via headless browser (41 test, butuh playwright)
python3 tests/test_ui_browser.py
```

Total **3.328 assertion** otomatis. `tests/mock_relay.js` adalah spesifikasi
protokol yang diimplementasikan ulang 1:1 oleh `GameServer.kt`.

## Struktur Proyek

```
app/src/main/
├── AndroidManifest.xml
├── assets/                  (kamus.js · engine.js · app.js · index.html)
├── java/com/zdngg/sambungkata/
│   ├── MainActivity.kt      (WebView fullscreen + bridge)
│   ├── GameServer.kt        (server WebSocket multiplayer)
│   └── NsdHelper.kt         (penemuan room mDNS)
└── res/                     (tema & ikon)
tools/build_kamus.py         (generator kamus.js — reproducible)
tests/                       (5 suite test blackbox)
```

## Kredit

- Game oleh **zdn_gg** — donasi via GoPay: **+6287802078095**
- Sumber data kata: KBBI (kumpulan kata daring sumber terbuka)
