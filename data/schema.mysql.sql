-- IsanC database schema — MySQL 8
--
-- Konversi dari SQLite (data/schema.sql):
--   INTEGER PRIMARY KEY AUTOINCREMENT -> INT AUTO_INCREMENT PRIMARY KEY
--   TEXT (waktu)                      -> DATETIME (default CURRENT_TIMESTAMP)
--   TEXT (JSON/panjang)               -> TEXT / JSON
--   CHECK (x IN (...))                -> ENUM
--
-- Catatan penting soal waktu: query lama memakai datetime('now') yang menghasilkan
-- UTC. MySQL CURRENT_TIMESTAMP memakai zona waktu server. Supaya perilaku sama,
-- driver di-set timezone 'Z' (UTC) di src/db/index.ts.

CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(191) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_sessions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(64) DEFAULT 'bot',
  host             VARCHAR(253) NOT NULL,
  port             INT NOT NULL DEFAULT 19132,
  version          VARCHAR(32) NOT NULL DEFAULT '1.21.0',
  offline_mode     TINYINT NOT NULL DEFAULT 0,
  status           VARCHAR(32) NOT NULL DEFAULT 'stopped',
  connected_at     DATETIME NULL,
  disconnected_at  DATETIME NULL,
  last_error       TEXT,
  ping_ms          INT NULL,
  uptime_seconds   INT DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NULL,
  direction   ENUM('in','out') NOT NULL,
  username    VARCHAR(64) NULL,
  message     TEXT NOT NULL,
  timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS module_configs (
  session_id  INT NOT NULL,
  module      VARCHAR(64) NOT NULL,
  enabled     TINYINT NOT NULL DEFAULT 0,
  config      TEXT NOT NULL,
  PRIMARY KEY (session_id, module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  slot        INT NOT NULL,
  item_name   VARCHAR(128) NULL,
  count       INT NOT NULL DEFAULT 0,
  timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inv_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  provider       VARCHAR(32) NOT NULL DEFAULT 'microsoft',
  access_token   TEXT,
  refresh_token  TEXT,
  expires_at     BIGINT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  role        ENUM('user','assistant','system') NOT NULL,
  content     TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ AKUN / AUTH / SALDO ============

CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(64) NOT NULL UNIQUE,
  tag            VARCHAR(8) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(32) NOT NULL DEFAULT 'user',
  balance        BIGINT NOT NULL DEFAULT 0,
  is_banned      TINYINT NOT NULL DEFAULT 0,
  avatar_url     VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at  DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  token_hash   VARCHAR(191) NOT NULL UNIQUE,
  user_agent   VARCHAR(255) NULL,
  ip           VARCHAR(64) NULL,
  expires_at   BIGINT NOT NULL,
  revoked_at   BIGINT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_bots (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  label         VARCHAR(96) NOT NULL UNIQUE,
  base_name     VARCHAR(64) NOT NULL,
  tag           VARCHAR(8) NOT NULL,
  host          VARCHAR(253) NOT NULL,
  port          INT NOT NULL DEFAULT 19132,
  version       VARCHAR(32) NULL,
  offline_mode  TINYINT NOT NULL DEFAULT 0,
  expires_at    BIGINT NULL,
  active        TINYINT NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_bots_user (user_id),
  CONSTRAINT fk_user_bots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS balance_transactions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  type           VARCHAR(32) NOT NULL,
  amount         BIGINT NOT NULL,
  balance_after  BIGINT NOT NULL,
  description    TEXT,
  ref            VARCHAR(191) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_balance_user (user_id),
  CONSTRAINT fk_balance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deposits (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  kode_deposit  VARCHAR(96) NOT NULL UNIQUE,
  amount        BIGINT NOT NULL,
  total_bayar   BIGINT NULL,
  fee           BIGINT DEFAULT 0,
  qr_url        TEXT,
  qr_string     TEXT,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  raw_response  TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at       DATETIME NULL,
  INDEX idx_deposits_user (user_id),
  CONSTRAINT fk_deposits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  bot_id      INT NULL,
  plan        VARCHAR(32) NOT NULL,
  days        INT NOT NULL,
  price       BIGINT NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'paid',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_user (user_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_bot FOREIGN KEY (bot_id) REFERENCES user_bots(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Global chat (realtime via WebSocket) =====

CREATE TABLE IF NOT EXISTS global_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  username    VARCHAR(64) NOT NULL,
  tag         VARCHAR(8) NOT NULL,
  body        VARCHAR(400) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_global_created (created_at),
  CONSTRAINT fk_global_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Feed aktivitas (live deposit + pembelian bot) =====
-- kind: 'deposit' | 'buy' | 'register'

CREATE TABLE IF NOT EXISTS activity_feed (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  kind        VARCHAR(16) NOT NULL,
  user_id     INT NULL,
  label       VARCHAR(96) NULL,
  body        VARCHAR(400) NOT NULL,
  meta        TEXT,
  is_public   TINYINT NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_kind_created (kind, created_at),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ Rate limit & proteksi brute force (audit #2) ============
-- Disimpan di DB (bukan memori) supaya bertahan melewati restart PM2 dan
-- konsisten kalau backend dijalankan multi-proses.
CREATE TABLE IF NOT EXISTS rate_limits (
  k         VARCHAR(191) PRIMARY KEY,   -- kunci, mis. "login:u:isan" / "avatar:3"
  count     INT NOT NULL DEFAULT 0,
  reset_at  BIGINT NOT NULL,            -- epoch ms akhir jendela
  INDEX idx_rate_reset (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
