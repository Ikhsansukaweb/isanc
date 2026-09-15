import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adapter — pakai botManager.js isanc (terbukti jalan) sebagai engine.
 * botManager.js = CommonJS; di-import via createRequire.
 * Semua fitur (spawn loop, move, jump, break, place, chat, chest, AFK,
 * otopilot) sudah ada di sana & kompatibel bedrock-protocol.
 */

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/lib/adapter.js → ../../lib/botManager.cjs (CommonJS — .cjs karena
// package.json type:module; dicopy manual dari isanc/lib/botManager.js)
const botManager = require(join(__dirname, '..', '..', 'lib', 'botManager.cjs'));

export interface BotConfig {
  name: string;
  host: string;
  port: number;
  version: string;
  offlineMode?: boolean;
  username?: string;
  /** Nama folder cache auth (default: username || name). Pakai base_name biar stabil. */
  authProfile?: string;
  /** Pemilik bot — dipakai feed aktivitas (live "pesan bot"). */
  ownerId?: number;
}

/** Status JSON dari botManager.toStatusJSON() */
export interface BotStatus {
  id: string;
  config: { host: string; port: number; version?: string; username?: string; offline?: boolean };
  status: string;
  msaCode: { user_code: string; verification_uri: string; message?: string; expires_in?: number } | null;
  error: string | null;
  kickReason: string | null;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  health: number;
  afk: boolean;
  autoWalk: { x: number; y: number | null; z: number } | null;
  playersOnline: number;
  heldItemEmpty: boolean;
  selectedHotbarSlot: number;
  inventory: Array<{ name: string; count: number } | null>;
  container: { open: boolean; windowType: string | null; position: { x: number; y: number; z: number } | null; slots: Array<{ name: string; count: number } | null> };
  chat: Array<{ system: boolean; source?: string; message: string; self?: boolean; at: number }>;
}

export class BotClient {
  readonly name: string;
  private id: string | null = null;

  constructor(name: string, config: BotConfig) {
    this.name = name;
    this.config = config;
  }

  private config: BotConfig;

  /** Connect — nama bot dipakai sebagai username (pola isanc) */
  connect(): void {
    const { createBot } = botManager;
    // username = akun in-game; authProfile = folder cache auth (stabil per akun,
    // walau label bot berubah karena hashtag).
    const c = { ...this.config, username: this.config.username || this.name };
    this.id = createBot(c);
  }

  disconnect(): void {
    if (!this.id) return;
    botManager.removeBot(this.id);
    this.id = null;
  }

  /** Map ke status JSON botManager + tambah name */
  toStatusJSON(): BotStatus & { name: string } {
    if (!this.id) {
      return {
        id: null as any,
        name: this.name,
        config: { host: this.config.host, port: this.config.port, version: this.config.version, username: this.config.username || this.name, offline: this.config.offlineMode },
        status: 'stopped',
        msaCode: null,
        error: null,
        kickReason: null,
        position: { x: 0, y: 64, z: 0 },
        yaw: 0,
        pitch: 0,
        onGround: true,
        health: 20,
        afk: false,
        autoWalk: null,
        playersOnline: 0,
        heldItemEmpty: true,
        selectedHotbarSlot: 0,
        inventory: [],
        container: { open: false, windowType: null, position: null, slots: [] },
        chat: [],
      };
    }
    const s = botManager.getBot(this.id);
    if (!s) return this.toStatusJSON();
    return { ...s.toStatusJSON(), name: this.name };
  }

  getPendingAuthCode() {
    const s = botManager.getBot(this.id);
    const code = s?.msaCode;
    if (!code || !code.user_code) return null;
    return { user_code: code.user_code, verification_uri: code.verification_uri, expires_in: code.expires_in ?? 900 };
  }

  // --- Delegasi ke botManager ---
  private bot() {
    return this.id ? botManager.getBot(this.id) : null;
  }

  setMove(dir: string, active: boolean) { return this.bot()?.setMove(dir, active) ?? null; }
  turn(dy: number, dp: number) { return this.bot()?.turn(dy, dp); }
  jump() { return this.bot()?.jump(); }
  toggleSneak(a: boolean) { return this.bot()?.toggleSneak(a); }
  gotoCoordinate(x: number, y: number | null, z: number) { return this.bot()?.gotoCoordinate(x, y, z); }
  cancelGoto() { return this.bot()?.cancelGoto(); }
  chatSend(m: string) { return this.bot()?.chatSend(m); }
  attack() { return this.bot()?.attack(); }
  placeBlock() { return this.bot()?.placeBlock(); }
  selectHotbarSlot(s: number) { return this.bot()?.selectHotbarSlot(s); }
  openContainer(x?: number, y?: number, z?: number) { return this.bot()?.openContainer(x, y, z); }
  closeContainer() { return this.bot()?.closeContainer(); }
  useItem() { return this.bot()?.useItem(); }
  clickContainerSlot(s: number) { return this.bot()?.clickContainerSlot(s); }
  setAfk(e: boolean) { return this.bot()?.setAfk(e) ?? { ok: true, message: 'AFK' }; }
  getModules(): never[] { return []; }
  toggleModule(): { ok: true; message: string } { return { ok: true, message: 'OK' }; }
}
