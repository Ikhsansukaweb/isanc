import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { botsRouter } from './routes/bots.js';
import { chatRouter } from './routes/chat.js';
import { avatarRouter } from './routes/avatar.js';
import { optionalAuth, safeEqual } from './lib/auth.js';
import { rateLimited, pruneRateLimits } from './lib/rateLimit.js';

export function createApp(): express.Express {
  const app = express();

  // Jangan bocorkan stack yang dipakai (temuan #6c).
  app.disable('x-powered-by');

  // Di belakang Cloudflare Tunnel + Nginx, IP asli pengirim ada di header
  // X-Forwarded-For. Tanpa ini req.ip selalu 127.0.0.1 sehingga rate limit
  // global menumpuk jadi satu ember untuk semua orang.
  app.set('trust proxy', true);

  /*
   * Security headers (temuan #6a).
   *
   * Sebelumnya `contentSecurityPolicy: false` dengan komentar "dikelola
   * frontend" — padahal frontend sama sekali tidak memasang CSP, jadi tidak
   * ada lapis kedua untuk XSS. Backend ini murni JSON API (tidak pernah
   * mengirim HTML), jadi CSP paling ketat bisa dipakai: 'none' untuk semua.
   * CSP untuk halaman HTML diatur di web/next.config.mjs.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    })
  );

  // CORS — hanya izinkan origin frontend
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'https://skadesmart.web.id,http://localhost:3000').split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS not allowed'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '100kb' })); // batasi body
  app.use(cookieParser());
  app.use(morgan('dev'));

  /*
   * Rate limit global.
   *
   * Naik dari 600 → 20.000 req / 15 menit per IP. Alasannya dua:
   *  1. Dashboard melakukan polling berkala (sidebar 3s, detail bot 2s,
   *     deposit 4s) sehingga satu tab terbuka saja bisa ribuan request.
   *  2. Lewat Cloudflare Tunnel banyak pengguna bisa terlihat berasal dari
   *     IP yang sama, jadi ember per-IP cepat penuh.
   * Bisa diubah tanpa rebuild: set env RATE_LIMIT_MAX.
   */
  const LIMIT = Number(process.env.RATE_LIMIT_MAX ?? 20_000);
  const WINDOW_MS = 15 * 60_000;

  /*
   * Bypass rate limit untuk trafik internal (temuan #2c).
   *
   * Sebelumnya cukup mengirim header apa pun yang namanya cocok — tanpa
   * nilai rahasia — sehingga siapa pun yang tahu nama headernya (atau
   * menebaknya) mendapat request TAK TERBATAS. Sekarang header itu wajib
   * menyertakan INTERNAL_SECRET yang dibandingkan secara timing-safe.
   */
  const INTERNAL_HEADER = process.env.INTERNAL_HEADER ?? 'x-isanc-internal';
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  if (!INTERNAL_SECRET) {
    console.warn(
      '[server] INTERNAL_SECRET belum diset — bypass rate limit lewat header ' +
        `${INTERNAL_HEADER} DIMATIKAN. Set INTERNAL_SECRET (32+ karakter acak) di .env.`
    );
  }

  app.use(async (req, _res, next) => {
    const ip = req.ip ?? 'unknown';

    // Loopback (akses langsung ke port 3737) tidak dibatasi.
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();

    // Request internal WAJIB membawa secret yang benar.
    const given = req.headers[INTERNAL_HEADER];
    if (
      INTERNAL_SECRET &&
      typeof given === 'string' &&
      safeEqual(given, INTERNAL_SECRET)
    ) {
      return next();
    }

    // Penghitung disimpan di MySQL (temuan #2b) supaya TIDAK hilang saat
    // `pm2 restart` dan tetap konsisten kalau dijalankan multi-proses.
    try {
      if (await rateLimited(`global:${ip}`, LIMIT, WINDOW_MS)) {
        const err = new Error('Rate limit exceeded');
        (err as any).status = 429;
        return next(err);
      }
    } catch (e) {
      // Jangan jadikan kegagalan rate limit sebagai jalan pintas untuk
      // melewatinya: log lalu tolak request supaya fail-closed.
      console.error('[server] rate limit gagal:', (e as Error).message);
      const err = new Error('Rate limit tidak tersedia');
      (err as any).status = 503;
      return next(err);
    }
    next();
  });

  // Bersihkan baris rate limit kedaluwarsa tiap 10 menit (tanpa memblokir).
  const pruneTimer = setInterval(() => {
    pruneRateLimits().catch((e) => console.error('[server] prune rate limit:', e.message));
  }, 10 * 60_000);
  pruneTimer.unref?.();

  app.use('/api/auth', authRouter);
  app.use('/api/account', authRouter);
  // Foto profil: route khusus karena menerima body mentah (bukan JSON).
  // Dipasang SEBELUM express.json supaya body biner tidak diurai sebagai JSON.
  app.use('/api/account', avatarRouter);
  app.use('/api/bots', botsRouter);
  // Chat global & feed: boleh dibaca anonim, kirim pesan wajib login.
  app.use('/api', optionalAuth, chatRouter);
  app.use('/api', apiRouter);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as any).status ?? 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
  });

  return app;
}