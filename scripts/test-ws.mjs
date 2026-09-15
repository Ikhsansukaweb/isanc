#!/usr/bin/env node
/**
 * Uji WebSocket hub: login, sambung /ws, terima init, kirim chat, terima siaran.
 * Jalankan: node scripts/test-ws.mjs <username> <password>
 */
import WebSocket from 'ws';

const API = process.env.API ?? 'http://localhost:3737';
const WS_URL = API.replace(/^http/, 'ws') + '/ws';
const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Pakai: node scripts/test-ws.mjs <username> <password>');
  process.exit(1);
}

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) {
  console.error('LOGIN GAGAL', login.status, await login.text());
  process.exit(2);
}
const { accessToken, user } = await login.json();
console.log(`login OK: ${user.username}#${user.tag}`);

const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(accessToken)}`);
let chatCount = 0;
let feedCount = 0;

const done = setTimeout(() => {
  console.log(`\nhasil: init=${init ? 'OK' : 'GAGAL'} chat_diterima=${chatCount} feed_diterima=${feedCount}`);
  if (init && chatCount >= 2) console.log('SEMUA LOLOS');
  else console.log('ADA YANG GAGAL');
  ws.close();
  process.exit(0);
}, 6000);

let init = false;
ws.on('open', () => console.log('socket terbuka'));

ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'init') {
    init = true;
    console.log(`init: chat=${m.chat.length} feed=${m.feed.length} me=${m.me ? m.me.username : 'anonim'}`);
    // kirim pesan uji setelah init
    ws.send(JSON.stringify({ type: 'chat', body: `tes websocket ${new Date().toLocaleTimeString('id-ID')}` }));
  }
  if (m.type === 'chat') {
    chatCount++;
    console.log(`chat #${chatCount} dari ${m.message.username}#${m.message.tag}: ${m.message.body}`);
  }
  if (m.type === 'feed') {
    feedCount++;
    console.log(`feed [${m.item.kind}]: ${m.item.body}`);
  }
  if (m.type === 'presence') console.log(`presence: online=${m.online} authed=${m.authed}`);
  if (m.type === 'error') console.log(`ERROR dari server: ${m.error}`);
});

ws.on('error', (e) => { console.error('socket error:', e.message); clearTimeout(done); process.exit(3); });
ws.on('close', () => console.log('socket tertutup'));
