/**
 * Kepemilikan bot (temuan #5a + #10).
 *
 * `botsRouter` (/api/bots/*) sudah memakai ownBot() sehingga aman, tapi
 * `apiRouter` (/api/bot/:name/*) hanya memakai requireAuth → siapa pun yang
 * punya akun sah bisa mematikan bot, memindahkan item di chest, atau
 * mengirim chat atas nama bot milik orang lain.
 *
 * Semua endpoint kontrol bot WAJIB lewat sini.
 */
import type { Request, Response } from 'express';
import { db } from '../db/index.js';
import { botManager, type BotClient } from '../core/manager.js';

/** Apakah `label` benar-benar milik `userId`? */
export async function isBotOwner(userId: number, label: string): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM user_bots WHERE user_id = ? AND label = ?',
    [userId, label]
  );
  return Boolean(row);
}

/** Semua label bot milik user (dipakai untuk memfilter log & daftar). */
export async function ownedLabels(userId: number): Promise<string[]> {
  const rows = await db.all<{ label: string }>(
    'SELECT label FROM user_bots WHERE user_id = ?',
    [userId]
  );
  return rows.map((r) => r.label);
}

/**
 * Ambil bot live HANYA kalau milik user (admin boleh memantau semua).
 *
 * Selalu balas 404 — bukan 403 — supaya keberadaan bot milik orang lain
 * tidak bisa dipetakan lewat perbedaan kode status.
 *
 * Mengembalikan `null` kalau sudah mengirim respons (pemanggil tinggal return).
 */
export async function getOwnedBot(
  req: Request,
  res: Response,
  opts: { adminBypass?: boolean } = {}
): Promise<BotClient | null> {
  const name = String(req.params.name ?? '');
  const userId = Number(req.user?.sub ?? 0);

  if (!name) {
    res.status(400).json({ error: 'Nama bot wajib.' });
    return null;
  }

  const isAdmin = req.user?.role === 'admin' && opts.adminBypass === true;

  if (!isAdmin) {
    if (!(await isBotOwner(userId, name))) {
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

/**
 * Versi khusus admin: memastikan role diambil dari DATABASE, bukan dari
 * klaim token (temuan #21 — role di token bisa basi sampai 15 menit).
 */
export async function dbRoleOf(userId: number): Promise<{ role: string; banned: boolean } | null> {
  const u = await db.get<{ role: string; is_banned: number }>(
    'SELECT role, is_banned FROM users WHERE id = ?',
    [userId]
  );
  if (!u) return null;
  return { role: u.role, banned: u.is_banned === 1 };
}
