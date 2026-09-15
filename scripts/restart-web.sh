#!/usr/bin/env bash
# Restart frontend afk-bedrock (port 3000)
set -e
for p in $(ss -tlnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+' | sort -u); do
  kill "$p" 2>/dev/null || true
done
sleep 2
echo "port 3000 sekarang: $(ss -tlnp 2>/dev/null | grep -c ':3000' || true)"
