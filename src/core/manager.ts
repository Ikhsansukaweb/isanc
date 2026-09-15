import { BotClient } from '../lib/adapter.js';
import type { BotConfig } from '../utils/validation.js';

/**
 * BotManager — kelola banyak bot sekaligus.
 * Engine = botManager.js isanc (terbukti jalan); tiap bot pakai
 * profil folder data/auth/<username> sendiri.
 */
class BotManager {
  private bots = new Map<string, BotClient>();

  connect(config: BotConfig): BotClient {
    const existing = this.bots.get(config.name);
    if (existing) {
      const status = existing.toStatusJSON().status;
      // Sudah jalan / sedang menunggu auth → jangan buat ulang (kalau tidak,
      // device code Microsoft yang sedang aktif akan hilang).
      if (status !== 'stopped' && status !== 'error' && status !== 'disconnected' && status !== 'kicked') {
        return existing;
      }
      this.bots.delete(config.name);
    }

    const bot = new BotClient(config.name, config);
    this.bots.set(config.name, bot);
    bot.connect();
    return bot;
  }

  disconnect(name: string): boolean {
    const bot = this.bots.get(name);
    if (!bot) return false;
    bot.disconnect();
    this.bots.delete(name);
    return true;
  }

  stopAll(): void {
    for (const bot of this.bots.values()) bot.disconnect();
    this.bots.clear();
  }

  get(name: string): BotClient | undefined {
    return this.bots.get(name);
  }

  list() {
    return [...this.bots.values()].map((b) => b.toStatusJSON());
  }

  get size(): number {
    return this.bots.size;
  }
}

export const botManager = new BotManager();
export type { BotClient };