#!/usr/bin/env bash
# Setup akun uji + bot disewa, lalu uji connect -> device code (idempoten).
set -eo pipefail
API=http://localhost:3737
cd /home/ikhsan/Documents/afk-bedrock

U=qa$(date +%s | tail -c 5)
P="Qa-pass-${U}"

echo "=== buat akun uji: $U ==="
REG=$(curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"$P\"}")
T=$(echo "$REG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")
TAG=$(echo "$REG" | python3 -c "import json,sys;print((json.load(sys.stdin).get('user') or {}).get('tag',''))")
echo "  tag: #$TAG"

echo "=== isi saldo 10rb (jalur DB) ==="
bash scripts/credit-saldo.sh "$U" 10000 "Setup uji" | sed 's/^/  /'

echo "=== tambah bot ==="
LABEL=$(curl -s -X POST $API/api/bots -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"baseName":"bot1","host":"be.prownetwork.net","port":19132,"version":"1.26.30"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('label',''))")
echo "  label: $LABEL"

ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$LABEL")

echo "=== sewa harian ==="
curl -s -X POST "$API/api/bots/$ENC/rent" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"plan":"harian"}' -m 25 | python3 -c "import json,sys;d=json.load(sys.stdin);print('  ', d.get('message') or d.get('error'))"

echo "=== 1. GET kepemilikan + live ==="
curl -s "$API/api/bots/$ENC" -H "Authorization: Bearer $T" -m 20 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  label:', d.get('label'), '| expires:', d.get('expires_at'))
print('  live :', (d.get('live') or {}).get('status') if d.get('live') else None)
"

echo "=== 2. connect #1 ==="
curl -s -X POST "$API/api/bots/$ENC/connect" -H "Authorization: Bearer $T" -m 30 | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=d.get('msaCode')
print('  status:', d.get('status'), '| msaCode:', (m or {}).get('user_code') or '(cache)')
"

echo "=== 3. connect #2 (idempoten, code harus sama/tetap ada) ==="
sleep 3
curl -s -X POST "$API/api/bots/$ENC/connect" -H "Authorization: Bearer $T" -m 30 | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=d.get('msaCode')
print('  status:', d.get('status'), '| msaCode:', (m or {}).get('user_code') or '(cache)')
"

echo "=== 4. bot masih ada di live? ==="
curl -s "$API/api/bots/$ENC" -H "Authorization: Bearer $T" -m 20 | python3 -c "
import json,sys
d=json.load(sys.stdin)
live=d.get('live') or {}
print('  ada  :', d.get('live') is not None)
print('  state:', live.get('status'), '| error:', live.get('lastError') or '-')
"

echo "=== 5. link login yang dilihat user ==="
curl -s "$API/api/bots/$ENC" -H "Authorization: Bearer $T" -m 20 | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=(d.get('live') or {}).get('msaCode')
if m:
    print('  https://login.live.com/oauth20_remoteconnect.srf?otc=' + m['user_code'])
else:
    print('  (tidak ada — pakai cache auth)')
"

echo "AKUN UJI: $U / $P  (label $LABEL)"
