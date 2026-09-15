-- IsanC database schema
-- SQLite via better-sqlite3

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT 'bot',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 19132,
  version TEXT NOT NULL DEFAULT '1.21.0',
  offline_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'stopped',
  connected_at TEXT,
  disconnected_at TEXT,
  last_error TEXT,
  ping_ms INTEGER,
  uptime_seconds INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  username TEXT,
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS module_configs (
  session_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (session_id, module)
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  item_name TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'microsoft',
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_inv_session ON inventory_snapshots(session_id);

-- ============ AKUN / AUTH / SALDO ============

-- Akun pengguna panel. tag = hashtag unik (mis. 1122) -> username tampil "isan#1122"
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  balance INTEGER NOT NULL DEFAULT 0,          -- saldo dalam RUPIAH (integer)
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Refresh token (JWT refresh) — disimpan hash-nya saja
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bot milik user. label = nama bot penuh dengan tag, mis. "bot1#1122"
CREATE TABLE IF NOT EXISTS user_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL UNIQUE,                   -- nama unik bot di panel (bot1#1122)
  base_name TEXT NOT NULL,                      -- nama dasar dari server (bot1)
  tag TEXT NOT NULL,                            -- tag pemilik (1122)
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 19132,
  version TEXT,
  offline_mode INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,                           -- masa aktif (unix ms). NULL = belum disewa
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Riwayat saldo
CREATE TABLE IF NOT EXISTS balance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                           -- deposit | purchase | refund | adjust
  amount INTEGER NOT NULL,                      -- + masuk, - keluar
  balance_after INTEGER NOT NULL,
  description TEXT,
  ref TEXT,                                    -- referensi (kode deposit / order id)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deposit QRIS (ariepulsa)
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kode_deposit TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,                      -- nominal pokok yang diminta user
  total_bayar INTEGER,                          -- nominal + fee (ditanggung user)
  fee INTEGER DEFAULT 0,
  qr_url TEXT,
  qr_string TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | success | cancel | expired
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- Paket sewa bot + pesanan
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id INTEGER REFERENCES user_bots(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,                           -- harian | bulanan
  days INTEGER NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',          -- paid | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_bots_user ON user_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_balance_user ON balance_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
-- ===== Global chat (realtime via WebSocket) =====
CREATE TABLE IF NOT EXISTS global_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  tag TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_global_messages_created ON global_messages(created_at DESC);

-- ===== Feed aktivitas (live deposit + pesan bot) =====
-- kind: 'deposit' | 'bot_message' | 'bot_connect' | 'bot_disconnect' | 'rent' | 'register'
CREATE TABLE IF NOT EXISTS activity_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  label TEXT,              -- hasil siap tampil, mis. "isan#5622"
  body TEXT NOT NULL,      -- kalimat lengkap untuk ditampilkan
  meta TEXT,               -- JSON tambahan (amount, bot, plan, dll)
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_kind_created ON activity_feed(kind, created_at DESC);
