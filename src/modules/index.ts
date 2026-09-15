import type { Client } from 'bedrock-protocol';
import { AntiAfkModule } from './antiAfk.js';
import { AutoChatModule } from './autoChat.js';
import { FishFarmModule } from './fishFarm.js';
import { MoveModule } from './move.js';
import { BreakBlockModule } from './breakBlock.js';
import { InventoryModule } from './inventory.js';
import { db } from '../db/index.js';

export type ModuleName = 'antiAfk' | 'autoChat' | 'fishFarm' | 'autoSwing' | 'followPlayer';

interface ModuleHandle {
  start: (client: Client, sessionId?: number) => void;
  stop: () => void;
  setConfig?: (config: Record<string, unknown>) => void;
  isEnabled?: () => boolean;
}

type LogFn = (msg: string, level?: 'info' | 'warn' | 'error') => void;

export class ModuleManager {
  private modules!: Record<ModuleName, ModuleHandle>;
  private sessionId: number | null = null;
  private client: Client | null = null;
  private logFn: LogFn = () => {};

  attach(client: Client, sessionId: number, log: LogFn): void {
    this.sessionId = sessionId;
    this.client = client;
    this.logFn = log;

    // Instance baru per sesi
    const afk = new AntiAfkModule((m, l) => log(`[antiAfk] ${m}`, l));
    const chat = new AutoChatModule((m, l) => log(`[autoChat] ${m}`, l));
    const fish = new FishFarmModule((m, l) => log(`[fishFarm] ${m}`, l));
    const moveMod = new MoveModule();
    const breakMod = new BreakBlockModule((m, l) => log(`[break] ${m}`, l));
    const inv = new InventoryModule((m, l) => log(`[inventory] ${m}`, l));

    this.modules = {
      antiAfk: {
        start: (c) => afk.start(c),
        stop: () => afk.stop(),
        setConfig: (cfg) => afk.setConfig(cfg),
        isEnabled: () => afk.isEnabled,
      },
      autoChat: {
        start: (c, sid) => chat.start(c, sid!),
        stop: () => chat.stop(),
        setConfig: (cfg) => chat.setConfig(cfg),
        isEnabled: () => chat.isEnabled,
      },
      fishFarm: {
        start: (c) => fish.start(c),
        stop: () => fish.stop(),
        setConfig: (cfg) => fish.setConfig(cfg),
        isEnabled: () => fish.isEnabled,
      },
      autoSwing: { start: () => {}, stop: () => {} },
      followPlayer: { start: () => {}, stop: () => {} },
    };

    moveMod.attach(client);
    breakMod.attach(client);
    inv.attach(client, sessionId);
    log('Modules attached');

    // Fire-and-forget: pemuatan config modul tidak boleh memblokir attach.
    void db
      .all<{ module: ModuleName; enabled: number; config: string }>(
        'SELECT module, enabled, config FROM module_configs WHERE session_id = ?',
        [sessionId]
      )
      .then((rows) => {
        for (const row of rows) {
          if (row.enabled) {
            try {
              const cfg = JSON.parse(row.config);
              if (this.modules[row.module]?.setConfig) this.modules[row.module].setConfig!(cfg);
              this.modules[row.module].start(client, sessionId);
              log(`Module ${row.module} diaktifkan dari config`);
            } catch (e) {
              log(`Gagal restore module ${row.module}: ${(e as Error).message}`);
            }
          }
        }
      })
      .catch((e: Error) => log(`Gagal memuat config modul: ${e.message}`));
  }

  detach(): void {
    this.stopAll();
    this.sessionId = null;
    this.client = null;
  }

  toggle(name: ModuleName, enabled: boolean, config?: Record<string, unknown>): { ok: boolean; message: string } {
    const mod = this.modules?.[name];
    if (!mod) return { ok: false, message: 'Module tidak ditemukan' };
    const sessionId = this.sessionId;
    const client = this.client;
    if (!sessionId || !client) return { ok: false, message: 'Belum ada sesi aktif' };

    if (enabled) {
      if (mod.setConfig && config) mod.setConfig(config);
      try {
        mod.start(client, sessionId);
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    } else {
      mod.stop();
    }

    // ON CONFLICT (SQLite) -> ON DUPLICATE KEY UPDATE (MySQL).
    void db
      .run(
        `INSERT INTO module_configs (session_id, module, enabled, config)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), config = VALUES(config)`,
        [sessionId, name, enabled ? 1 : 0, JSON.stringify(config ?? {})]
      )
      .catch((e: Error) => console.error(`[modules] gagal simpan config ${name}: ${e.message}`));

    return { ok: true, message: `${name} ${enabled ? 'ON' : 'OFF'}` };
  }

  list(): { name: ModuleName; enabled: boolean }[] {
    if (!this.modules) return [];
    return (Object.keys(this.modules) as ModuleName[]).map((name) => ({
      name,
      enabled: this.modules[name].isEnabled?.() ?? false,
    }));
  }

  stopAll(): void {
    if (!this.modules) return;
    for (const mod of Object.values(this.modules)) {
      try { mod.stop(); } catch { /* ignore */ }
    }
  }
}