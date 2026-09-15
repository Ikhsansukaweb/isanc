/**
 * Lapisan database — MySQL 8 via mysql2/promise.
 *
 * Sebelumnya project ini memakai SQLite (better-sqlite3) yang sinkron.
 * Sekarang semua operasi async, jadi siapa pun yang memanggil db harus
 * `await` (lihat db.query/db.get/db.all/db.run di bawah).
 *
 * Placeholder: tetap `?` supaya file lain nyaris tidak berubah — mysql2
 * memakai `?` yang sama seperti better-sqlite3.
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_NAME = process.env.DB_NAME ?? 'isanc';
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? 3306);
const DB_USER = process.env.DB_USER ?? 'root';
const DB_PASS = process.env.DB_PASSWORD ?? '';

// schema.mysql.sql disimpan di folder data (bukan src) supaya ikut ke
// production — tsc tidak menyalin file non-.ts ke dist/.
const SCHEMA_PATH =
  process.env.SCHEMA_PATH ?? join(__dirname, '..', '..', 'data', 'schema.mysql.sql');

/** Pool koneksi — dipakai bersama seluruh aplikasi. */
export const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // UTC supaya perilaku waktu sama seperti datetime('now') di SQLite dulu.
  timezone: 'Z',
  // Dukung beberapa statement per query (dipakai saat menjalankan schema.sql).
  multipleStatements: true,
  // MySQL 8 mengembalikan BIGINT sebagai string; kita ingin number.
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: true,
});

type Row = Record<string, unknown>;

/* ============ Helper query ============ */

/**
 * Jalankan query dan kembalikan semua baris.
 * Semua query lewat sini supaya logging & konversi terpusat.
 */
async function all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/** Ambil satu baris (atau undefined). */
async function get<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await all<T>(sql, params);
  return rows[0];
}

/** Jalankan perintah tulis. Mengembalikan insertId & affectedRows. */
async function run(
  sql: string,
  params: unknown[] = []
): Promise<{ insertId: number; affectedRows: number; changes: number; lastInsertRowid: number }> {
  const [res] = await pool.query(sql, params);
  const r = res as mysql.ResultSetHeader;
  const affected = r?.affectedRows ?? 0;
  return {
    insertId: r?.insertId ?? 0,
    affectedRows: affected,
    // `changes` & `lastInsertRowid` = nama lama better-sqlite3; dipertahankan
    // agar kode yang belum disesuaikan tetap jalan.
    changes: affected,
    lastInsertRowid: r?.insertId ?? 0,
  };
}

/** Jalankan SQL mentah (multi-statement), tanpa parameter. */
async function exec(sql: string): Promise<void> {
  await pool.query(sql);
}

/**
 * Transaksi. Pemakaian:
 *   await db.transaction(async (tx) => {
 *     const u = await tx.get('SELECT ...');
 *     await tx.run('UPDATE ...');
 *     return nilai;
 *   });
 */
async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  const tx: Tx = {
    all: async <R = Row>(sql: string, params: unknown[] = []) => {
      const [rows] = await conn.query(sql, params);
      return rows as R[];
    },
    get: async <R = Row>(sql: string, params: unknown[] = []) => {
      const [rows] = await conn.query(sql, params);
      return (rows as R[])[0];
    },
    run: async (sql: string, params: unknown[] = []) => {
      const [res] = await conn.query(sql, params);
      const r = res as mysql.ResultSetHeader;
      const affected = r?.affectedRows ?? 0;
      return {
        insertId: r?.insertId ?? 0,
        affectedRows: affected,
        changes: affected,
        lastInsertRowid: r?.insertId ?? 0,
      };
    },
  };

  try {
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export interface Tx {
  all: <R = Row>(sql: string, params?: unknown[]) => Promise<R[]>;
  get: <R = Row>(sql: string, params?: unknown[]) => Promise<R | undefined>;
  run: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ insertId: number; affectedRows: number; changes: number; lastInsertRowid: number }>;
}

/** Objek db — bentuknya menyerupai better-sqlite3 + versi async. */
export const db = { all, get, run, exec, transaction, pool };

/* ============ Skema ============ */

/**
 * Buat tabel kalau belum ada. Dipanggil saat startup.
 */
export async function migrate(): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  await exec(schema);

  // Tambalan untuk database lama yang kolomnya belum lengkap.
  await ensureColumn('bot_sessions', 'name', "VARCHAR(64) DEFAULT 'bot'");
  await ensureColumn('chat_logs', 'username', 'VARCHAR(64) NULL');
  await ensureColumn('user_bots', 'version', 'VARCHAR(32) NULL');
  await ensureColumn('users', 'avatar_url', 'VARCHAR(255) NULL');
}

/** Tambah kolom kalau belum ada (pengganti PRAGMA table_info SQLite). */
async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  const rows = await all<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  if (rows.length === 0) {
    await exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

/* ============ Settings ============ */

export async function getSetting(key: string): Promise<string | null> {
  const row = await get<{ value: string }>('SELECT value FROM settings WHERE `key` = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, value]
  );
}

/** Cek koneksi — dipakai saat startup supaya gagal cepat kalau config salah. */
export async function ping(): Promise<void> {
  await pool.query('SELECT 1');
}
