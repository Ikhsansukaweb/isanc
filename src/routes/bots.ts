import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { pushFeed } from '../lib/realtime.js';
import { getPlan, priceForDays } from '../lib/plans.js';
import { botManager } from '../core/manager.js';
import { assertPublicHost } from '../lib/ssrf.js';
import { rateLimited } from '../lib/rateLimit.js';

export const botsRouter = Router();

botsRouter.use(requireAuth);

/** "Rp3.000" — format harga gaya Indonesia. */
const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

/** "isan#5622" — dipakai kalimat feed aktivitas. */
async function ownerLabel(userId: number): Promise<string> {
  const u = await db.get<{ username: string; tag: string }>(
    'SELECT username, tag FROM users WHERE id = ?',
    [userId]
  );
  return u ? `${u.username}#${u.tag}` : `user#${userId}`;
}

interface UserBotRow {
  id: number;
  user_id: number;
  label: string;
  base_name: string;
  tag: string;
  host: string;
  port: number;
  version: string | null;
  offline_mode: number;
  expires_at: number | null;
  active: number;
  created_at: string;
}

async function ownBot(userId: number, label: string): Promise<UserBotRow | undefined> {
  return db.get<UserBotRow>('SELECT * FROM user_bots WHERE user_id = ? AND label = ?', [
    userId,
    label,
  ]);
}

function decorate(row: UserBotRow) {
  const live = botManager.get(row.label);
  const status = live ? live.toStatusJSON() : null;
  const now = Date.now();
  // expires_at dari MySQL BIGINT bisa kembali sebagai string → paksa Number.
  const expiresAt = row.expires_at == null ? null : Number(row.expires_at);
  const expired = expiresAt != null && expiresAt < now;
  return {
    ...row,
    expires_at: expiresAt,
    expiresAt,
    expired,
    remainingMs: expiresAt != null ? Math.max(0, expiresAt - now) : null,
    live: status,
  };
}

/** GET /api/bots — daftar bot milik user */
botsRouter.get('/', async (req, res) => {
  const rows = await db.all<UserBotRow>(
    'SELECT * FROM user_bots WHERE user_id = ? ORDER BY id DESC',
    [Number(req.user!.sub)]
  );
  res.json(rows.map(decorate));
});

/** GET /api/bots/live — state live semua bot (untuk dashboard) */
botsRouter.get('/live', async (req, res) => {
  const userId = Number(req.user!.sub);
  const labelRows = await db.all<{ label: string }>(
    'SELECT label FROM user_bots WHERE user_id = ?',
    [userId]
  );
  const labels = new Set(labelRows.map((r) => r.label));
  // Admin lihat semua; user biasa hanya bot miliknya
  const all = botManager.list();
  res.json(req.user!.role === 'admin' ? all : all.filter((b) => labels.has(b.name)));
});

const createSchema = z.object({
  baseName: z.string().min(1).max(30).regex(/^[a-zA-Z0-9_ -]+$/, 'Nama bot hanya huruf, angka, spasi, underscore, strip.'),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(19132),
  version: z.string().max(20).optional(),
  offlineMode: z.boolean().default(false),
});

/**
 * POST /api/bots — daftar bot baru.
 * Nama otomatis ditambah tag pemilik: "bot1" -> "bot1#1122".
 * Wajib punya masa aktif (sewa) — pakai saldo.
 */
botsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { baseName, host, port, version, offlineMode } = parsed.data;
  const userId = Number(req.user!.sub);

  // Anti-SSRF (#7): host dipakai server untuk membuka koneksi keluar, jadi
  // alamat internal (localhost, 127.0.0.1, 169.254.169.254 metadata cloud,
  // 10/172.16/192.168) wajib ditolak.
  const hostErr = await assertPublicHost(host);
  if (hostErr) {
    res.status(400).json({ error: hostErr });
    return;
  }

  // Batasi pembuatan bot (cegah spam pendaftaran).
  if (await rateLimited(`bots:create:${userId}`, 20, 60 * 60_000)) {
    res.status(429).json({ error: 'Terlalu banyak menambah bot. Coba lagi nanti.' });
    return;
  }

  const cleanBase = baseName.trim().replace(/\s+/g, '');
  const label = `${cleanBase}#${req.user!.tag}`;

  const dup = await db.get('SELECT 1 AS x FROM user_bots WHERE label = ?', [label]);
  if (dup) {
    res.status(409).json({ error: `Bot "${label}" sudah ada.` });
    return;
  }

  const info = await db.run(
    `INSERT INTO user_bots (user_id, label, base_name, tag, host, port, version, offline_mode, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      userId,
      label,
      cleanBase,
      req.user!.tag,
      host,
      port,
      version?.trim() || '1.26.30',
      offlineMode ? 1 : 0,
    ]
  );

  const row = await db.get<UserBotRow>('SELECT * FROM user_bots WHERE id = ?', [info.insertId]);
  if (!row) {
    res.status(500).json({ error: 'Gagal menyimpan bot.' });
    return;
  }
  res.status(201).json({ ...decorate(row), message: 'Bot ditambahkan. Aktifkan masa sewa untuk menjalankannya.' });
});

/**
 * POST /api/bots/:label/rent — perpanjang/aktifkan masa sewa pakai saldo.
 * body: { plan: 'harian' | 'mingguan' | 'bulanan' | 'custom', days?: number }
 */
const rentSchema = z.object({
  plan: z.string().min(1),
  days: z.number().int().min(1).max(3650).optional(),
});

botsRouter.post('/:label/rent', async (req, res) => {
  const parsed = rentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.' });
    return;
  }
  const userId = Number(req.user!.sub);
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(userId, label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }

  let days: number;
  let price: number;
  let planId = parsed.data.plan;
  if (planId === 'custom') {
    if (!parsed.data.days) {
      res.status(400).json({ error: 'Jumlah hari wajib untuk paket custom.' });
      return;
    }
    days = parsed.data.days;
    price = priceForDays(days);
  } else {
    const plan = getPlan(planId);
    if (!plan) {
      res.status(400).json({ error: 'Paket tidak dikenal.' });
      return;
    }
    days = plan.days;
    price = plan.price;
    planId = plan.id;
  }

  try {
    // Semua langkah uang harus satu transaksi: potong saldo, perpanjang sewa,
    // catat order + mutasi. Kalau salah satu gagal, semuanya dibatalkan.
    const result = await db.transaction(async (tx) => {
      // FOR UPDATE mengunci baris user sampai transaksi selesai (#12).
      // Tanpa ini, dua request sewa bersamaan sama-sama membaca saldo awal
      // yang sama, sama-sama lolos cek, lalu saling menimpa nilai akhir →
      // dua masa sewa aktif tapi saldo hanya terpotong sekali.
      const user = await tx.get<{ balance: number }>(
        'SELECT balance FROM users WHERE id = ? FOR UPDATE',
        [userId]
      );
      if (!user) throw Object.assign(new Error('Akun tidak ditemukan.'), { code: 'NO_USER' });
      const balance = Number(user.balance);
      if (balance < price) {
        throw Object.assign(new Error('Saldo kurang.'), {
          code: 'INSUFFICIENT',
          needed: price,
          balance,
          short: price - balance,
        });
      }
      const after = balance - price;

      // Kunci juga baris bot, lalu baca expires_at DI DALAM transaksi supaya
      // perpanjangan dihitung dari nilai yang konsisten.
      const locked = await tx.get<{ expires_at: number | null }>(
        'SELECT expires_at FROM user_bots WHERE id = ? FOR UPDATE',
        [row.id]
      );
      if (!locked) throw new Error('Bot tidak ditemukan.');

      // Potong saldo dengan ekspresi SQL + syarat saldo cukup. Kalau ada
      // request lain yang sudah memotong lebih dulu, affectedRows = 0 dan
      // transaksi ini dibatalkan (bukan diam-diam menimpa).
      const cut = await tx.run(
        'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
        [price, userId, price]
      );
      if (cut.affectedRows === 0) {
        throw Object.assign(new Error('Saldo kurang.'), {
          code: 'INSUFFICIENT',
          needed: price,
          balance,
          short: price - balance,
        });
      }

      // Perpanjang dari expires_at kalau masih aktif.
      const now = Date.now();
      const expiry = locked.expires_at == null ? null : Number(locked.expires_at);
      const base = expiry != null && expiry > now ? expiry : now;
      const newExpiry = base + days * 24 * 60 * 60 * 1000;

      await tx.run('UPDATE user_bots SET expires_at = ?, active = 1 WHERE id = ?', [
        newExpiry,
        row.id,
      ]);
      const order = await tx.run(
        `INSERT INTO orders (user_id, bot_id, plan, days, price, status) VALUES (?, ?, ?, ?, ?, 'paid')`,
        [userId, row.id, planId, days, price]
      );
      await tx.run(
        `INSERT INTO balance_transactions (user_id, type, amount, balance_after, description, ref)
         VALUES (?, 'purchase', ?, ?, ?, ?)`,
        [
          userId,
          -price,
          after,
          `Sewa bot ${label} — ${planId} (${days} hari)`,
          String(order.insertId),
        ]
      );

      return { newExpiry, after, orderId: order.insertId };
    });

    const fresh = await db.get<UserBotRow>('SELECT * FROM user_bots WHERE id = ?', [row.id]);
    if (!fresh) {
      res.status(500).json({ error: 'Bot hilang setelah pembelian.' });
      return;
    }

    // Feed publik disiarkan setelah transaksi sukses:
    // "isans#8064 beli bot1#8064 — 1 hari (Rp3.000)"
    await pushFeed({
      kind: 'buy',
      userId,
      label,
      body: `${await ownerLabel(userId)} beli ${label} — ${days} hari (${rupiah(price)})`,
      meta: { bot: label, plan: planId, days, price },
    });

    res.json({
      ...decorate(fresh),
      balance: result.after,
      orderId: result.orderId,
      message: `Masa sewa aktif sampai ${new Date(result.newExpiry).toLocaleString('id-ID')}.`,
    });
  } catch (e) {
    const err = e as Error & { code?: string; needed?: number; balance?: number; short?: number };
    if (err.code === 'INSUFFICIENT') {
      res.status(402).json({
        error: `Saldo kurang Rp${(err.short ?? 0).toLocaleString('id-ID')}. Butuh Rp${(err.needed ?? 0).toLocaleString('id-ID')}, saldo kamu Rp${(err.balance ?? 0).toLocaleString('id-ID')}.`,
        code: 'INSUFFICIENT_BALANCE',
        needed: err.needed,
        balance: err.balance,
        short: err.short,
      });
      return;
    }
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/bots/:label/connect — jalankan bot (wajib masa aktif) */
botsRouter.post('/:label/connect', async (req, res) => {
  const userId = Number(req.user!.sub);
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(userId, label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }
  const expiry = row.expires_at == null ? null : Number(row.expires_at);
  if (expiry == null || expiry < Date.now()) {
    res.status(402).json({
      error: 'Masa sewa belum aktif. Sewa bot dulu pakai saldo di halaman Saldo.',
      code: 'NOT_RENTED',
    });
    return;
  }

  // Versi WAJIB: kita memakai skipPing:true (ping bawaan bedrock-protocol memakai
  // backend raknet-native yang tidak tersedia), jadi versi tidak bisa dideteksi
  // otomatis. Tanpa versi server membalas "Unsupported version undefined".
  if (!row.version) {
    res.status(400).json({
      error: 'Versi Minecraft bot ini kosong. Pemilik bot harus mengisi versi server (mis. 1.26.30) lewat menu Tambah Bot / detail bot.',
      code: 'VERSION_REQUIRED',
    });
    return;
  }

  // Anti-SSRF (#7), lapis kedua: validasi ULANG host dari database tepat
  // sebelum koneksi dibuka. Ini menangkap bot lama yang dibuat sebelum
  // validasi dipasang (host-nya mungkin sudah menunjuk ke alamat internal).
  const connectHostErr = await assertPublicHost(row.host);
  if (connectHostErr) {
    res.status(400).json({
      error: `Host bot tidak diizinkan: ${connectHostErr} Ubah host di pengaturan bot.`,
      code: 'HOST_NOT_ALLOWED',
    });
    return;
  }

  try {
    const bot = botManager.connect({
      name: label,
      host: row.host,
      port: row.port,
      version: row.version,
      offline: row.offline_mode === 1,
      // username = nama dasar (tanpa tag) → cache auth tersimpan stabil per akun
      // Microsoft, tidak ikut berubah walau label bot punya hashtag.
      username: row.base_name,
      authProfile: row.base_name,
      // Pemilik dipakai engine untuk tahu bot siapa.
      ownerId: userId,
    } as never);

    // Kembalikan status awal supaya frontend tahu apakah butuh login Microsoft
    // (device code) atau sudah langsung masuk server.
    const status = bot.toStatusJSON();
    res.json({
      ok: true,
      label,
      status: status.status,
      msaCode: status.msaCode ?? null,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** GET /api/bots/:label — status bot milik user (kepemilikan + live) */
botsRouter.get('/:label', async (req, res) => {
  const userId = Number(req.user!.sub);
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(userId, label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }
  const live = botManager.get(label)?.toStatusJSON() ?? null;
  res.json({ ...decorate(row), live });
});

/** PATCH /api/bots/:label — ubah host/port/versi/offline mode */
const patchSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  version: z.string().max(20).optional(),
  offlineMode: z.boolean().optional(),
});

botsRouter.patch('/:label', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Data tidak valid.' });
    return;
  }
  const userId = Number(req.user!.sub);
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(userId, label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }

  const { host, port, version, offlineMode } = parsed.data;

  // Anti-SSRF (#7): periksa host baru sebelum disimpan.
  if (host !== undefined) {
    const hostErr = await assertPublicHost(host);
    if (hostErr) {
      res.status(400).json({ error: hostErr });
      return;
    }
  }

  await db.run(
    `UPDATE user_bots
     SET host = COALESCE(?, host),
         port = COALESCE(?, port),
         version = COALESCE(?, version),
         offline_mode = COALESCE(?, offline_mode)
     WHERE id = ?`,
    [
      host ?? null,
      port ?? null,
      version && version.trim() ? version.trim() : null,
      offlineMode == null ? null : offlineMode ? 1 : 0,
      row.id,
    ]
  );

  const fresh = await db.get<UserBotRow>('SELECT * FROM user_bots WHERE id = ?', [row.id]);
  res.json({ ...decorate(fresh ?? row), message: 'Pengaturan bot disimpan.' });
});

/** POST /api/bots/:label/disconnect */
botsRouter.post('/:label/disconnect', async (req, res) => {
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(Number(req.user!.sub), label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }
  botManager.disconnect(label);
  res.json({ ok: true });
});

/** DELETE /api/bots/:label */
botsRouter.delete('/:label', async (req, res) => {
  const userId = Number(req.user!.sub);
  const label = decodeURIComponent(req.params.label);
  const row = await ownBot(userId, label);
  if (!row) {
    res.status(404).json({ error: 'Bot tidak ditemukan.' });
    return;
  }
  botManager.disconnect(label);
  await db.run('DELETE FROM user_bots WHERE id = ?', [row.id]);
  res.json({ ok: true });
});
