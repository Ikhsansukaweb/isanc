# IsanC

Panel kontrol bot AFK **Minecraft Bedrock** — connect bot ke server, login Microsoft sekali, lalu atur gerak, chat in-game, inventory, dan mode AFK langsung dari browser.

Live: **[skadesmart.web.id](https://skadesmart.web.id)**

---

## Fitur

- **Multi-bot** — satu akun bisa punya beberapa bot; nama otomatis diberi tag unik (`bot1#8064`) supaya tidak bentrok.
- **Login Microsoft** — bot masuk server pakai akun MS kamu. Bot tetap online walau tab browser ditutup.
- **Kontrol gerak** — maju/mundur/kiri/kanan, lompat, sneak, serang, putar arah, dan hotbar.
- **Chat in-game & Global Chat** — kirim perintah ke server, plus ruang obrolan realtime antar pengguna web.
- **Inventory & chest** — lihat isi tas, pindah item, buka dan kelola chest.
- **Mode AFK** — anti-kick otomatis; bot merespons paket server supaya tidak terputus.
- **Saldo & sewa** — isi saldo via QRIS, lalu sewa paket harian / mingguan / bulanan.
- **Foto profil** — unggah foto profil (disimpan di catbox.moe).

## Cara pakai

1. **Tambah bot** — isi nama, host server, port, dan versi Minecraft.
2. **Sewa pakai saldo** — pilih paket (harian / mingguan / bulanan).
3. **Jalankan** — bot masuk ke server, buka menu Detail untuk kontrol lengkap.

## Harga sewa

| Paket | Durasi | Harga |
|-------|--------|-------|
| Harian | 1 hari | Rp3.000 |
| Mingguan | 7 hari | Rp17.500 |
| Bulanan | 30 hari | Rp20.000 |

## Teknologi

**Backend** — Node.js, TypeScript, Express, MySQL (`mysql2`), WebSocket (`ws`), `bedrock-protocol` (protokol Minecraft Bedrock), `jose` (JWT), `bcryptjs`.

**Frontend** — Next.js (App Router), React, TypeScript, Tailwind CSS. Realtime via WebSocket.

**Infrastruktur** — PM2 (proses), Cloudflare Tunnel (publikasi), Apache2.

## Struktur proyek

```
src/                 Backend Express + bot engine
  routes/            Endpoint API (auth, bots, chat, avatar, dll)
  lib/               Helper: auth, QRIS, catbox, realtime, rate limit, anti-SSRF
  core/              Manajer bot & klien protokol Bedrock
  db/                Lapisan database MySQL
web/                 Frontend Next.js
  app/               Halaman (login, dashboard, bot, chat, saldo, akun)
  components/        Shell/navigasi, realtime, avatar, ikon
  lib/               Klien API, konteks auth, WebSocket
data/                Skema database
scripts/             Skrip operasional & diagnostik
```

## Menjalankan sendiri

### 1. Siapkan database

```bash
mysql -u root -p -e "CREATE DATABASE isanc CHARACTER SET utf8mb4;"
mysql -u root -p isanc < data/schema.mysql.sql
```

### 2. Konfigurasi

```bash
cp .env.example .env          # backend
cp web/.env.example web/.env.local   # frontend
```

Isi nilai di `.env`. **Jangan pernah commit `.env`** — berkas aslinya sudah diblokir `.gitignore`.

Bangkitkan rahasia acak:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # INTERNAL_SECRET
```

### 3. Pasang dependensi & bangun

```bash
npm install && npm run build          # backend
cd web && npm install && npm run build # frontend
```

### 4. Jalankan

```bash
pm2 start dist/index.js --name isanc-api
cd web && npm start                    # port 3000
```

## Keamanan

Audit keamanan lengkap 25 kelas kerentanan ada di [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) — memuat cara eksploitasi, bukti uji, dan patch.

Perlindungan utama yang sudah aktif:

- Anti-SSRF pada host bot (alamat internal/privat ditolak)
- Validasi kepemilikan bot di setiap endpoint (tidak bisa mengontrol bot orang lain)
- Verifikasi `Origin` WebSocket (anti cross-site WebSocket hijacking)
- Transaksi saldo atomik (`SELECT ... FOR UPDATE`) — bebas race condition
- Rate limit persisten di database + lockout brute force login
- Sanitasi pesan (anti stored XSS)
- MIME upload ditentukan dari magic bytes, bukan header klien
- CSP & header keamanan lengkap (HSTS, nosniff, X-Frame-Options, Referrer-Policy)

**Rahasia tidak disimpan di repo.** `.env`, cache login Microsoft (`data/mc-profiles/`), dan berkas database diblokir `.gitignore`.

## Lisensi

Proyek pribadi. Hubungi pemilik repo untuk penggunaan ulang.

---

Dibuat oleh **isan ganteng**
