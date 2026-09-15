#!/usr/bin/env bash
#
# Reset password root MySQL (password TIDAK disimpan di berkas ini).
#
# Jalankan SENDIRI di terminal kamu (butuh ketik password sudo):
#     bash scripts/reset-mysql-password.sh
# atau beri password sebagai argumen:
#     bash scripts/reset-mysql-password.sh 'password-baru'
#
# CATATAN KEAMANAN: dulu password ditulis langsung sebagai nilai NEW_PASSWORD
# di berkas ini. Karena repo ini di-push ke GitHub, nilai tersebut dihapus dan
# sekarang WAJIB diberikan saat menjalankan skrip — supaya tidak ada kredensial
# yang pernah masuk riwayat git.
#
# Cara kerja (standar resmi MySQL kalau password root hilang):
#   1. Hentikan service MySQL
#   2. Jalankan mysqld dengan --skip-grant-tables (sementara, tanpa autentikasi)
#   3. Ganti password root@localhost
#   4. Matikan mysqld sementara, nyalakan service MySQL normal
#   5. Uji login dengan password baru
#
set -eo pipefail

MYSQL_USER="${MYSQL_USER:-root}"

# Password diambil dari argumen pertama, atau dari variabel lingkungan
# MYSQL_NEW_PASSWORD. Tidak pernah ditulis permanen di dalam repo.
NEW_PASSWORD="${1:-${MYSQL_NEW_PASSWORD:-}}"

if [ -z "$NEW_PASSWORD" ]; then
  echo "GAGAL: password baru belum diberikan." >&2
  echo >&2
  echo "Pakai salah satu cara ini:" >&2
  echo "  bash scripts/reset-mysql-password.sh 'password-baru'" >&2
  echo "  MYSQL_NEW_PASSWORD='password-baru' bash scripts/reset-mysql-password.sh" >&2
  echo >&2
  echo "(Sengaja tidak ada nilai default — kredensial tidak boleh ada di repo.)" >&2
  exit 1
fi

echo "== 1/5 Menghentikan MySQL =="
sudo systemctl stop mysql

# /var/run/mysqld ada di tmpfs dan ikut terhapus saat service berhenti.
# mysqld_safe menolak start kalau foldernya tidak ada — jadi buat ulang.
echo "   menyiapkan ulang /var/run/mysqld"
sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld

echo "== 2/5 Menyalakan mysqld mode --skip-grant-tables =="
# --skip-networking: jangan buka port 3306 selama mode tanpa autentikasi
# --user=mysql: mysqld_safe dijalankan sebagai root, tapi proses mysqld-nya
# harus tetap milik user mysql (kalau tidak, file datanya tidak bisa diakses).
sudo mysqld_safe --skip-grant-tables --skip-networking --user=mysql &
MYSQLD_PID=$!

# Tunggu socket benar-benar siap (maks 60 detik).
echo -n "   menunggu MySQL siap"
READY=0
for i in $(seq 1 60); do
  if sudo mysqladmin --silent ping >/dev/null 2>&1; then READY=1; echo " .. siap"; break; fi
  echo -n "."
  sleep 1
done

if [ "$READY" != "1" ]; then
  echo
  echo "GAGAL: MySQL tidak siap dalam 60 detik. Cek log:" >&2
  echo "  sudo tail -30 /var/log/mysql/error.log" >&2
  sudo mysqladmin shutdown 2>/dev/null || true
  sudo systemctl start mysql || true
  exit 1
fi

echo "== 3/5 Mengganti password =="
sudo mysql <<SQL
FLUSH PRIVILEGES;
ALTER USER '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${NEW_PASSWORD}';
FLUSH PRIVILEGES;
SQL

echo "== 4/5 Mematikan mysqld sementara & menyalakan MySQL normal =="
sudo mysqladmin shutdown 2>/dev/null || true
# mysqld_safe menjalankan mysqld sebagai anak proses; tunggu sampai benar-benar
# berhenti supaya systemd tidak bentrok saat start.
for i in $(seq 1 20); do
  if ! pgrep -x mysqld >/dev/null 2>&1; then break; fi
  sleep 1
done
pgrep -x mysqld >/dev/null 2>&1 && sudo pkill -TERM -x mysqld 2>/dev/null || true
wait "$MYSQLD_PID" 2>/dev/null || true
sleep 2
sudo systemctl start mysql
sleep 3

echo "== 5/5 Menguji login dengan password baru =="
if mysql -u "${MYSQL_USER}" -p"${NEW_PASSWORD}" -e "SELECT CURRENT_USER() AS login_berhasil;" 2>/dev/null; then
  echo
  echo "SELESAI — password MySQL untuk '${MYSQL_USER}'@'localhost' sudah diganti."
  echo "   Password baru: ${NEW_PASSWORD}"
  echo
  echo "Catatan:"
  echo "  - Coba: mysql -u ${MYSQL_USER} -p'${NEW_PASSWORD}'"
  echo "  - Password ini juga ditulis di /etc/mysql/debian.cnf kalau kamu mau ubah di sana."
  echo "  - Ganti password lagi kalau repo ini bisa diakses orang lain."
else
  echo "GAGAL login dengan password baru. Jalankan ulang script ini." >&2
  exit 1
fi
