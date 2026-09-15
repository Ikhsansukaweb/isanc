#!/usr/bin/env bash
# Kredit saldo manual (top-up admin, mis. dari QRIS yang dibayar di luar sistem).
# Pemakaian: bash scripts/credit-saldo.sh <username> <nominal> "<keterangan>"
set -eo pipefail

USERNAME="${1:?username wajib}"
AMOUNT="${2:?nominal wajib}"
NOTE="${3:-Top-up manual}"

cd /home/ikhsan/Documents/afk-bedrock
node --input-type=module -e "
import { db } from './dist/db/index.js';

const username = process.argv[1];
const amount = Number(process.argv[2]);
const note = process.argv[3];

if (!Number.isInteger(amount) || amount <= 0) {
  console.error('Nominal harus bilangan bulat positif.');
  process.exit(1);
}

const user = db.prepare('SELECT id, username, tag, balance FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) {
  console.error('Akun tidak ditemukan: ' + username);
  process.exit(1);
}

const before = user.balance;
const after = before + amount;

db.transaction(() => {
  db.prepare(\"UPDATE users SET balance = ?, updated_at = datetime('now') WHERE id = ?\").run(after, user.id);
  db.prepare(
    \`INSERT INTO balance_transactions (user_id, type, amount, balance_after, description)
     VALUES (?, 'admin_credit', ?, ?, ?)\`
  ).run(user.id, amount, after, note);
})();

console.log(\`OK  \${user.username}#\${user.tag}  \${before} -> \${after}  (+${amount})  [\${note}]\`);
" "$USERNAME" "$AMOUNT" "$NOTE"
