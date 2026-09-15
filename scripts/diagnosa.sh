#!/usr/bin/env bash
# Diagnosa masalah user: login 401, rent 402, bot tidak bisa dibeli
set -e
API=https://api.skadesmart.web.id

echo "=== 1. Cek CORS + login dari origin web (simulasi browser) ==="
curl -s -i -m 25 -X POST $API/api/auth/login \
  -H "Origin: https://skadesmart.web.id" \
  -H "Content-Type: application/json" \
  -d '{"username":"isans","password":"salahbanget9"}' | head -4
echo

echo "=== 2. Kode error 402 = saldo kurang. Pesannya harus jelas ==="
echo "    (lihat pesan yang diterima frontend)"

echo "=== 3. Data semua akun & bot + saldo ==="
node --input-type=module -e "
import { db } from './dist/db/index.js';
const users = db.prepare('SELECT id, username, tag, balance FROM users').all();
for (const u of users) {
  const bots = db.prepare('SELECT label, base_name, expires_at FROM user_bots WHERE user_id = ?').all(u.id);
  console.log(\`user \${u.username}#\${u.tag} (id \${u.id}) saldo=\${u.balance}\`);
  for (const b of bots) console.log('   bot:', b.label, '| expires:', b.expires_at ?? 'BELUM DISEWA');
}
"
