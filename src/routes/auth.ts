import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  hashPassword, verifyPassword, validatePasswordStrength, validateUsername,
  signAccessToken, createRefreshToken, consumeRefreshToken, revokeRefreshToken, revokeAllUserTokens,
  requireAuth, generateUniqueTag, publicUser, type UserRow,
} from '../lib/auth.js';
import {
  qrisEnabled, createDeposit, checkDeposit, cancelDeposit, listDeposits,
} from '../lib/qris.js';
import { BOT_PLANS } from '../lib/plans.js';
import { rateLimited, resetRateLimit } from '../lib/rateLimit.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'afk_refresh';

function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res: import('express').Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

// ============ Skema validasi ============
const registerSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

/*
 * Rate limit login (anti brute force) — audit #2a & #2b.
 *
 * Dua lapis, keduanya disimpan di MySQL (bukan memori) supaya penghitung
 * tidak hilang saat `pm2 restart` dan tetap benar kalau backend dijalankan
 * multi-proses:
 *
 *   1. per-akun  (LOGIN_MAX_PER_USER, default 10) — menahan serangan yang
 *      menargetkan satu username dari banyak IP.
 *   2. per-IP    (LOGIN_MAX_PER_IP,   default 50) — menahan satu IP yang
 *      mencoba banyak username sekaligus (credential stuffing).
 *
 * Versi lama hanya per (IP+username) dan in-memory: berganti IP atau
 * menunggu restart cukup untuk mereset kuota.
 */
const LOGIN_MAX_PER_USER = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);
const LOGIN_MAX_PER_IP = Number(process.env.LOGIN_RATE_LIMIT_IP ?? 50);
const LOGIN_WINDOW_MS = 15 * 60_000;

// ============ POST /api/auth/register ============
authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { username, password } = parsed.data;

  const uErr = validateUsername(username);
  if (uErr) {
    res.status(400).json({ error: uErr });
    return;
  }
  const pErr = validatePasswordStrength(password);
  if (pErr) {
    res.status(400).json({ error: pErr });
    return;
  }

  // COLLATE NOCASE (SQLite) -> utf8mb4_unicode_ci sudah case-insensitive di MySQL.
  const exists = await db.get('SELECT 1 AS x FROM users WHERE username = ?', [username]);
  if (exists) {
    res.status(409).json({ error: 'Username sudah dipakai.' });
    return;
  }

  const hash = await hashPassword(password);
  const tag = await generateUniqueTag();

  let info;
  try {
    info = await db.run('INSERT INTO users (username, tag, password_hash) VALUES (?, ?, ?)', [
      username,
      tag,
      hash,
    ]);
  } catch (e) {
    // Balapan dua pendaftaran dengan username sama → UNIQUE constraint.
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Username sudah dipakai.' });
      return;
    }
    throw e;
  }

  const user = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [info.insertId]);
  if (!user) {
    res.status(500).json({ error: 'Gagal membuat akun.' });
    return;
  }

  const accessToken = await signAccessToken({
    sub: String(user.id), username: user.username, tag: user.tag, role: user.role,
  });
  const refreshToken = await createRefreshToken(user.id, req.ip, req.headers['user-agent']);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({ user: publicUser(user), accessToken });
});

// ============ POST /api/auth/login ============
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.' });
    return;
  }
  let { username, password } = parsed.data;
  username = username.trim();

  // Rate limit dua lapis (audit #2a) — per-akun DAN per-IP, dipakai bersama
  // supaya tidak bisa dilewati hanya dengan berganti IP.
  const ip = req.ip ?? 'unknown';
  const userKey = `login:u:${username.toLowerCase()}`;
  const ipKey = `login:i:${ip}`;
  const [userLimited, ipLimited] = await Promise.all([
    rateLimited(userKey, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS),
    rateLimited(ipKey, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS),
  ]);
  if (userLimited || ipLimited) {
    res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' });
    return;
  }

  const user = await db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);

  // Selalu jalankan bcrypt walau user tidak ada → hindari bocor lewat timing
  const dummyHash = '$2b$12$0000000000000000000000000000000000000000000000000000';
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash);

  if (!user || !ok) {
    res.status(401).json({ error: 'Username atau password salah.' });
    return;
  }
  if (user.is_banned) {
    res.status(403).json({ error: 'Akun diblokir.' });
    return;
  }

  // Login berhasil → bersihkan penghitung supaya user sah tidak ikut terkunci
  // gara-gara salah ketik password sebelumnya (audit #2a).
  await resetRateLimit(userKey);

  await db.run(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);

  const accessToken = await signAccessToken({
    sub: String(user.id), username: user.username, tag: user.tag, role: user.role,
  });
  const refreshToken = await createRefreshToken(user.id, req.ip, req.headers['user-agent']);
  setRefreshCookie(res, refreshToken);

  const fresh = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [user.id]);
  res.json({ user: publicUser(fresh ?? user), accessToken });
});

// ============ POST /api/auth/refresh ============
authRouter.post('/refresh', async (req, res) => {
  // Hanya dari cookie httpOnly (audit #4). Menerima token dari body
  // memperluas permukaan serangan tanpa manfaat: cookie sudah dilindungi
  // SameSite=Lax sehingga tidak ikut terkirim pada POST lintas-situs.
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Refresh token tidak ada.' });
    return;
  }
  const user = await consumeRefreshToken(token);
  if (!user || user.is_banned) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Refresh token tidak valid.' });
    return;
  }
  // Rotasi token
  const newRefresh = await createRefreshToken(user.id, req.ip, req.headers['user-agent']);
  setRefreshCookie(res, newRefresh);

  try {
    const accessToken = await signAccessToken({
      sub: String(user.id), username: user.username, tag: user.tag, role: user.role,
    });
    res.json({ user: publicUser(user), accessToken });
  } catch {
    res.status(500).json({ error: 'Gagal membuat token.' });
  }
});

// ============ POST /api/auth/logout ============
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) await revokeRefreshToken(token);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// ============ POST /api/auth/logout-all ============
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllUserTokens(Number(req.user!.sub));
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// ============ GET /api/auth/me ============
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [Number(req.user!.sub)]);
  if (!user) {
    res.status(404).json({ error: 'Akun tidak ditemukan.' });
    return;
  }
  res.json({ user: publicUser(user) });
});

// ============ PATCH /api/account/password ============
const changePwSchema = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

authRouter.patch('/password', requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.' });
    return;
  }
  const pErr = validatePasswordStrength(parsed.data.newPassword);
  if (pErr) {
    res.status(400).json({ error: pErr });
    return;
  }

  const user = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [Number(req.user!.sub)]);
  if (!user) {
    res.status(404).json({ error: 'Akun tidak ditemukan.' });
    return;
  }
  const ok = await verifyPassword(parsed.data.oldPassword, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'Password lama salah.' });
    return;
  }
  if (parsed.data.oldPassword === parsed.data.newPassword) {
    res.status(400).json({ error: 'Password baru harus berbeda.' });
    return;
  }

  const hash = await hashPassword(parsed.data.newPassword);
  await db.run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    hash,
    user.id,
  ]);
  await revokeAllUserTokens(user.id); // paksa login ulang di semua device
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Password diubah. Silakan login ulang.' });
});

// ============ SALDO ============

/** GET /api/account/saldo — saldo + riwayat */
authRouter.get('/saldo', requireAuth, async (req, res) => {
  const userId = Number(req.user!.sub);
  const user = await db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', [userId]);
  const history = await db.all(
    `SELECT id, type, amount, balance_after, description, ref, created_at
     FROM balance_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    [userId]
  );
  const deposits = await listDeposits(userId, 10);
  res.json({ balance: user?.balance ?? 0, history, deposits, plans: BOT_PLANS });
});

/** POST /api/account/deposit — buat QRIS */
const depositSchema = z.object({ amount: z.number().int().min(1000).max(5_000_000) });

authRouter.post('/deposit', requireAuth, async (req, res) => {
  const parsed = depositSchema.safeParse(req.body);

  // Batasi pembuatan kode deposit (tiap permintaan menembak API QRIS pihak
  // ketiga, jadi spam di sini membebani kuota & biaya gateway).
  if (await rateLimited(`deposit:${Number(req.user!.sub)}`, 10, 60 * 60_000)) {
    res.status(429).json({ error: 'Terlalu banyak membuat deposit. Coba lagi nanti.' });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: 'Nominal tidak valid (min Rp1.000).' });
    return;
  }
  if (!qrisEnabled()) {
    res.status(503).json({ error: 'Deposit belum tersedia.' });
    return;
  }
  try {
    const dep = await createDeposit(Number(req.user!.sub), parsed.data.amount);
    res.status(201).json(dep);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** GET /api/account/deposit/:kode — cek status (auto-credit kalau lunas) */
authRouter.get('/deposit/:kode', requireAuth, async (req, res) => {
  try {
    const dep = await checkDeposit(Number(req.user!.sub), req.params.kode);
    res.json(dep);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** POST /api/account/deposit/:kode/cancel */
authRouter.post('/deposit/:kode/cancel', requireAuth, async (req, res) => {
  try {
    const out = await cancelDeposit(Number(req.user!.sub), req.params.kode);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export { REFRESH_COOKIE, clearRefreshCookie };
