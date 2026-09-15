import { Router } from 'express';
import { z } from 'zod';
import { botManager } from '../core/manager.js';
import {
  BotConfigSchema,
  ChatMessageSchema,
} from '../utils/validation.js';
import type { BotConfig } from '../utils/validation.js';
import { db } from '../db/index.js';
import { aiChat, getAiHistory, clearAiHistory, getServerStats } from '../lib/ai.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { getOwnedBot, ownedLabels, isBotOwner } from '../lib/botAccess.js';

export const apiRouter = Router();

function parse<T>(schema: z.ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { ok: true, data: result.data };
}

/** GET /api/health */
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/** GET /api/stats — RAM, CPU, uptime, bot aktif */
apiRouter.get('/stats', (_req, res) => {
  try {
    res.json(getServerStats());
  } catch (e) {
    console.error('[stats] gagal:', (e as Error).stack ?? e);
    res.status(500).json({ error: 'Gagal mengambil statistik server.' });
  }
});

/**
 * GET /api/ai/history — riwayat percakapan AI (session/memori).
 *
 * AI dinonaktifkan di frontend, tapi endpoint backend sengaja dibiarkan hidup
 * supaya mudah diaktifkan kembali. Dibatasi ke admin dulu karena riwayat ini
 * bersifat GLOBAL (bukan per-user) — pengguna biasa tidak boleh membacanya.
 */
apiRouter.get('/ai/history', requireAuth, requireAdmin, async (_req, res) => {
  const messages = await getAiHistory(30);
  res.json({ messages, hasHistory: messages.length > 0 });
});

/** POST /api/ai/chat — tanya AI dengan konteks session */
apiRouter.post('/ai/chat', requireAuth, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message wajib diisi' });
  if (message.length > 4000) return res.status(400).json({ error: 'message terlalu panjang (maks 4000)' });
  try {
    const result = await aiChat(message);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** DELETE /api/ai/history — mulai session baru (hapus memori). Admin saja. */
apiRouter.delete('/ai/history', requireAuth, requireAdmin, async (_req, res) => {
  await clearAiHistory();
  res.json({ ok: true, message: 'Riwayat AI dihapus — session baru dimulai' });
});

/** GET /api/bots — daftar semua bot aktif (admin) atau milik sendiri */
apiRouter.get('/bots', requireAuth, async (req, res) => {
  const all = botManager.list();
  if (req.user!.role === 'admin') return res.json(all);

  const labels = new Set(await ownedLabels(Number(req.user!.sub)));
  res.json(all.filter((b) => labels.has(b.name)));
});

/*
 * ============ Endpoint kontrol bot ============
 *
 * SEMUA endpoint di bawah ini menerima `:name` (nama bot). Sebelumnya hanya
 * `requireAuth` yang dipasang, sehingga pengguna mana pun yang punya akun sah
 * bisa mengendalikan bot milik orang lain (audit #5a / #10 — Broken Access
 * Control & IDOR).
 *
 * Sekarang setiap handler memakai `getOwnedBot(req, res)` yang memverifikasi
 * kepemilikan lewat tabel user_bots dan membalas 404 (bukan 403) supaya
 * keberadaan bot milik orang lain tidak bisa dipetakan.
 */

/** GET /api/bot/:name — state satu bot */
apiRouter.get('/bot/:name', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  res.json(bot.toStatusJSON());
});

/** GET /api/bot/:name/auth — cek kode Microsoft auth pending */
apiRouter.get('/bot/:name/auth', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  res.json({ authCode: bot.getPendingAuthCode() });
});

/**
 * POST /api/bot/connect — connect bot dari body config.
 *
 * Di sini bot belum tentu ada di database (route lama), jadi kepemilikan
 * diperiksa lewat `name`: kalau bot dengan nama itu sudah terdaftar, hanya
 * pemiliknya yang boleh connect.
 */
apiRouter.post('/bot/connect', requireAuth, async (req, res) => {
  const parsed = parse(BotConfigSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const name = parsed.data.name ?? 'bot';
  const userId = Number(req.user!.sub);

  if (req.user!.role !== 'admin' && !(await isBotOwner(userId, name))) {
    return res.status(404).json({ error: 'Bot tidak ditemukan.' });
  }

  // Amankan ownerId: selalu dari token, jangan dari body (anti mass assignment).
  const config = { ...parsed.data, ownerId: userId } as BotConfig;
  try {
    const bot = botManager.connect(config);
    res.json({ ok: true, bot: bot.toStatusJSON().name });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

/** POST /api/bot/:name/disconnect */
apiRouter.post('/bot/:name/disconnect', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  botManager.disconnect(String(req.params.name));
  res.json({ ok: true, message: `Bot '${req.params.name}' diputuskan` });
});

/** POST /api/bot/:name/chat */
apiRouter.post('/bot/:name/chat', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const parsed = parse(ChatMessageSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    bot.chatSend(parsed.data.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

/** POST /api/bot/:name/move — arah tekan/lepas (forward/back/left/right/sneak) */
apiRouter.post('/bot/:name/move', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const dir = typeof req.body?.direction === 'string' ? req.body.direction : null;
  const active = req.body?.active === true;
  if (!dir || !['forward', 'back', 'left', 'right', 'sneak'].includes(dir)) {
    return res.status(400).json({ error: 'direction harus forward|back|left|right|sneak' });
  }
  const result = bot.setMove(dir, active);
  if (result) return res.status(400).json({ error: result.message });
  res.json({ ok: true });
});

/** POST /api/bot/:name/jump */
apiRouter.post('/bot/:name/jump', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.jump();
  res.json({ ok: true });
});

/** POST /api/bot/:name/turn — { deltaYaw, deltaPitch } */
apiRouter.post('/bot/:name/turn', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const dy = Number(req.body?.deltaYaw) || 0;
  const dp = Number(req.body?.deltaPitch) || 0;
  bot.turn(dy, dp);
  res.json({ ok: true });
});

/** POST /api/bot/:name/goto — { x, y?, z } */
apiRouter.post('/bot/:name/goto', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const x = Number(req.body?.x);
  const z = Number(req.body?.z);
  if (Number.isNaN(x) || Number.isNaN(z)) return res.status(400).json({ error: 'x dan z wajib angka' });
  const y = req.body?.y === undefined || req.body?.y === null || req.body?.y === '' ? null : Number(req.body.y);
  bot.gotoCoordinate(x, y, z);
  res.json({ ok: true });
});

/** POST /api/bot/:name/goto/cancel */
apiRouter.post('/bot/:name/goto/cancel', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.cancelGoto();
  res.json({ ok: true });
});

/** POST /api/bot/:name/attack — pukul entity / mecah block */
apiRouter.post('/bot/:name/attack', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.attack();
  res.json({ ok: true });
});

/** POST /api/bot/:name/place — taruh block */
apiRouter.post('/bot/:name/place', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.placeBlock();
  res.json({ ok: true });
});

/** POST /api/bot/:name/use — klik kanan pakai item */
apiRouter.post('/bot/:name/use', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.useItem();
  res.json({ ok: true });
});

/** POST /api/bot/:name/hotbar — { slot: 0-8 } */
apiRouter.post('/bot/:name/hotbar', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.selectHotbarSlot(Number(req.body?.slot));
  res.json({ ok: true });
});

/** POST /api/bot/:name/container/open — buka chest ({x?,y?,z?}) */
apiRouter.post('/bot/:name/container/open', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const x = req.body?.x === undefined ? undefined : Number(req.body.x);
  const y = req.body?.y === undefined ? undefined : Number(req.body.y);
  const z = req.body?.z === undefined ? undefined : Number(req.body.z);
  bot.openContainer(x, y, z);
  res.json({ ok: true });
});

/** POST /api/bot/:name/container/close */
apiRouter.post('/bot/:name/container/close', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.closeContainer();
  res.json({ ok: true });
});

/** POST /api/bot/:name/container/click — klik slot chest {slot} */
apiRouter.post('/bot/:name/container/click', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  bot.clickContainerSlot(Number(req.body?.slot));
  res.json({ ok: true });
});

/** POST /api/bot/:name/afk — { enabled } */
apiRouter.post('/bot/:name/afk', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  const enabled = req.body?.enabled === true;
  const result = bot.setAfk(enabled);
  res.json({ ok: true, message: result.message });
});

/** GET /api/bot/:name/inventory */
apiRouter.get('/bot/:name/inventory', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  try {
    res.json(bot.toStatusJSON().inventory);
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

/** GET /api/bot/:name/modules */
apiRouter.get('/bot/:name/modules', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  res.json(bot.getModules());
});

/** POST /api/bot/:name/modules/toggle */
apiRouter.post('/bot/:name/modules/toggle', requireAuth, async (req, res) => {
  const bot = await getOwnedBot(req, res);
  if (!bot) return;
  // Multi-bot: toggle module per-instance sekarang no-op (semua fitur
  // inherent di BotClient) — biarkan respon sukses untuk kompatibilitas
  res.json({ ok: true, message: 'Fitur aktif otomatis setelah bot spawn' });
});

/**
 * GET /api/logs — log chat bot.
 *
 * Sebelumnya membocorkan log SEMUA bot SEMUA pengguna ke siapa pun yang
 * login (audit #10). Sekarang dibatasi: pengguna biasa hanya melihat log
 * bot miliknya sendiri; admin melihat semua.
 */
apiRouter.get('/logs', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const botName = typeof req.query.bot === 'string' ? req.query.bot : null;
  const userId = Number(req.user!.sub);
  const isAdmin = req.user!.role === 'admin';

  // Filter nama bot yang boleh dilihat.
  const labels = isAdmin ? null : await ownedLabels(userId);
  if (!isAdmin && labels !== null && labels.length === 0) return res.json([]);

  if (botName) {
    // Minta log bot tertentu → pastikan boleh.
    if (!isAdmin && labels !== null && !labels.includes(botName)) {
      return res.status(404).json({ error: 'Bot tidak ditemukan.' });
    }
    const rows = await db.all(
      `SELECT id, session_id, direction, message, timestamp
       FROM chat_logs WHERE session_id = (SELECT id FROM bot_sessions WHERE name = ? ORDER BY id DESC LIMIT 1)
       ORDER BY id DESC LIMIT ?`,
      [botName, limit]
    );
    return res.json(rows);
  }

  if (isAdmin) {
    const rows = await db.all(
      `SELECT c.id, c.session_id, s.name AS bot, c.direction, c.message, c.timestamp
       FROM chat_logs c LEFT JOIN bot_sessions s ON s.id = c.session_id
       ORDER BY c.id DESC LIMIT ?`,
      [limit]
    );
    return res.json(rows);
  }

  // Pengguna biasa: hanya log bot miliknya.
  const ph = labels!.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT c.id, c.session_id, s.name AS bot, c.direction, c.message, c.timestamp
     FROM chat_logs c
     JOIN bot_sessions s ON s.id = c.session_id
     WHERE s.name IN (${ph})
     ORDER BY c.id DESC LIMIT ?`,
    [...labels!, limit]
  );
  res.json(rows);
});
