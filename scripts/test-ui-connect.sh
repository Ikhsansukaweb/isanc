#!/usr/bin/env bash
# Uji persis seperti UI: connect bot1#8064 milik isans, lihat semua respons.
set -eo pipefail
API=http://localhost:3737

T=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"isans","password":"rahasia123"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$T" ]; then
  echo "login isans gagal dengan password default."
  echo "Coba password lain? (lewati) — lanjut pakai pemeriksaan token dari DB"
  exit 2
fi

ENC='bot1%238064'

echo "=== A. GET /api/bots/<label> (dipanggil halaman detail) ==="
curl -s "$API/api/bots/$ENC" -H "Authorization: Bearer $T" -m 20 | python3 -m json.tool | head -25

echo
echo "=== B. POST connect (tombol Jalankan) ==="
curl -s -X POST "$API/api/bots/$ENC/connect" -H "Authorization: Bearer $T" -m 30 | python3 -m json.tool

echo
echo "=== C. GET ulang setelah 4 detik (polling UI) ==="
sleep 4
curl -s "$API/api/bots/$ENC" -H "Authorization: Bearer $T" -m 20 | python3 -c "
import json,sys
d=json.load(sys.stdin)
live=d.get('live') or {}
print('live.status  :', live.get('status'))
print('live.msaCode :', (live.get('msaCode') or {}).get('user_code') or None)
print('live.lastError:', live.get('lastError') or None)
"
