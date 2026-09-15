/**
 * Rate limit berbasis MySQL (temuan #2b + #22).
 *
 * Rate limit in-memory punya dua cacat:
 *  1. Hilang saat `pm2 restart` → penyerang dapat kuota baru tanpa usaha.
 *  2. Tiap proses punya penghitung sendiri → limit jadi N× lipat kalau
 *     dijalankan dengan `pm2 -i N`.
 *
 * Di sini penghitung disimpan di tabel `rate_limits` dan ditambah secara
 * ATOMIK dengan UPSERT, sehingga aman lintas-proses.
 */
import { db } from '../db/index.js';

/**
 * Tambah penghitung lalu nilai apakah permintaan harus ditolak.
 *
 * @param key    kunci unik, mis. `login:u:isan` atau `avatar:3`
 * @param max    jumlah maksimum dalam satu jendela
 * @param windowMs lebar jendela dalam milidetik
 * @returns true kalau permintaan MELEBIHI batas (harus ditolak)
 */
export async function rateLimited(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const resetAt = now + windowMs;

  // UPSERT atomik: kalau jendela sudah lewat → reset ke 1, kalau belum → +1.
  // Dilakukan dalam satu statement supaya tidak ada celah race.
  await db.run(
    `INSERT INTO rate_limits (k, count, reset_at) VALUES (?, 1, ?)
     ON DUPLICATE KEY UPDATE
       count    = IF(reset_at < VALUES(reset_at) - ?, 1, count + 1),
       reset_at = IF(reset_at < VALUES(reset_at) - ?, VALUES(reset_at), reset_at)`,
    [key, resetAt, windowMs, windowMs]
  );

  const row = await db.get<{ count: number }>(
    'SELECT count FROM rate_limits WHERE k = ?',
    [key]
  );
  return (row?.count ?? 1) > max;
}

/** Hapus penghitung (dipakai setelah login berhasil supaya user sah tidak terkunci). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.run('DELETE FROM rate_limits WHERE k = ?', [key]);
}

/** Info sisa kuota — berguna untuk header X-RateLimit-* atau pesan error. */
export async function rateLimitInfo(
  key: string,
  max: number
): Promise<{ used: number; remaining: number }> {
  const row = await db.get<{ count: number }>('SELECT count FROM rate_limits WHERE k = ?', [key]);
  const used = row?.count ?? 0;
  return { used, remaining: Math.max(0, max - used) };
}

/** Bersihkan baris kedaluwarsa (dipanggil berkala dari index.ts). */
export async function pruneRateLimits(): Promise<number> {
  const res = await db.run('DELETE FROM rate_limits WHERE reset_at < ?', [Date.now()]);
  return res.affectedRows;
}
