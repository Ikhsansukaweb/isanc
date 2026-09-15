/**
 * Hub WebSocket untuk chat global & feed aktivitas realtime.
 *
 * - Satu server WS menempel pada HTTP server yang sama (path /ws).
 * - Auth memakai access token JWT lewat query `?token=` atau pesan pertama
 *   { type: 'auth', token }. Tanpa token valid, koneksi hanya boleh menerima
 *   (read-only) — tidak boleh mengirim chat.
 * - Pesan yang disiarkan: chat, presence, feed, dan ping.
 *
 * Kenapa bukan socket.io: kita sudah punya `ws` dan butuh payload kecil;
 * socket.io menambah dependensi besar tanpa manfaat di sini.
 */
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken, type AuthPayload } from './auth.js';
import { db } from '../db/index.js';
import { sanitizeText } from './sanitize.js';

export type FeedKind =
  | 'deposit'
  | 'buy'
  | 'register';

export interface GlobalMessage {
  id: number;
  username: string;
  tag: string;
  body: string;
  avatarUrl?: string | null;
  createdAt: string;
  self?: boolean;
}

export interface FeedItem {
  id: number;
  kind: FeedKind;
  label: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface Client {
  socket: WebSocket;
  claims: AuthPayload | null;
  alive: boolean;
}

const clients = new Set<Client>();

/** Batas panjang pesan chat global — cegah spam payload besar. */
const MAX_BODY = 300;
/** Batas pesan per menit per user (anti-spam). Dinaikkan 20 → 120. */
const RATE_LIMIT = Number(process.env.CHAT_RATE_LIMIT ?? 120);
const rateBucket = new Map<number, number[]>();

function rateLimited(userId: number): boolean {
  const now = Date.now();
  const list = (rateBucket.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  rateBucket.set(userId, list);
  return list.length > RATE_LIMIT;
}

function rowToFeed(r: {
  id: number; kind: string; label: string | null; body: string;
  meta: string | null; created_at: string;
}): FeedItem {
  let meta: Record<string, unknown> | null = null;
  if (r.meta) {
    try { meta = JSON.parse(r.meta); } catch { meta = null; }
  }
  return {
    id: r.id,
    kind: r.kind as FeedKind,
    label: r.label,
    body: r.body,
    meta,
    createdAt: r.created_at,
  };
}

/* ============ Baca data ============ */

export async function recentGlobalMessages(limit = 50, userId?: number): Promise<GlobalMessage[]> {
  const rows = await db.all<{
    id: number; user_id: number; username: string; tag: string;
    body: string; avatar_url: string | null; created_at: string;
  }>(
    `SELECT g.id, g.user_id, g.username, g.tag, g.body, g.created_at,
            u.avatar_url
     FROM global_messages g
     LEFT JOIN users u ON u.id = g.user_id
     ORDER BY g.id DESC LIMIT ?`,
    [limit]
  );

  return rows.reverse().map((r) => ({
    id: r.id,
    username: r.username,
    tag: r.tag,
    body: r.body,
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    self: userId != null && r.user_id === userId,
  }));
}

type FeedRow = Parameters<typeof rowToFeed>[0];

export async function recentFeed(limit = 30, kinds?: FeedKind[]): Promise<FeedItem[]> {
  let rows: FeedRow[];
  if (kinds && kinds.length > 0) {
    const ph = kinds.map(() => '?').join(',');
    rows = await db.all<FeedRow>(
      `SELECT id, kind, label, body, meta, created_at FROM activity_feed
       WHERE is_public = 1 AND kind IN (${ph}) ORDER BY id DESC LIMIT ?`,
      [...kinds, limit]
    );
  } else {
    rows = await db.all<FeedRow>(
      `SELECT id, kind, label, body, meta, created_at FROM activity_feed
       WHERE is_public = 1 ORDER BY id DESC LIMIT ?`,
      [limit]
    );
  }
  return rows.reverse().map(rowToFeed);
}

/* ============ Siarkan ============ */

function broadcast(payload: unknown, onlyAuthenticated = false) {
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (c.socket.readyState !== WebSocket.OPEN) continue;
    if (onlyAuthenticated && !c.claims) continue;
    try { c.socket.send(data); } catch { /* klien putus */ }
  }
}

/** Kirim pesan chat global baru — simpan lalu siarkan. */
export async function pushGlobalMessage(input: {
  userId: number;
  username: string;
  tag: string;
  body: string;
}): Promise<GlobalMessage | null> {
  // Sanitasi (#3): bersihkan tag HTML & entitas sebelum masuk database.
  // React memang meng-escape saat render, tapi itu satu-satunya lapisan —
  // begitu ada fitur ekspor/notifikasi/integrasi atau seorang dev memakai
  // dangerouslySetInnerHTML, payload lama di DB langsung jadi stored XSS.
  const body = sanitizeText(input.body, MAX_BODY);
  if (!body) return null;

  const info = await db.run(
    `INSERT INTO global_messages (user_id, username, tag, body) VALUES (?, ?, ?, ?)`,
    [input.userId, input.username, input.tag, body]
  );

  // Ambil ulang lewat JOIN supaya avatar pemilik ikut terkirim ke semua klien
  // (pesan baru langsung tampil dengan foto profil tanpa request tambahan).
  const row = await db.get<{
    id: number; username: string; tag: string; body: string;
    avatar_url: string | null; created_at: string;
  }>(
    `SELECT g.id, g.username, g.tag, g.body, g.created_at, u.avatar_url
     FROM global_messages g
     LEFT JOIN users u ON u.id = g.user_id
     WHERE g.id = ?`,
    [info.insertId]
  );
  if (!row) return null;

  const msg: GlobalMessage = {
    id: row.id,
    username: row.username,
    tag: row.tag,
    body: row.body,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
  };

  broadcast({ type: 'chat', message: msg });
  return msg;
}

/** Catat aktivitas ke feed dan siarkan ke dashboard (live deposit / pembelian bot). */
export async function pushFeed(input: {
  kind: FeedKind;
  userId?: number | null;
  label?: string | null;
  body: string;
  meta?: Record<string, unknown>;
  isPublic?: boolean;
}): Promise<FeedItem | null> {
  const body = input.body.trim().slice(0, 300);
  if (!body) return null;

  const info = await db.run(
    `INSERT INTO activity_feed (kind, user_id, label, body, meta, is_public)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.userId ?? null,
      input.label ?? null,
      body,
      input.meta ? JSON.stringify(input.meta) : null,
      input.isPublic === false ? 0 : 1,
    ]
  );

  const row = await db.get<Parameters<typeof rowToFeed>[0]>(
    `SELECT id, kind, label, body, meta, created_at FROM activity_feed WHERE id = ?`,
    [info.insertId]
  );
  if (!row) return null;

  const item = rowToFeed(row);
  broadcast({ type: 'feed', item });
  return item;
}

function broadcastPresence() {
  const online = clients.size;
  const authed = [...clients].filter((c) => c.claims).length;
  broadcast({ type: 'presence', online, authed });
}

/* ============ Server ============ */

/**
 * Origin yang boleh membuka WebSocket (audit #25 — CSWSH).
 *
 * WebSocket TIDAK dilindungi Same-Origin Policy: tanpa pemeriksaan Origin,
 * halaman milik penyerang bisa membuka koneksi ke server kita dan mencuri
 * snapshot chat/feed. Disamakan dengan CORS_ORIGINS di server.ts.
 */
const WS_ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ?? 'https://skadesmart.web.id,http://localhost:3000'
).split(',').map((o) => o.trim()).filter(Boolean);

/**
 * Origin kosong = klien non-browser (skrip uji, curl, ws). Itu TIDAK otomatis
 * aman karena penyerang juga bisa memakai skrip; tapi karena skrip tidak
 * membawa cookie pengguna, CSWSH tidak berlaku. Kita izinkan hanya dari
 * loopback supaya skrip uji internal tetap jalan.
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    const remote = req.socket.remoteAddress ?? '';
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }
  return WS_ALLOWED_ORIGINS.includes(origin);
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    // Lapis 1: tolak SEBELUM handshake selesai (paling efisien).
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

  wss.on('connection', async (socket, req) => {
    // Lapis 2: periksa ulang Origin (jaga-jaga bila reverse proxy menimpa
    // verifyClient atau konfigurasi berubah).
    if (!originAllowed(req)) {
      socket.close(1008, 'Origin tidak diizinkan');
      return;
    }

    const client: Client = { socket, claims: null, alive: true };

    // Token boleh datang dari query (?token=) — cara utama untuk browser,
    // karena WebSocket API tidak bisa mengirim header Authorization.
    try {
      const url = new URL(req.url ?? '/ws', 'http://localhost');
      const qToken = url.searchParams.get('token');
      if (qToken) {
        const claims = await verifyAccessToken(qToken);
        // Hormati pemblokiran akun (samakan dengan requireAuth).
        const u = await db.get<{ is_banned: number }>(
          'SELECT is_banned FROM users WHERE id = ?',
          [Number(claims.sub)]
        );
        if (u && !u.is_banned) client.claims = claims;
      }
    } catch {
      client.claims = null;
    }

    clients.add(client);
    broadcastPresence();

    /*
     * Snapshot awal (50 pesan chat + 30 feed) HANYA dikirim ke koneksi yang
     * sudah terautentikasi (audit #25).
     *
     * Sebelumnya data ini dikirim tanpa token, sehingga halaman mana pun milik
     * penyerang cukup membuka WebSocket lalu menerima seluruh riwayat chat
     * global dan feed aktivitas para pengunjungnya.
     */
    const userId = client.claims?.sub ? Number(client.claims.sub) : undefined;

    if (!client.claims) {
      // Minta autentikasi. Kalau tidak datang dalam 10 detik, tutup koneksi
      // supaya tidak ada socket menganggur.
      socket.send(
        JSON.stringify({
          type: 'need-auth',
          error: 'Koneksi belum terautentikasi — kirim { type: "auth", token }.',
        })
      );
      const authTimer = setTimeout(() => {
        if (!client.claims) {
          try { socket.close(1008, 'Belum autentikasi'); } catch { /* abaikan */ }
        }
      }, 10_000);
      socket.once('close', () => clearTimeout(authTimer));
      // Jangan return — soket tetap hidup agar klien bisa mengirim token.
    } else {
      const [chat, feed] = await Promise.all([
        recentGlobalMessages(50, userId),
        recentFeed(30, ['deposit', 'buy']),
      ]);
      socket.send(
        JSON.stringify({
          type: 'init',
          chat,
          feed,
          me: { username: client.claims.username, tag: client.claims.tag },
        })
      );
    }

    socket.on('pong', () => { client.alive = true; });

    socket.on('message', async (raw) => {
      let data: { type?: string; token?: string; body?: string };
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (data.type === 'auth' && typeof data.token === 'string') {
        try {
          const claims = await verifyAccessToken(data.token);
          // Hormati pemblokiran akun (samakan dengan requireAuth).
          const u = await db.get<{ is_banned: number }>(
            'SELECT is_banned FROM users WHERE id = ?',
            [Number(claims.sub)]
          );
          if (!u || u.is_banned) {
            client.claims = null;
            socket.send(JSON.stringify({ type: 'error', error: 'Akun tidak aktif.' }));
            return;
          }
          client.claims = claims;
          // Kirim snapshot setelah autentikasi berhasil (audit #25).
          const userId = Number(claims.sub);
          const [chat, feed] = await Promise.all([
            recentGlobalMessages(50, userId),
            recentFeed(30, ['deposit', 'buy']),
          ]);
          socket.send(
            JSON.stringify({
              type: 'init',
              chat,
              feed,
              me: { username: claims.username, tag: claims.tag },
            })
          );
        } catch {
          client.claims = null;
          socket.send(JSON.stringify({ type: 'error', error: 'Token tidak valid.' }));
        }
        return;
      }

      if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (data.type === 'chat') {
        if (!client.claims) {
          socket.send(JSON.stringify({ type: 'error', error: 'Masuk dulu untuk ikut chat.' }));
          return;
        }
        const userId = Number(client.claims.sub);
        if (rateLimited(userId)) {
          socket.send(JSON.stringify({ type: 'error', error: 'Terlalu cepat. Tunggu sebentar.' }));
          return;
        }
        const sent = await pushGlobalMessage({
          userId,
          username: client.claims.username,
          tag: client.claims.tag,
          body: String(data.body ?? ''),
        });
        if (!sent) {
          socket.send(JSON.stringify({ type: 'error', error: 'Pesan kosong.' }));
        }
      }
    });

    socket.on('close', () => {
      clients.delete(client);
      broadcastPresence();
    });

    socket.on('error', () => {
      clients.delete(client);
      broadcastPresence();
    });
  });

  // Bersihkan koneksi yang sudah mati (klien hilang tanpa close).
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.socket.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      try { c.socket.ping(); } catch { /* abaikan */ }
    }
    broadcastPresence();
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('[ws] realtime hub siap di /ws');
  return wss;
}
