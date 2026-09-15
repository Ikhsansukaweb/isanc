#!/usr/bin/env bash
# Uji deposit QRIS -> saldo -> sewa bot -> connect
set -e
API=http://localhost:3737
cd /home/ikhsan/Documents/afk-bedrock

T=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"isan","password":"rahasia123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")

echo "=== 1. Saldo awal ==="
curl -s $API/api/account/saldo -H "Authorization: Bearer $T" | python3 -c "import json,sys;print('saldo:',json.load(sys.stdin)['balance'])"

echo "=== 2. Buat deposit 20rb ==="
DEP=$(curl -s -X POST $API/api/account/deposit -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"amount":20000}' -m 40)
echo "$DEP" | python3 -c "import json,sys;d=json.load(sys.stdin);print('kode:',d['kode_deposit'],'| total:',d['total_bayar'],'| saldo masuk:',d['saldo_didapat'])"
KODE=$(echo "$DEP" | python3 -c "import json,sys;print(json.load(sys.stdin)['kode_deposit'])")

echo "=== 3. Cek status (belum dibayar => pending) ==="
curl -s "$API/api/account/deposit/$KODE" -H "Authorization: Bearer $T" -m 40 | python3 -c "import json,sys;d=json.load(sys.stdin);print('status:',d.get('status'),'| credited:',d.get('credited'))"

echo "=== 4. SIMULASI PEMBAYARAN: kredit saldo manual (uji idempoten) ==="
node -e "
const { db } = require('./dist/db/index.js');
const { creditDeposit } = require('./dist/lib/qris.js');
const row = db.prepare('SELECT id FROM deposits WHERE kode_deposit = ?').get('$KODE');
const a = creditDeposit(row.id);
const b = creditDeposit(row.id); // panggil dua kali => harus 0
console.log('kredit pertama:', a, '| kredit kedua (harus 0):', b);
" 2>/dev/null || node --input-type=module -e "
import { db } from './dist/db/index.js';
import { creditDeposit } from './dist/lib/qris.js';
const row = db.prepare('SELECT id FROM deposits WHERE kode_deposit = ?').get('$KODE');
const a = creditDeposit(row.id);
const b = creditDeposit(row.id);
console.log('kredit pertama:', a, '| kredit kedua (harus 0):', b);
"

echo "=== 5. Saldo setelah bayar ==="
curl -s $API/api/account/saldo -H "Authorization: Bearer $T" | python3 -c "import json,sys;d=json.load(sys.stdin);print('saldo:',d['balance'])"

echo "=== 6. Sewa bot harian (Rp3.000) ==="
curl -s -X POST "$API/api/bots/bot1%235622/rent" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"plan":"harian"}' -m 30 | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('message') or d.get('error'),'| saldo sisa:',d.get('balance'))"

echo "=== 7. Sewa bulanan (Rp20.000) ==="
curl -s -X POST "$API/api/bots/bot1%235622/rent" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"plan":"bulanan"}' -m 30 | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('message') or d.get('error'),'| saldo sisa:',d.get('balance'))"

echo "=== 8. Sewa lagi tanpa saldo => 402 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$API/api/bots/bot1%235622/rent" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"plan":"bulanan"}' -m 30

echo "=== 9. Riwayat saldo ==="
curl -s $API/api/account/saldo -H "Authorization: Bearer $T" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for h in d['history'][:4]:
    print(f\"  {h['type']:9} {h['amount']:>8} -> {h['balance_after']:>8}  {h['description']}\")
"
