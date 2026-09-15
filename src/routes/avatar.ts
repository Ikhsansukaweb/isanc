import { Router } from 'express';
import express from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { uploadAvatar, deleteFromCatbox, catboxEnabled, MAX_AVATAR_BYTES } from '../lib/catbox.js';
import { rateLimited } from '../lib/rateLimit.js';

export const avatarRouter = Router();

/**
 * POST /api/account/avatar — unggah foto profil.
 *
 * Body: multipart/form-data dengan field "photo".
 * File ditahan di memori (bukan disk) lalu diteruskan ke catbox.moe.
 * Batas 2 MB supaya memori server tidak habis kalau ada yang iseng.
 */
avatarRouter.post(
  '/avatar',
  requireAuth,
  express.raw({ type: () => true, limit: MAX_AVATAR_BYTES }),
  async (req, res) => {
    const userId = Number(req.user!.sub);

    /*
     * Rate limit unggahan (audit #22b).
     *
     * Sebelumnya endpoint ini sama sekali tidak dibatasi: 15 kali unggah
     * beruntun semuanya lolos HTTP 200. Satu akun sah bisa menumpuk file
     * 2 MB tanpa batas di akun catbox (kuota habis, biaya membengkak).
     * 10 per jam cukup untuk pemakaian wajar (ganti foto beberapa kali).
     */
    if (await rateLimited(`avatar:${userId}`, 10, 60 * 60_000)) {
      res.status(429).json({ error: 'Terlalu banyak mengunggah foto. Coba lagi nanti.' });
      return;
    }

    if (!catboxEnabled()) {
      res.status(503).json({ error: 'Upload foto profil belum tersedia.' });
      return;
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) {
      res.status(400).json({ error: 'Tidak ada file yang dikirim.' });
      return;
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      res.status(413).json({
        error: `Ukuran foto maksimal ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB.`,
      });
      return;
    }

    try {
      // MIME tidak lagi diambil dari header klien — uploadAvatar
      // mendeteksinya sendiri dari magic bytes (audit #22a).
      const uploaded = await uploadAvatar({ buffer, size: buffer.length });

      // Simpan URL baru, lalu hapus foto lama dari catbox (best-effort).
      const before = await db.get<{ avatar_url: string | null }>(
        'SELECT avatar_url FROM users WHERE id = ?',
        [userId]
      );
      await db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [uploaded.url, userId]);

      if (before?.avatar_url && before.avatar_url !== uploaded.url) {
        void deleteFromCatbox(before.avatar_url);
      }

      res.json({ ok: true, avatarUrl: uploaded.url });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }
);

/** DELETE /api/account/avatar — hapus foto profil. */
avatarRouter.delete('/avatar', requireAuth, async (req, res) => {
  const userId = Number(req.user!.sub);
  const row = await db.get<{ avatar_url: string | null }>(
    'SELECT avatar_url FROM users WHERE id = ?',
    [userId]
  );
  await db.run('UPDATE users SET avatar_url = NULL WHERE id = ?', [userId]);
  if (row?.avatar_url) void deleteFromCatbox(row.avatar_url);
  res.json({ ok: true });
});

/** GET /api/account/avatar/config — apakah fitur aktif (untuk UI). */
avatarRouter.get('/avatar/config', (_req, res) => {
  res.json({ enabled: catboxEnabled(), maxBytes: MAX_AVATAR_BYTES });
});
