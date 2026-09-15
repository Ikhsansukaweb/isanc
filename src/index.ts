// WAJIB paling atas: muat .env sebelum modul lain membaca process.env
// (auth.ts menolak start kalau JWT_SECRET tidak ada).
import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './server.js';
import { attachRealtime } from './lib/realtime.js';
import { migrate, ping } from './db/index.js';

const PORT = Number(process.env.PORT ?? 3737);

// Jangan matikan server karena error async dari bedrock-protocol
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

// Cek koneksi MySQL dulu: kalau salah password/host, lebih baik gagal jelas
// di sini daripada error aneh saat request pertama masuk.
try {
  await ping();
  await migrate();
  console.log(`MySQL terhubung (db: ${process.env.DB_NAME ?? 'isanc'}).`);
} catch (e) {
  console.error('Gagal menyiapkan database MySQL:', (e as Error).message);
  process.exit(1);
}

const app = createApp();

// HTTP server dipakai bersama oleh Express dan hub WebSocket (/ws),
// supaya chat global & feed realtime lewat port yang sama (tunnel tetap 1).
const server = createServer(app);
attachRealtime(server);

server.listen(PORT, () => {
  console.log(`IsanC API listening on http://localhost:${PORT}`);
  console.log('Auth : POST /api/auth/register | login | refresh | logout  ·  GET /api/auth/me');
  console.log('Akun : GET /api/account/saldo | POST /api/account/deposit | PATCH /api/account/password');
  console.log('Bot  : GET|POST /api/bots | POST /api/bots/:label/rent | connect | disconnect');
  console.log('Ktrl : GET /api/bot/:name | POST /api/bot/:name/{chat,move,jump,turn,goto,use,hotbar,afk,container/*}');
  console.log('Chat : WS /ws (global chat + live feed)  ·  GET /api/chat/global | POST /api/chat/global');
  console.log('Feed : GET /api/feed?kind=deposit,buy');
  console.log('AI   : POST /api/ai/chat | GET|DELETE /api/ai/history');
});
