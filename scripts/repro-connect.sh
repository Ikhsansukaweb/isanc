#!/usr/bin/env bash
# Reproduksi: connect bot3#8064 sebagai user isans, lihat status detail + error
set -eo pipefail
API=http://localhost:3737

T=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"budi","password":"budi12345"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$T" ]; then echo "login budi gagal"; exit 1; fi

echo "=== 1. connect bot3#8064 (punya isans, tapi tes pakai isans) ==="
CI=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"isans","password":"isans12345"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$CI" ]; then
  echo "  (login isans gagal — pakai budi untuk lihat struktur respons)"
fi

echo "=== 2. respons mentah /api/bot/botX ==="
curl -s "$API/api/bot/bot1%239291/connect" -X POST -H "Authorization: Bearer $T" -m 20 || true
echo

echo "=== 3. status detail bot1#9291 ==="
curl -s "$API/api/bot/bot1%239291" -H "Authorization: Bearer $T" -m 20 | head -c 600
echo
