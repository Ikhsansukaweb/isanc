import type { Client } from 'bedrock-protocol';

/**
 * FishFarm module — casting & reel otomatis.
 * Instance per bot.
 */

export class FishFarmModule {
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;
  private client: Client | null = null;
  private cast = false;
  private log: (msg: string, level?: 'info' | 'warn' | 'error') => void;

  private readonly config = {
    castIntervalSec: 30,
    reelAfterSec: 10,
    jitterPct: 0.25,
  };

  constructor(log: (msg: string, level?: 'info' | 'warn' | 'error') => void) {
    this.log = log;
  }

  setConfig(config: Record<string, unknown>): void {
    if (typeof config.castIntervalSec === 'number') this.config.castIntervalSec = Math.max(10, config.castIntervalSec);
    if (typeof config.reelAfterSec === 'number') this.config.reelAfterSec = Math.max(3, config.reelAfterSec);
  }

  start(client: Client): void {
    if (this.enabled) return;
    this.enabled = true;
    this.client = client;
    this.loop();
  }

  stop(): void {
    this.enabled = false;
    this.cast = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client = null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private loop(): void {
    if (!this.enabled || !this.client) return;
    try {
      if (!this.cast) {
        this.cast = true;
        this.client.queue('player_action', { action: 'start_break', block_position: { x: 0, y: 0, z: 0 }, face: 0 });
        this.log('[fish] cast pancing');
        this.timer = setTimeout(() => this.loop(), this.config.reelAfterSec * 1000);
      } else {
        this.cast = false;
        this.log('[fish] reel!');
        const jitter = this.config.castIntervalSec * this.config.jitterPct * 1000 * Math.random();
        this.timer = setTimeout(() => this.loop(), this.config.castIntervalSec * 1000 + jitter);
      }
    } catch (e) {
      this.log(`[fish] error: ${(e as Error).message}`, 'error');
      this.timer = setTimeout(() => this.loop(), 5000);
    }
  }
}