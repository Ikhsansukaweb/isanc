/**
 * Samakan zona waktu sesi MySQL dengan UTC.
 *
 * Kenapa perlu:
 *   Data lama dari SQLite memakai datetime('now') yang menghasilkan **UTC**.
 *   MySQL default-nya memakai zona waktu sistem (WIB, UTC+7), sehingga
 *   CURRENT_TIMESTAMP menghasilkan waktu 7 jam lebih maju → urutan aktivitas
 *   jadi kacau dan tanggal tampil salah.
 *
 * Cara pakai (dijalankan sekali oleh root):
 *   mysql -u root -p < scripts/mysql-set-utc.sql
 *
 * Setelah itu MySQL selalu memakai UTC untuk NOW()/CURRENT_TIMESTAMP,
 * cocok dengan data hasil migrasi.
 */
SET GLOBAL time_zone = '+00:00';
FLUSH PRIVILEGES;
SELECT @@global.time_zone AS time_zone_sekarang, NOW() AS now_utc, UTC_TIMESTAMP() AS utc;
