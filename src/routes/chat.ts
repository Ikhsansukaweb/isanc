/**
 * Route chat global & feed aktivitas (live deposit + pesan bot).
 *
 * Real-time utama lewat WebSocket (/ws), tapi REST ini dipakai untuk:
 * - memuat riwayat awal saat halaman dibuka,
 * - fallback kalau WebSocket diblokir jaringan,
 * - mengirim pesan tanpa perlu membuka socket.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  recentGlobalMessages,
  recentFeed,
  pushGlobalMessage,
  pushFeed,
  type FeedKind,
} from '../lib/realtime.js';

export const chatRouter = Router();

const ALLOWED_KINDS: FeedKind[] = [
  'deposit',
  'buy',
  'register',
];

/** GET /api/chat/global — riwayat chat global (publik, boleh tanpa login) */
chatRouter.get('/chat/global', async (req, res) => {
  // Publik: boleh dibaca tanpa login. Kalau ada token valid (dipasang
  // optionalAuth di server.ts), pesan sendiri ditandai `self: true`.
  let userId: number | undefined;
  if (req.user?.sub) userId = Number(req.user.sub);

  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  res.json({ messages: await recentGlobalMessages(limit, userId) });
});

const sendSchema = z.object({
  body: z.string().min(1).max(300),
});

/** POST /api/chat/global — kirim pesan chat global (wajib login) */
chatRouter.post('/chat/global', requireAuth, async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Pesan tidak valid (1–300 karakter).' });
    return;
  }

  const msg = await pushGlobalMessage({
    userId: Number(req.user!.sub),
    username: req.user!.username,
    tag: req.user!.tag,
    body: parsed.data.body,
  });

  if (!msg) {
    res.status(400).json({ error: 'Pesan kosong.' });
    return;
  }
  res.status(201).json({ message: msg });
});

/** GET /api/feed?kind=deposit,buy&limit=30 — feed aktivitas */
chatRouter.get('/feed', async (req, res) => {
  const raw = String(req.query.kind ?? '').trim();
  const kinds = raw
    ? (raw.split(',').map((k) => k.trim()).filter((k) => ALLOWED_KINDS.includes(k as FeedKind)) as FeedKind[])
    : undefined;
  const limit = Math.min(Number(req.query.limit ?? 30) || 30, 100);
  res.json({ items: await recentFeed(limit, kinds) });
});

/** Konfirmasi deposit manual (dipakai sistem saat deposit terbayar). */
export function announceDeposit(input: {
  userId: number;
  label: string;
  amount: number;
  kode: string;
}) {
  return pushFeed({
    kind: 'deposit',
    userId: input.userId,
    label: input.label,
    body: `${input.label} berhasil deposit Rp${input.amount.toLocaleString('id-ID')}`,
    meta: { amount: input.amount, kode: input.kode },
  });
}
