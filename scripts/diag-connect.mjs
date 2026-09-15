#!/usr/bin/env node
/**
 * Diagnosa langsung: connect bot dengan profil auth baru (bot3) dan lihat
 * error sebenarnya dari engine. Jalankan: node scripts/diag-connect.mjs bot3
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const botManager = require(join(__dirname, '..', 'lib', 'botManager.cjs'));

const profile = process.argv[2] ?? 'diagprobe';

console.log('Membuat bot dengan authProfile =', profile);

const id = botManager.createBot({
  name: 'diagtest',
  host: 'be.prownetwork.net',
  port: 19132,
  version: '1.26.30',
  username: profile,
  authProfile: profile,
});

console.log('id:', id);

// Pantau status selama 25 detik
let last = '';
const t = setInterval(() => {
  const bot = botManager.getBot(id);
  if (!bot) {
    console.log('BOT HILANG dari manager');
    return;
  }
  const s = bot.toStatusJSON();
  const line = `status=${s.status} error=${s.error ?? '-'} kick=${s.kickReason ?? '-'} msa=${s.msaCode ? 'ADA' : '-'}`;
  if (line !== last) {
    console.log(new Date().toISOString().slice(11, 19), line);
    last = line;
  }
}, 1000);

setTimeout(() => {
  clearInterval(t);
  const bot = botManager.getBot(id);
  const s = bot?.toStatusJSON();
  console.log('\n=== STATUS AKHIR ===');
  console.log(JSON.stringify({
    status: s?.status,
    error: s?.error,
    kickReason: s?.kickReason,
    msaCode: s?.msaCode,
  }, null, 2));
  botManager.removeBot(id);
  process.exit(0);
}, 25000);
