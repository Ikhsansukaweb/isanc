# AFK Client — Minecraft Bedrock (bedrock-protocol)

## 1. Koneksi
- Host server: **IP + Port** (default 19132), configurable
- Versi: **auto-match** dengan `minecraft-data` (pin versi stabil, e.g. 1.21.x)
- Mode: online (Microsoft) + offline (fallback, server offline-mode)

## 2. Auth Microsoft (Device Code Flow)
```
1. Buka https://microsoft.com/link → tampilkan kode 8 digit ke user
2. Polling token (interval 5s, max 15 menit)
3. Simpan: access_token + refresh_token di SQLite (terenkripsi)
4. Refresh otomatis saat expiring (tanpa login ulang)
5. Error handling: 401 → re-auth, 429 → backoff
```

## 3. Packet Layer (WAJIB — balas semua paket server)

**Auto-handled oleh bedrock-protocol:**
- `server_to_client_handshake` → siapkan encryption (RSA/AES)
- `resource_pack_info` → balas `resource_pack_client_response` (accept)
- `emerald` (request) → balas `client_cache_blob_status` (miss all)
- `keep_alive` → balas `keep_alive` (server akan disconnect kalau tidak)
- `chunk_radius_update` → `client_cache_status` + `network_chunk_publisher_update`

**Wajib di-handle manual di kode:**
| Packet masuk | Response wajib |
|---|---|
| `move_player` (teleport/sync) | `move_player` (ack posisi) |
| `set_health` / respawn | `respawn` |
| `tick_sync` | `tick_sync` (sync tick) |
| `update_attributes` | none (listen only) |
| `modal_form_request` | `modal_form_response` |
| `set_local_player_as_initialized` | `client_start_game`? no → kirim `set_local_player_as_initialized` |
| `mob_effect` etc | listen only |
| `command_request` response | `command_output` (kalau pakai command) |
| `inventory_content/transaction` | `inventory_transaction` (ack) |
| `block_break` (digging) | `player_action` (confirm) |
| `container_open` | `container_close` (kalau dibuka) |

**Pola handler:**
```ts
client.on('packet', (packet, meta) => {
  const handlers: Record<string, (p: any) => void> = {
    move_player: ackMovePlayer,
    tick_sync: ackTickSync,
    keep_alive: () => client.write('keep_alive', { time: Date.now() }),
  };
  handlers[meta.name]?.(packet);
});
```
Auto-response default utk semua paket tak dikenal → log ke console (jangan crash).

## 4. Fitur / Modules

### Core
- [ ] Connect (IP:port) + auto-reconnect (backoff 5s→30s→2m)
- [ ] Auth MS device-code + refresh token
- [ ] Join-serkan: tunggu chunk load, `set_local_player_as_initialized`
- [ ] Event bus: connect, spawn, chat, disconnect, tick

### Modules (plugin-style, toggle per session)
- [ ] **Chat**: kirim pesan in-game, handle `!command`, log semua chat masuk
- [ ] **Move**: walk, jump, look (yaw/pitch), sprint — acak untuk anti-AFK
- [ ] **BreakBlock**: target block oleh koordinat, tahan mining sampai hancur
- [ ] **PlaceBlock**: letakkan block di koordinat target
- [ ] **Inventory**: read inventory (slot, item, count), ambil/letakkan item, drop
- [ ] **FishFarm**: cast → tunggu → reel (deteksi bobber entity)
- [ ] **AntiAFK**: kombinasi move/jump/look acak tiap X detik (humanized)
- [ ] **AutoReconnect**: reconnect otomatis + join ulang

## 5. Tech Stack

| Layer | Pilihan |
|---|---|
| Bahasa | TypeScript |
| Protocol | bedrock-protocol (PrismarineJS), minecraft-data |
| UI | Electron + React + Tailwind (dark theme) |
| State | Zustand |
| DB | better-sqlite3 (config, token, log) |
| Build | electron-builder (Linux/Windows) |

## 6. Arsitektur

```
┌───────────────────────────────┐
│ UI (Electron + React)         │
│ Dashboard│Console│Modules│Cfg │
└──────────────┬────────────────┘
               │ IPC
┌──────────────▼────────────────┐
│ Core Engine (Node + TS)       │
│ ┌──────────┐  ┌─────────────┐ │
│ │ Connector│  │ Packet      │ │
│ │ Manager  │◄►│ Responder   │ │
│ └──────────┘  └──────┬──────┘ │
│ ┌──────────┐  ┌──────▼──────┐ │
│ │ Event Bus│  │ Module      │ │
│ │ (pub/sub)│  │ Manager     │ │
│ └──────────┘  └──────┬──────┘ │
│        ┌─────────────▼──────┐ │
│        │ AntiAFK│Chat│Break │ │
│        │ Place│Inv│Fish     │ │
│        └─────────┬──────────┘ │
└──────────────────┼────────────┘
                   ▼
         bedrock-protocol (WS 19132)
```

## 7. UI/UX — Dark Client Aesthetic
- Warna: bg `#0d1117`, card `#161b22`, border `#30363d`
- Status: hijau `#3fb950` connected / merah `#f85149` disconnected
- Font: JetBrains Mono (console), Inter (UI)
- Layout 3 kolom: **Modules** (toggle list) | **Console** (log real-time) | **Session** (uptime, ping, inventory count)
- Settings: IP, port, versi, mode auth, module config JSON

## 8. Struktur File
```
afk-bedrock/
├── electron/ (main.ts, preload.ts)
├── src/
│   ├── core/ (client.ts, auth.ts, packets.ts, reconnect.ts, events.ts)
│   ├── modules/ (antiAfk.ts, chat.ts, move.ts, breakBlock.ts,
│   │            placeBlock.ts, inventory.ts, fishFarm.ts, index.ts)
│   ├── ui/ (App.tsx, components/, hooks/)
│   └── db/ (schema.sql, index.ts)
└── docs/
```

## 9. Milestone
| Fase | Target |
|---|---|
| 1 | Connect + auth MS + packet responder + auto-reconnect (CLI) |
| 2 | Module: chat, move, break, place (CLI test) |
| 3 | Inventory + FishFarm |
| 4 | Electron UI + config store |
| 5 | Polish: humanized timing, error handling, build distributable |

## 10. Risiko
- Bedrock-protocol update lambat saat MC update → pin versi stabil
- Auth MS bisa kena rate-limit → backoff
- Server anti-bot → delay acak, jangan pattern kaku
- Paket wajib response: keep_alive & tick_sync paling sering bikin disconnect kalau diabaikan