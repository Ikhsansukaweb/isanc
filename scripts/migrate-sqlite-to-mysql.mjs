/**
 * Migrasi data SQLite (data/afk-bedrock.db) -> MySQL (isanc).
 *
 * Pemakaian:
 *   node scripts/migrate-sqlite-to-mysql.mjs
 *
 * Aman dijalankan berulang: tabel tujuan dikosongkan lalu diisi ulang
 * (TRUNCATE) supaya tidak ada duplikat. Urutan tabel mengikuti dependensi
 * foreign key.
 *
 * ID dipertahankan apa adanya supaya relasi antar tabel tetap nyambung.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SQLITE_PATH = process.env.SQLITE_PATH ?? join(ROOT, 'data', 'afk-bedrock.db');
const sqlite = new Database(SQLITE_PATH, { readonly: true });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'isanc',
  timezone: 'Z',
  dateStrings: true,
  multipleStatements: true,
});

// Urutan penting: tabel induk dulu (FK).
// [nama tabel, daftar kolom yang disalin]
const TABLES = [
  ['settings', ['key', 'value']],
  ['bot_sessions', ['id', 'name', 'host', 'port', 'version', 'offline_mode', 'status', 'connected_at', 'disconnected_at', 'last_error', 'ping_ms', 'uptime_seconds', 'created_at']],
  ['chat_logs', ['id', 'session_id', 'direction', 'username', 'message', 'timestamp']],
  ['module_configs', ['session_id', 'module', 'enabled', 'config']],
  ['inventory_snapshots', ['id', 'session_id', 'slot', 'item_name', 'count', 'timestamp']],
  ['auth_tokens', ['id', 'provider', 'access_token', 'refresh_token', 'expires_at', 'created_at']],
  ['ai_messages', ['id', 'role', 'content', 'created_at']],
  ['users', ['id', 'username', 'tag', 'password_hash', 'role', 'balance', 'is_banned', 'created_at', 'updated_at', 'last_login_at']],
  ['refresh_tokens', ['id', 'user_id', 'token_hash', 'user_agent', 'ip', 'expires_at', 'revoked_at', 'created_at']],
  ['user_bots', ['id', 'user_id', 'label', 'base_name', 'tag', 'host', 'port', 'version', 'offline_mode', 'expires_at', 'active', 'created_at']],
  ['balance_transactions', ['id', 'user_id', 'type', 'amount', 'balance_after', 'description', 'ref', 'created_at']],
  ['deposits', ['id', 'user_id', 'kode_deposit', 'amount', 'total_bayar', 'fee', 'qr_url', 'qr_string', 'status', 'raw_response', 'created_at', 'updated_at', 'paid_at']],
  ['orders', ['id', 'user_id', 'bot_id', 'plan', 'days', 'price', 'status', 'created_at']],
  ['global_messages', ['id', 'user_id', 'username', 'tag', 'body', 'created_at']],
  ['activity_feed', ['id', 'kind', 'user_id', 'label', 'body', 'meta', 'is_public', 'created_at']],
];

/** Kolom TEXT tanggal di SQLite -> DATETIME di MySQL. Konversi nilai kosong ke NULL. */
const DATE_COLUMNS = new Set([
  'created_at', 'updated_at', 'paid_at', 'connected_at', 'disconnected_at',
  'timestamp', 'last_login_at',
]);

/** Normalisasi nilai supaya cocok dengan tipe kolom MySQL. */
function normalize(column, value) {
  if (value === undefined || value === null) return null;
  if (DATE_COLUMNS.has(column)) {
    if (value === '') return null;
    // SQLite menyimpan "YYYY-MM-DD HH:MM:SS" (UTC); MySQL DATETIME menerimanya.
    return String(value).slice(0, 19);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  // BIGINT/INTEGER: pastikan number, bukan string aneh.
  if (typeof value === 'bigint') return Number(value);
  return value;
}

console.log(`Sumber : ${SQLITE_PATH}`);
console.log(`Tujuan : ${process.env.DB_NAME ?? 'isanc'} @ ${process.env.DB_HOST ?? '127.0.0.1'}\n`);

// Pastikan skema MySQL sudah terpasang sebelum mengisi data.
await conn.query(readFileSync(join(ROOT, 'data', 'schema.mysql.sql'), 'utf-8'));

// Matikan pemeriksaan FK selama impor supaya urutan tabel tidak jadi masalah.
await conn.query('SET FOREIGN_KEY_CHECKS = 0');

let totalRows = 0;
for (const [table, columns] of TABLES) {
  // Kosongkan tabel tujuan (reset AUTO_INCREMENT juga).
  await conn.query(`TRUNCATE TABLE \`${table}\``);

  let rows;
  try {
    rows = sqlite.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
  } catch (e) {
    console.log(`  ! ${table.padEnd(22)} dilewati (${e.message})`);
    continue;
  }
  if (rows.length === 0) {
    console.log(`  - ${table.padEnd(22)} 0 baris`);
    continue;
  }

  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  const sql = `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ${placeholders}`;

  // Insert satu-satu supaya baris bermasalah bisa dilaporkan tanpa membatalkan semua.
  let ok = 0;
  const failed = [];
  for (const row of rows) {
    const values = columns.map((c) => normalize(c, row[c]));
    try {
      await conn.query(sql, values);
      ok++;
    } catch (e) {
      failed.push({ row, error: e.message });
    }
  }

  totalRows += ok;
  console.log(`  + ${table.padEnd(22)} ${ok} baris${failed.length ? `  (GAGAL: ${failed.length})` : ''}`);
  for (const f of failed.slice(0, 3)) {
    console.log(`      ! ${f.error}`);
  }
}

// Kembalikan urutan AUTO_INCREMENT agar id berikutnya tidak bentrok.
for (const [table, columns] of TABLES) {
  if (!columns.includes('id')) continue;
  const [[row]] = await conn.query(`SELECT COALESCE(MAX(id), 0) AS maxId FROM \`${table}\``);
  const next = Number(row.maxId) + 1;
  if (next > 1) {
    await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${next}`);
  }
}

await conn.query('SET FOREIGN_KEY_CHECKS = 1');

// Ringkasan akhir
console.log('\n--- verifikasi ---');
for (const [table] of TABLES) {
  const [[row]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  const [[src]] = [[sqlite.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get()]];
  const match = Number(row.c) === Number(src.c) ? 'OK' : 'BEDA!';
  console.log(`  ${match.padEnd(6)} ${table.padEnd(22)} mysql=${row.c} sqlite=${src.c}`);
}

console.log(`\nTotal ${totalRows} baris dipindahkan.`);
await conn.end();
sqlite.close();
