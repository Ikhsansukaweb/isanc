#!/usr/bin/env bash
# Uji alur auth + saldo + tag bot (backend port 3737)
set -e
API=http://localhost:3737

jq_get() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }

echo "=== 1. Registrasi akun kedua (uji tag unik) ==="
curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"budi","password":"budi12345"}' | jq_get "['user']['displayName']"

echo "=== 2. Password lemah harus ditolak ==="
curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"coba","password":"123"}' | jq_get "['error']"

echo "=== 3. Login isan ==="
T1=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"isan","password":"rahasia123"}' | jq_get "['accessToken']")
echo "token isan: ${T1:0:16}... (panjang ${#T1})"

echo "=== 4. Login budi ==="
T2=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"budi","password":"budi12345"}' | jq_get "['accessToken']")
echo "token budi: ${T2:0:16}..."

echo "=== 5. Isolasi: budi tidak boleh lihat bot isan ==="
echo -n "bot milik budi: "
curl -s $API/api/bots -H "Authorization: Bearer $T2" | python3 -c "import json,sys;print(json.load(sys.stdin))"

echo -n "bot milik isan: "
curl -s $API/api/bots -H "Authorization: Bearer $T1" | python3 -c "import json,sys;print([b['label'] for b in json.load(sys.stdin)])"

echo "=== 6. Bot budi akan dapat tag sendiri ==="
curl -s -X POST $API/api/bots -H "Authorization: Bearer $T2" -H 'Content-Type: application/json' \
  -d '{"baseName":"bot1","host":"be.prownetwork.net","port":19132,"version":"1.26.30"}' | jq_get "['label']"

echo "=== 7. Password salah tidak bocorkan info ==="
curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"isan","password":"salahbanget1"}' | jq_get "['error']"

echo "=== 8. Token palsu ditolak ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $API/api/bots -H "Authorization: Bearer palsu.palsu.palsu"

echo "=== 9. /api/auth/me ==="
curl -s $API/api/auth/me -H "Authorization: Bearer $T1" | jq_get "['user']['displayName']"

echo "=== 10. Ganti password (validasi lama) ==="
curl -s -X PATCH $API/api/account/password -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' \
  -d '{"oldPassword":"salah","newPassword":"baru12345"}' | jq_get "['error']"
