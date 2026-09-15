import type { Client } from 'bedrock-protocol';

/**
 * AntiAFK module — gerakan acak humanized.
 * Instance per bot (multi-bot aman).
 */

export class AntiAfkModule {
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;
  private client: Client | null = null;
  private log: (msg: string, level?: 'info' | 'warn' | 'error') => void;

  private readonly config = {
    intervalMs: 30000,
    jumpChance: 0.4,
    lookChance: 0.3,
    stepChance: 0.3,
  };

  constructor(log: (msg: string, level?: 'info' | 'warn' | 'error') => void) {
    this.log = log;
  }

  setConfig(config: Record<string, unknown>): void {
    Object.assign(this.config, config);
  }

  start(client: Client): void {
    if (this.enabled) return;
    this.enabled = true;
    this.client = client;
    this.loop();
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client = null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private loop(): void {
    if (!this.enabled || !this.client) return;
    this.performAction();
    const jitter = Math.floor(Math.random() * 0.3 * this.config.intervalMs);
    this.timer = setTimeout(() => this.loop(), this.config.intervalMs + jitter);
  }

  private performAction(): void {
    const c = this.client!;
    const roll = Math.random();

    try {
      if (roll < this.config.jumpChance) {
        c.queue('move_player', {
          runtime_entity_id: 0n,
          position: { x: 0, y: 0.4, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          on_ground: false,
          mode: 'normal',
        });
        this.log('[antiAfk] jump');
      } else if (roll < this.config.jumpChance + this.config.lookChance) {
        const yaw = Math.random() * 360 - 180;
        const pitch = Math.random() * 60 - 30;
        c.queue('move_player', {
          runtime_entity_id: 0n,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: pitch, y: yaw, z: 0 },
          on_ground: true,
          mode: 'normal',
        });
        this.log(`[antiAfk] look yaw=${yaw.toFixed(1)}`);
      } else {
        const step = 0.5;
        c.queue('move_player', {
          runtime_entity_id: 0n,
          position: { x: (Math.random() - 0.5) * step, y: 0, z: (Math.random() - 0.5) * step },
          rotation: { x: 0, y: 0, z: 0 },
          on_ground: true,
          mode: 'normal',
        });
        this.log('[antiAfk] step');
      }
    } catch (e) {
      this.log(`[antiAfk] error: ${(e as Error).message}`, 'error');
    }
  }
}