# PROMPT — Stitch AI: Prototipe Mobile App Flutter untuk IsanC

Salin seluruh isi berkas ini ke Stitch AI.

---

## BAGIAN 1 — KONTEKS PROYEK

**Nama produk:** IsanC

**Apa ini:** Panel kontrol untuk menjalankan dan mengendalikan **bot AFK Minecraft Bedrock**. Pengguna mendaftarkan bot, menyambungkannya ke server Minecraft mana pun, lalu mengatur bot itu langsung dari HP — gerakkan, serang, chat, kelola inventory, dan biarkan bot tetap online (anti-kick) walau aplikasi ditutup.

**Siapa penggunanya:** Pemain Minecraft Bedrock (terutama di HP Android). Mereka biasa keluar-masuk server, ingin karakter tetap produktif saat tidak pegang HP, dan ingin memantau dari jauh.

**Karakter produk yang harus terasa di desain:**
- **Teknis tapi bersih** — ini alat, bukan game. Serius, rapi, tanpa hiasan berlebihan.
- **Tenang dan terkendali** — pengguna memantau sesuatu yang berjalan lama. Jangan ramai, jangan berkilau.
- **Cepat dibaca sekilas** — status bot harus langsung terlihat tanpa buka menu.
- **Padat tapi lega** — banyak angka teknis (health, koordinat, ping, pemain) tapi tetap enak dilihat.

**Ini prototipe UI saja.** Tidak perlu backend, tidak perlu data nyata. Gunakan data contoh yang realistis (lihat Bagian 6).

---

## BAGIAN 2 — ATURAN DESAIN (WAJIB DIIKUTI)

### 2.1 Bahasa
Seluruh antarmuka **berbahasa Indonesia**. Contoh: "Beranda" bukan "Home", "Bot Saya" bukan "My Bots", "Isi Saldo" bukan "Top Up", "Keluar" bukan "Logout".

### 2.2 Ikon
- **WAJIB ikon garis (outline) bergaya SVG.** Konsisten satu keluarga ikon, tebal garis sama.
- **DILARANG memakai emoji** di mana pun dalam antarmuka. Tidak di tombol, tidak di menu, tidak di pesan status.
- Pengecualian: emoji hanya boleh muncul di dalam **isi pesan chat** antar pengguna (karena itu tulisan orang, bukan elemen UI).

### 2.3 Warna
Palet pastel lembut, bukan warna menyala. Serius dan profesional, bukan ceria.

| Nama | Hex | Dipakai untuk |
|---|---|---|
| Paper | `#FBF9F7` | Latar utama |
| Fog | `#F4F1ED` | Latar kartu sekunder, area isian |
| Mist | `#E8E4DE` | Garis pemisah, latar chip |
| Smoke | `#D6D1C8` | Elemen nonaktif |
| Ash | `#A8A29A` | Teks keterangan kecil |
| Slate | `#6B6660` | Teks sekunder |
| Ink | `#1F1D1B` | Teks utama, tombol utama |
| Peach | `#FDE8D7` | Latar peringatan lembut |
| Sienna | `#B5651D` | Teks peringatan, nominal uang |
| Blue | `#DDE7F5` | Latar informasi |
| Rose | `#FDDCDC` | Latar bahaya/gagal |
| Crimson | `#C0392B` | Teks bahaya/gagal |
| Mint | `#D9F2E4` | Latar sukses |
| Forest | `#2E7D5B` | Teks sukses |

**Sudut:** kartu `16`, isian/tombol `12`, chip `999` (pil penuh).
**Jarak:** kelipatan `4`. Luar halaman `16`. Antar kartu `12`. Dalam kartu `16`.
**Bayangan:** sangat halus. `blur 8, offset (0,2), warna hitam 6%`. Jangan bayangan tebal.

### 2.4 Tipografi
- **Judul & teks:** Plus Jakarta Sans (atau Inter bila tidak tersedia).
- **Angka teknis** (koordinat, ping, harga, kode deposit, nama bot): **monospace** — JetBrains Mono atau Roboto Mono. Ini penting supaya angka sejajar dan mudah dibandingkan.
- Ukuran: judul halaman 24, judul kartu 16, badan 14, keterangan 12, label mikro 10.

### 2.5 Bentuk khas
- **Tanpa emoji, tanpa gradasi warna.** Pakai blok warna rata.
- Status selalu berupa **chip pil** dengan titik kecil di kiri.
- Kartu utama memakai sudut membulat `16` dengan bayangan tipis.
- Tombol utama: latar `Ink`, teks `Paper`, sudut `12`.

---

## BAGIAN 3 — STRUKTUR NAVIGASI

Prototipe **mobile**. Gunakan **bottom navigation bar** 5 tab yang selalu terlihat:

| Tab | Ikon | Halaman |
|---|---|---|
| 1 | grid / kotak | **Beranda** |
| 2 | robot / chip | **Bot** |
| 3 | balon percakapan | **Chat** |
| 4 | dompet | **Saldo** |
| 5 | siluet orang | **Akun** |

**Aturan penting:**
- **TIDAK ada app bar di atas** pada tab Beranda, Bot, Chat, Saldo, Akun. Navigasi cukup dari bar bawah.
- **App bar hanya muncul di halaman Detail Bot** (dibahas di layar 8), karena di sana ada sub-navigasi Kontrol / Chat / Inventory.
- Halaman yang dibuka dari Beranda (Tambah Bot, Detail Bot) tampil **full screen** dan boleh punya tombol kembali.

---

## BAGIAN 4 — DAFTAR HALAMAN YANG DIBUTUHKAN

Buat **13 layar**. Setiap layar dijelaskan lengkap dengan komponennya.

---

### LAYAR 1 — Masuk
**Tujuan:** pengguna masuk ke aplikasi.

**Isi:**
- Logo "IsanC" di tengah atas — teks "Isan" biasa + huruf "C" miring (italic serif).
- Judul: "Masuk ke IsanC"
- Subjudul: "Kelola bot AFK Minecraft Bedrock kamu."
- Isian: **Nama pengguna** (ikon orang)
- Isian: **Kata sandi** (ikon kunci, ada tombol lihat/sembunyikan)
- Tombol utama penuh: **Masuk**
- Baris kecil di bawah: "Belum punya akun? **Daftar**"
- Kotak peringatan (kuning `Peach` + teks `Sienna`) hanya muncul bila gagal — kosongkan di tampilan normal.

**Catatan desain:** ringan, banyak ruang kosong, logo jadi fokus.

---

### LAYAR 2 — Daftar Akun
**Tujuan:** membuat akun baru.

**Isi:**
- Tombol kembali (ikon panah) di kiri atas
- Judul: "Buat Akun"
- Isian: **Nama pengguna** (keterangan kecil: "3–20 huruf, tanpa spasi")
- Isian: **Kata sandi** (keterangan: "Minimal 8 karakter")
- Isian: **Ulangi kata sandi**
- Kotak info (biru `Blue`): "Akunmu akan mendapat nomor unik otomatis, contoh **#5622**. Nomor ini dipakai untuk memberi nama bot supaya tidak bentrok dengan pengguna lain."
- Tombol utama: **Daftar**
- Baris: "Sudah punya akun? **Masuk**"

---

### LAYAR 3 — Beranda
**Tujuan:** ringkasan kondisi akun dan bot dalam sekali lihat.

**Isi (urut dari atas):**
1. **Sapaan** — "Halo, isan" + keterangan kecil "Kamis, 15 September" (tanpa app bar, jadi ini langsung di bawah baris atas)
2. **Kartu Saldo** — chip kecil "Saldo" + angka besar monospace **Rp130.500** + tombol pil "Isi Saldo"
3. **Baris Statistik** — 4 kotak kecil sejajar:
   - Total Bot · **4**
   - Sedang Jalan · **1**
   - Total Pemain di Semua Bot · **16**
   - Total Hari Tersisa · **38**
4. **Bagian "Bot Kamu"** — judul + tombol teks "Lihat semua"
   - 3 kartu bot ringkas (lihat Layar 7 untuk isi kartu, versi lebih padat)
   - Tiap kartu: nama monospace, host, chip status, dan 1 baris masa aktif
5. **Bagian "Aktivitas Terbaru"** — daftar 5 baris, tiap baris: ikon jenis, keterangan, waktu
   - contoh: "Sewa bot bot1#8064 — harian (1 hari)" · 2 jam lalu
   - contoh: "Deposit QRIS Rp10.000 berhasil" · 1 hari lalu
6. **Kartu Ajakan** (bila belum punya bot) — "Belum ada bot" + tombol "Tambah Bot Pertama"

**Catatan desain:** halaman ini harus bisa dibaca dalam 3 detik. Angka besar, label kecil.

---

### LAYAR 4 — Bot Saya (daftar bot)
**Tujuan:** rumah tab "Bot". Melihat semua bot dan mengatur cepat.

**Isi:**
1. **Judul + tombol tambah** — "Bot Saya" (dengan ikon robot) bersebelahan dengan tombol **Tambah Bot** (ikon plus, tombol isi `Ink`)
2. **Keterangan** — "4 terdaftar · 1 jalan"
3. **Kartu Saldo Ringkas** — ikon dompet + "Saldo kamu" + **Rp130.500** + tombol pil "Isi Saldo →"
4. **Daftar Bot** — satu kartu per bot. Tiap kartu berisi:
   - **Baris atas:** ikon bot dalam kotak bulat (hijau muda bila jalan, abu bila tidak) · nama bot monospace ("bot1#8064") · host dan port ("be.prownetwork.net:19132") · versi Minecraft ("v1.26.30") · **chip status** di kanan
   - **Kotak Masa Aktif** (latar `Peach` bila habis/belum disewa, `Fog` bila aktif): "Masa aktif" · "9 hari 4 jam"
   - **Tombol paket sewa** — 3 tombol pil kecil: "Harian · Rp3.000" · "Mingguan · Rp17.500" · "Bulanan · Rp20.000". Tombol jadi tidak aktif (redup) bila saldo kurang.
   - **Baris 4 kotak statistik:** ikon hati + **health** (20) · ikon orang + **pemain** (16) · ikon pin + **koordinat** (128, -64) · ikon jam + **uptime** (2j 14m)
   - **Baris tombol:** "Detail" (garis, ikon gir) + tombol kanan: **"Jalankan"** (isi `Ink`, ikon play) bila mati, atau **tombol ikon matikan** (merah) bila jalan
5. **Kotak Kosong** (bila tidak ada bot) — ikon robot besar abu, "Belum ada bot", "Bot pertama kamu akan bernama bot1#5622", tombol "Tambah Bot Pertama"
6. **Kartu "Cara pakai"** — 3 langkah bernomor:
   - "1 · Tambah bot" — isi nama, host server, port, dan versi Minecraft
   - "2 · Sewa pakai saldo" — pilih paket harian/mingguan/bulanan
   - "3 · Jalankan" — bot masuk server, buka Detail untuk kontrol lengkap

---

### LAYAR 5 — Tambah Bot
**Tujuan:** mendaftarkan bot baru. **Full screen dengan tombol kembali.**

**Isi:**
- Tombol kembali + judul "Tambah Bot"
- Keterangan: "Isi data server yang ingin dimasuki bot."
- Isian: **Nama bot** — keterangan: "Nama akan otomatis diberi tag **bot1#5622**"
- **Pemilih Versi Minecraft** (dropdown/modal bottom sheet) — pilihan: 1.21.50, 1.21.44, 1.21.30, 1.21.2, 1.21.0, 1.20.80, 1.20.60, 1.20.40, 1.20.30, 1.20.10, 1.20.0, 1.19.80
- Isian: **Host server** — keterangan: "Alamat server, contoh play.example.com"
- Isian: **Port** — angka, nilai bawaan `19132`
- **Sakelar: Mode Offline** — keterangan: "Nyalakan bila server tidak memakai login Microsoft/Xbox"
- Kotak info (biru): "Setelah bot dibuat, sewa paket dulu supaya bisa dijalankan."
- Tombol utama penuh: **Tambah Bot**
- Kotak peringatan (merah `Rose`): tampilkan hanya saat gagal — "Host menunjuk ke alamat internal/privat — tidak diizinkan."

---

### LAYAR 6 — Detail Bot (Kontrol) ⭐ HALAMAN PALING PENTING
**Tujuan:** mengendalikan bot secara langsung. Ini layar utama produk.

**Ini satu-satunya halaman yang punya app bar di atas.**

**App bar:**
- Tombol kembali (ikon panah) di kiri
- Tengah: nama bot monospace "**bot1#8064**" + keterangan kecil "Detail bot"
- Kanan: chip saldo (ikon dompet + **Rp130.500**)

**Sub-tab tepat di bawah app bar (satu baris, tanpa celah):**
**Kontrol** (aktif) · **Chat** · **Inventory**

**Isi Kontrol (urut dari atas):**

1. **Kartu Status Utama** — paling menonjol
   - Chip status besar: titik hijau + **"Jalan"**
   - 4 angka besar sejajar dalam kotak `Fog`:
     - **Health** — 20 (ikon hati)
     - **Pemain** — 16 (ikon orang)
     - **Ping** — 42 ms (ikon sinyal)
     - **Uptime** — 2j 14m (ikon jam)
   - Koordinat monospace besar: **X 128 · Y 64 · Z -64** (ikon pin)
   - Bila status `awaiting_auth`: ganti isi kartu dengan panel login Microsoft — lihat Layar 11.

2. **Kartu Kendali Gerak** — 3×3 grid tombol panah (atas, bawah, kiri, kanan di tengah) + tombol tengah **Lompat**. Semua tombol besar, mudah ditekan ibu jari, ikon panah garis.

3. **Baris Tombol Aksi** — 4 tombol pil sejajar: **Serang** · **Jongkok** · **Pakai** · **Putar**

4. **Kartu Posisi Tujuan**
   - 3 isian angka: **X**, **Y**, **Z**
   - Tombol: **Pergi ke Koordinat** (penuh) + tombol **Batal** (hanya muncul bila sedang berjalan)

5. **Kartu Hotbar**
   - Deretan 9 kotak kecil bernomor 1–9, kotak aktif diberi garis `Ink` tebal
   - Tiap kotak menampilkan ikon item bila ada, atau kosong

6. **Kartu Mode AFK** — sakelar besar
   - Judul: **Mode AFK**
   - Keterangan: "Bot tetap online dan menolak tendangan server walau aplikasi ditutup."
   - Sakelar: **aktif**
   - Saat aktif, tampilkan chip hijau "Anti-kick menyala"

7. **Kartu Chat In-Game** (versi ringkas, 5 baris terakhir)
   - Daftar pesan: nama pengirim + isi
   - Isian di bawah: "Tulis pesan..." + tombol kirim
   - Nama pengirim `Ink` tebal, isi pesan `Slate`

8. **Tombol Besar di Paling Bawah** — **Matikan Bot** (garis tepi merah, teks `Crimson`)

---

### LAYAR 7 — Detail Bot · Tab Chat
**Tujuan:** percakapan bot di dalam server Minecraft.

**Isi:**
- Sub-tab **Chat** aktif
- Daftar pesan penuh satu layar, gaya gelembung percakapan:
  - Pesan dari orang lain: gelembung kiri, latar `Fog`
  - Pesan dari bot: gelembung kanan, latar `Ink` dengan teks `Paper`
  - Nama pengirim di atas gelembung (monospace, kecil, `Ash`)
  - Waktu di bawah gelembung (kecil)
- Bila bot berbicara sendiri, beri penanda kecil "BOT"
- Isian pesan di bawah + tombol kirim (ikon panah)
- **Daftar pesan ini wajib bisa di-scroll sendiri** di dalam areanya, bukan men-scroll seluruh halaman

---

### LAYAR 8 — Detail Bot · Tab Inventory
**Tujuan:** melihat dan memindahkan barang bawaan bot.

**Isi:**
- Sub-tab **Inventory** aktif
- **Baris info perkakas** — 4 chip: **36 slot** · **28 terisi** · **8 kosong** · tombol "Rapikan"
- **Grid Item** — 6 kolom × 6 baris. Tiap sel:
  - Kotak `Fog`, sudut `12`, rasio 1:1
  - Bilah tahan (durability) tipis di bawah bila item punya
  - **Jumlah** barang di sudut kanan bawah (monospace)
  - Bila kosong: hanya kotak kosong bergaris putus-putus
- **Kotak Item Terpilih** (muncul bila item ditekan) — panel muncul dari bawah (bottom sheet):
  - Nama item + jumlah
  - Tombol aksi: **Pakai** · **Buang** · **Pindah** · **Ke Hotbar** · **Tutup**
- **Kartu Peti/Chest** (bila bot sedang membuka peti):
  - Judul "Peti Terbuka" + chip nama
  - Grid item peti (27 slot, 9 kolom)
  - Tombol: **Tutup Peti** · **Ambil Semua**
- **Minimum tinggi:** beri ruang cukup supaya nyaman disentuh di HP

---

### LAYAR 9 — Chat Global
**Tujuan:** ruang obrolan sesama pengguna IsanC (bukan chat in-game).

**Isi:**
- Judul: "Chat Global" + keterangan "16 pesan hari ini"
- **Baris informasi** kecil: "Obrolan ini hanya antar pengguna IsanC, terpisah dari chat di dalam server Minecraft."
- Daftar pesan (bisa scroll sendiri):
  - Tiap pesan: **Avatar bulat** (foto profil, atau huruf awal nama bila tidak ada foto) · nama pengguna (tebal) + nomor tag (monospace, kecil, `Ash`) · isi pesan · waktu
  - Pesan sendiri: beri latar sedikit berbeda (`Fog`) dan penanda "Kamu"
  - Bila pesan adalah **kabar sistem** (misal "Bot X baru disewa"), tampilkan di tengah dengan chip kecil abu, tanpa avatar
- Isian pesan di bawah + tombol kirim
- Batas isian: 200 karakter, tampilkan penghitung kecil bila mendekati batas

---

### LAYAR 10 — Saldo
**Tujuan:** mengisi saldo dan melihat riwayat.

**Isi:**
1. **Kartu Saldo Utama** — chip "Saldo Aktif" + angka besar monospace **Rp130.500** + keterangan "Untuk menyewa bot"
2. **Kartu Isi Saldo**
   - Judul "Isi Saldo"
   - **Pilihan Nominal Cepat** — 6 tombol pil: Rp5.000 · Rp10.000 · Rp25.000 · Rp50.000 · Rp100.000 · Rp250.000
   - Isian **Nominal Lain** (angka, ada awalan "Rp")
   - Kotak rincian biaya (latar `Fog`):
     - Nominal — Rp10.000
     - Biaya + kode unik — Rp123
     - **Total bayar** — Rp10.123 (tebal, `Sienna`)
     - "Saldo masuk: Rp10.000" (kecil)
   - Tombol utama penuh: **Buat Kode QRIS**
3. **Kartu Deposit Menunggu Bayar** (muncul bila ada deposit belum dibayar)
   - **Gambar QR** — kotak 200×200, latar putih, garis tepi tipis. Tampilkan kode QR sungguhan bila memungkinkan.
   - Di sebelahnya: Nominal · Biaya · **Total bayar** (tebal) · "Saldo masuk"
   - Chip kode deposit di atas: monospace **AFK-3-1789477118568-265**
   - Keterangan: "Kadaluarsa: 15 Sep 14:30"
   - Tombol: **Buka Halaman Bayar** (isi `Ink`) · **Salin Kode** (garis) · **Batalkan** (garis merah)
   - **PENTING:** tampilkan juga **tombol alternatif "Salin Kode QRIS"** berbentuk teks, karena gambar QR kadang tidak tampil — jadi pengguna tetap punya cara membayar.
4. **Chip Status Deposit** — pakai warna berbeda: `pending` kuning · `success` hijau · `cancel` merah · `expired` abu
5. **Riwayat Deposit** — daftar, tiap baris:
   - Kode deposit monospace (pendek) · nominal · chip status · tanggal
   - Bisa ditekan untuk lihat rincian
6. **Riwayat Saldo** — daftar perubahan saldo:
   - Ikon jenis (beli = tanda minus, isi = tanda plus)
   - Keterangan ("Sewa bot bot1#8064 — harian (1 hari)")
   - Jumlah (merah untuk keluar, hijau untuk masuk) + saldo akhir
   - Tanggal
7. **Bagian Panduan** — 4 langkah cara bayar QRIS: buka aplikasi bank/e-wallet → pindai kode QR → masukkan nominal **tepat sampai angka terakhir** → saldo masuk otomatis dalam 1–2 menit

---

### LAYAR 11 — Login Microsoft (alur di dalam Detail Bot)
**Tujuan:** menyambungkan akun Microsoft/Xbox supaya bot bisa masuk server.

**Isi (tampil menggantikan Kartu Status pada Layar 6):**
- Ikon Xbox/Microsoft (garis, bukan logo berwarna)
- Judul: "Sambungkan Akun Microsoft"
- Keterangan: "Bot perlu akun Microsoft untuk masuk server ini. Kode di bawah berlaku 15 menit."
- **Kotak Kode Besar** — monospace, ukuran sangat besar, huruf berjarak lebar, contoh **`K7QP-3DMN`**
  - Latar `Fog`, garis tepi `Mist`, mudah disalin
- Tombol: **Salin Kode** (garis) · **Buka Halaman Login** (isi `Ink`)
- **Langkah-langkah** (daftar bernomor):
  1. Tekan "Buka Halaman Login"
  2. Masukkan kode di atas saat diminta
  3. Pilih akun Microsoft yang ingin dipakai
  4. Kembali ke IsanC — bot akan otomatis tersambung
- **Indikator Menunggu** — tiga titik berdenyut lembut + "Menunggu kamu menyelesaikan login..."
- Tombol kecil: **Batalkan**

---

### LAYAR 12 — Akun
**Tujuan:** mengelola profil dan keamanan.

**Isi:**
1. **Kartu Profil**
   - **Avatar bulat besar** (foto profil atau huruf awal nama dengan latar warna lembut)
   - Nama tampilan: **isans** + nomor tag monospace **#8064**
   - Chip: "Peran: Pengguna"
   - **Tombol ganti foto** (ikon kamera kecil di sudut avatar, bukan tombol terpisah)
2. **Baris Statistik** — kotak sejajar: **Saldo Rp130.500** · **4 Bot** · **Bergabung 15 Sep 2026**
3. **Grup "Keamanan"** — kartu berisi baris menu:
   - **Ubah Kata Sandi** (ikon kunci) dengan panah kanan
   - **Keluar dari Semua Perangkat** (ikon perangkat) dengan panah kanan
   - **Keluar** (ikon keluar, teks `Crimson`)
4. **Grup "Tentang"**
   - **Versi Aplikasi** — "1.0.0 (prototipe)"
   - **Server** — "skadesmart.web.id"
   - Baris keterangan kecil
5. **Footer** — "IsanC · Dibuat oleh **isan ganteng**" (rata tengah, kecil, `Ash`)

---

### LAYAR 13 — Ubah Kata Sandi
**Tujuan:** mengganti kata sandi. **Full screen dengan tombol kembali.**

**Isi:**
- Tombol kembali + judul "Ubah Kata Sandi"
- Isian: **Kata sandi saat ini**
- Isian: **Kata sandi baru** — keterangan "Minimal 8 karakter"
- Isian: **Ulangi kata sandi baru**
- **Indikator Kekuatan Sandi** — 3 batang kecil, berubah warna: lemah (merah) / sedang (kuning) / kuat (hijau)
- Kotak info (biru): "Mengganti kata sandi akan mengeluarkan kamu dari semua perangkat lain. Kamu perlu masuk ulang di HP ini."
- Tombol utama penuh: **Simpan Kata Sandi**
- Kotak peringatan (merah) bila kata sandi lama salah

---

## BAGIAN 5 — KOMPONEN YANG HARUS KONSISTEN

Buat sebagai komponen yang dipakai berulang:

**1. Chip Status Bot** — pil dengan titik kiri + label. Varian:
| Status | Tampilan |
|---|---|
| `spawned` | titik hijau · "Jalan" · latar `Mint` · teks `Forest` |
| `connecting` | titik biru · "Menyambung" · latar `Blue` |
| `awaiting_auth` | titik oranye · "Butuh Login" · latar `Peach` · teks `Sienna` |
| `kicked` / `error` | titik merah · "Terputus" · latar `Rose` · teks `Crimson` |
| `nonaktif` | titik abu · "Nonaktif" · latar `Mist` |

**2. Chip Status Deposit** — sama bentuknya: `pending` "Menunggu" · `success` "Berhasil" · `cancel` "Dibatalkan" · `expired` "Kadaluarsa"

**3. Kartu Statistik Kecil** — kotak `Fog` sudut `12`, ikon garis di atas, angka monospace tebal, label kecil di bawah. 4 sejajar.

**4. Kartu** — latar `Paper`, sudut `16`, bayangan tipis, dalaman `16`.

**5. Tombol** — 3 varian:
- **Utama** — latar `Ink`, teks `Paper`, sudut `12`, tinggi 48
- **Garis** — latar transparan, tepi `Mist`, teks `Ink`
- **Teks** — hanya teks `Slate`, tanpa latar

**6. Chip Paket Sewa** — pil `Paper` dengan bayangan tipis, teks kecil. Redup bila saldo kurang.

**7. Isian Teks** — latar `Fog`, sudut `12`, tanpa garis tepi, ikon kiri, tinggi 48. Fokus: garis `Ink` 1.5.

**8. Kartu Kosong** — garis putus-putus `Smoke`, ikon besar `Smoke`, judul `Slate`, keterangan `Ash`, tombol.

**9. Avatar Bulat** — ukuran 40 (daftar), 56 (profil), 80 (akun). Bila tidak ada foto: huruf awal nama, latar warna lembut berbeda per pengguna.

**10. Baris Menu** — ikon kiri · judul · panah kanan, tinggi 56, garis pemisah tipis antar baris.

---

## BAGIAN 6 — DATA CONTOH (pakai persis ini)

**Pengguna:** `isans` · tag `#8064` · saldo **Rp130.500** · peran Pengguna · bergabung 15 Sep 2026

**Bot 1:** `bot1#8064` · `be.prownetwork.net:19132` · v1.26.30 · **Jalan** · health 20 · 16 pemain · ping 42ms · uptime 2j 14m · posisi (128, 64, -64) · masa aktif 9 hari 4 jam · AFK nyala

**Bot 2:** `bot2#5622` · `play.example.net:19132` · v1.21.50 · **Nonaktif** · belum disewa · health — · pemain 0

**Bot 3:** `bot3#4410` · `mc.hypixel-like.net:19132` · v1.21.44 · **Terputus** · health 0 · pesan galat "Koneksi ditutup server (timeout)"

**Daftar pemain di server:** Dodi, Ranu, Sinta, Bagas, Nadia, Fajar, dan 10 lainnya

**Isi chat in-game:**
- `Dodi`: "ada yang mau trade diamond?"
- `Ranu`: "bot ini AFK ya? dari tadi diam"
- `bot1#8064`: "iya, mode AFK aktif"
- `Sinta`: "boleh minta sedikit nih"
- `Bagas`: "server rame hari ini"

**Isi chat global:**
- `budi` `#9291`: "ada yang punya bot bulanan? worth gak?"
- `isans` `#8064`: "worth, saya pakai harian buat nyoba dulu"
- `sari` `#3307`: "sewa bot saya error terus, kenapa ya"
- `budi` `#9291`: "coba cek versi Minecraft-nya, harus sama"
- Pesan sistem: "Bot baru disewa: bot2#5622"

**Hotbar:** slot 1 Diamond Sword · slot 2 Diamond Pickaxe · slot 3 Torch ×64 · slot 4 Bread ×12 · slot 5-9 kosong · slot aktif: 1

**Inventory:** 28 dari 36 slot terisi, contoh isi: Diamond ×42, Iron Ingot ×17, Cobblestone ×230, Oak Log ×64, Coal ×38, Apple ×7

**Item peti:** Diamond ×12, Emerald ×5, Golden Apple ×3, Enchanted Book ×1

**Deposit menunggu bayar:** kode `AFK-3-1789477118568-265` · nominal Rp10.000 · biaya Rp123 · total Rp10.123 · saldo masuk Rp10.000 · kadaluarsa 15 Sep 14:30

**Riwayat deposit:**
| Kode | Nominal | Status | Tanggal |
|---|---|---|---|
| `AFK-3-...265` | Rp10.000 | Menunggu | 15 Sep 14:10 |
| `AFK-3-...853` | Rp10.000 | Dibatalkan | 15 Sep 14:08 |
| `AFK-1-...161` | Rp1.000 | Berhasil | 15 Sep 12:32 |
| `AFK-1-...535` | Rp25.000 | Dibatalkan | 15 Sep 12:28 |

**Riwayat saldo:**
| Keterangan | Jumlah | Saldo akhir | Waktu |
|---|---|---|---|
| Sewa bot bot1#8064 — harian (1 hari) | −Rp3.000 | Rp130.500 | 15 Sep 13:05 |
| Sewa bot bot1#8064 — harian (1 hari) | −Rp3.000 | Rp133.500 | 15 Sep 12:39 |
| Deposit QRIS berhasil | +Rp10.000 | Rp136.500 | 15 Sep 12:32 |

**Paket sewa:** Harian 1 hari Rp3.000 · Mingguan 7 hari Rp17.500 · Bulanan 30 hari Rp20.000

---

## BAGIAN 7 — YANG DILARANG

1. **Jangan memakai emoji** di antarmuka. Ikon harus garis/SVG.
2. **Jangan memakai warna menyala** (merah terang, hijau neon, biru listrik). Pakai palet Bagian 2.3.
3. **Jangan app bar di atas** pada layar Beranda, Bot, Chat, Saldo, Akun.
4. **Jangan gradients** dan jangan bayangan tebal.
5. **Jangan bahasa Inggris** di teks antarmuka (istilah teknis seperti "host", "port", "QRIS", "AFK", "uptime", "health" boleh).
6. **Jangan gaya game** — ini alat kerja, bukan permainan. Tidak ada bintang, tidak ada efek kilau, tidak ada maskot.
7. **Jangan lupa scroll internal** untuk daftar panjang (chat, inventory) — jangan biarkan seluruh halaman ikut men-scroll sampai bar bawah terdorong.
8. **Jangan taruh 4+ angka besar berdempetan** tanpa kotak pemisah.

---

## BAGIAN 8 — HASIL YANG DIINGINKAN

Buat prototipe **13 layar** di atas sebagai aplikasi mobile Flutter yang bisa ditekan-tekan:

- Bottom navigation 5 tab berfungsi antar layar utama
- Setiap kartu bot bisa ditekan → membuka Detail Bot
- Sub-tab Kontrol / Chat / Inventory berfungsi di Detail Bot
- Tombol Tambah Bot → membuka layar Tambah Bot
- Tombol Isi Saldo → membuka layar Saldo
- Avatar di Akun → membuka layar Akun, lalu Ubah Kata Sandi
- Status bot contoh: `bot1#8064` **Jalan**, `bot2#5622` **Nonaktif**, `bot3#4410` **Terputus** — supaya ketiga variasi chip kelihatan

**Perhatian utama:** kejelasan status. Pengguna harus tahu kondisi setiap bot **tanpa menekan apa pun** — cukup melihat warna chip, ikon, dan angka.

---

Selesai. Silakan buat prototipenya.
