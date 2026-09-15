import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';

// ============ Konfigurasi (dari ENV, tidak pernah ditulis di kode) ============
const JWT_SECRET_RAW = process.env.JWT_SECRET ?? '';
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error('JWT_SECRET wajib diisi di env (minimal 32 karakter). Jangan hardcode di kode.');
}
const secret = new TextEncoder().encode(JWT_SECRET_RAW);

const ACCESS_TTL = '15m';                       // access token pendek
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // refresh token 30 hari
const ISSUER = 'afk-bedrock';
const AUDIENCE = 'afk-panel';

// ============ Tipe ============
export interface UserRow {
  id: number;
  username: string;
  tag: string;
  password_hash: string;
  role: string;
  balance: number;
  is_banned: number;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthPayload {
  sub: string;
  username: string;
  tag: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ============ Password ============
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Validasi kekuatan password.
 * Minimal 8 karakter, wajib ada huruf & angka.
 */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return 'Password minimal 8 karakter.';
  if (pw.length > 128) return 'Password maksimal 128 karakter.';
  if (!/[a-zA-Z]/.test(pw)) return 'Password harus mengandung huruf.';
  if (!/[0-9]/.test(pw)) return 'Password harus mengandung angka.';
  return null;
}

export function validateUsername(u: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    return 'Username 3-20 karakter, hanya huruf, angka, dan underscore.';
  }
  return null;
}

// ============ JWT ============
export async function signAccessToken(payload: AuthPayload): Promise<string> {
  return new SignJWT({ username: payload.username, tag: payload.tag, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthPayload> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
  return {
    sub: String(payload.sub),
    username: String(payload.username),
    tag: String(payload.tag),
    role: String(payload.role),
  };
}

// Refresh token: string acak; DB hanya simpan SHA-256 hash-nya
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: number, ip?: string, ua?: string): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  await db.run(
    `INSERT INTO refresh_tokens (user_id, token_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, hashToken(token), ip ?? null, ua ?? null, Date.now() + REFRESH_TTL_MS]
  );
  return token;
}

export async function consumeRefreshToken(token: string): Promise<UserRow | null> {
  const row = await db.get<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    [hashToken(token), Date.now()]
  );
  if (!row) return null;

  // Rotasi: token lama langsung dicabut (anti replay)
  await db.run(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`, [Date.now(), row.id]);

  const user = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [row.user_id]);
  return user ?? null;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db.run(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, [
    Date.now(),
    hashToken(token),
  ]);
}

export async function revokeAllUserTokens(userId: number): Promise<void> {
  await db.run(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [
    Date.now(),
    userId,
  ]);
}

// ============ Middleware ============
function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Wajib login. Pasang di semua route yang mengatur bot / saldo. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Butuh login (token tidak ada).' });
    return;
  }
  try {
    req.user = await verifyAccessToken(token);
    const u = await db.get<{ is_banned: number }>('SELECT is_banned FROM users WHERE id = ?', [
      Number(req.user.sub),
    ]);
    if (!u || u.is_banned) {
      res.status(403).json({ error: 'Akun diblokir atau tidak ditemukan.' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa.' });
  }
}

/**
 * Opsional: kalau ada token valid, isi req.user; kalau tidak, lanjut saja.
 *
 * Catatan keamanan (#5b): status `is_banned` IKUT diperiksa, sama seperti
 * requireAuth. Sebelumnya user yang sudah diblokir tetap dianggap
 * terautentikasi di route yang memakai optionalAuth (chat global).
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (token) {
    try {
      const claims = await verifyAccessToken(token);
      const u = await db.get<{ is_banned: number }>('SELECT is_banned FROM users WHERE id = ?', [
        Number(claims.sub),
      ]);
      // Hanya pasang kalau akun masih ada & tidak diblokir.
      if (u && !u.is_banned) req.user = claims;
    } catch {
      /* abaikan */
    }
  }
  next();
}

/**
 * Butuh role admin.
 *
 * Keamanan (#21): role diverifikasi ke DATABASE, bukan hanya dari klaim token.
 * Kalau seorang admin diturunkan menjadi user biasa, token lamanya masih
 * membawa `role: "admin"` sampai kedaluwarsa (maks 15 menit). Pemeriksaan ke
 * DB menutup celah itu dan sekaligus memastikan akun tidak diblokir.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sub = req.user?.sub;
  if (!sub) {
    res.status(401).json({ error: 'Butuh login.' });
    return;
  }
  const u = await db.get<{ role: string; is_banned: number }>(
    'SELECT role, is_banned FROM users WHERE id = ?',
    [Number(sub)]
  );
  if (!u || u.is_banned || u.role !== 'admin') {
    res.status(403).json({ error: 'Butuh akses admin.' });
    return;
  }
  next();
}

// ============ Util akun ============
/** Buat tag unik 4 digit (mis. 1122). */
export async function generateUniqueTag(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const tag = String(Math.floor(1000 + Math.random() * 9000));
    const exists = await db.get('SELECT 1 AS x FROM users WHERE tag = ?', [tag]);
    if (!exists) return tag;
  }
  // fallback: 5 digit
  for (let i = 0; i < 50; i++) {
    const tag = String(Math.floor(10000 + Math.random() * 90000));
    const exists = await db.get('SELECT 1 AS x FROM users WHERE tag = ?', [tag]);
    if (!exists) return tag;
  }
  throw new Error('Gagal membuat tag unik, coba lagi.');
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    tag: u.tag,
    displayName: `${u.username}#${u.tag}`,
    role: u.role,
    balance: u.balance,
    avatarUrl: u.avatar_url ?? null,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

/** Perbandingan aman untuk string rahasia (webhook/internal). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
