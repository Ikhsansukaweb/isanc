import type { Client } from 'bedrock-protocol';

/**
 * Move module — gerakan eksplisit: walk, jump, look (pola isanc/botManager.js).
 * Instance per bot.
 */

export interface MoveState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sneak: boolean;
}

export class MoveModule {
  private client: Client | null = null;
  state: MoveState = { forward: false, back: false, left: false, right: false, sneak: false };
  private afkActive = false;
  private afkTimer: NodeJS.Timeout | null = null;
  private callbacks: { onSetMove: (s: MoveState) => void; onTurn: () => void; onJump: () => void } | null = null;

  constructor(callbacks?: { onSetMove: (s: MoveState) => void; onTurn: () => void; onJump: () => void }) {
    this.callbacks = callbacks || null;
  }

  attach(client: Client): void {
    this.client = client;
  }

  detach(): void {
    this.client = null;
    this.state = { forward: false, back: false, left: false, right: false, sneak: false };
  }

  setMove(direction: keyof MoveState, active: boolean): { ok: boolean; message: string } | null {
    if (!this.client) return { ok: false, message: 'Bot belum connect' };
    if (!(direction in this.state)) return { ok: false, message: 'Arah tidak valid' };
    this.state[direction] = !!active;
    this.callbacks?.onSetMove?.(this.state);
    return null;
  }

  turn(deltaYaw: number, deltaPitch: number): void {
    this.callbacks?.onTurn?.();
  }

  jump(): void {
    this.callbacks?.onJump?.();
  }

  setAfk(enabled: boolean): { ok: boolean; message: string } {
    this.afkActive = !!enabled;
    if (this.afkActive) {
      this.afkTimer = setInterval(() => {
        this.turn(Math.random() * 20 - 10, 0);
        this.jump();
      }, 20000);
      return { ok: true, message: 'AFK mode aktif (jitter tiap 20s)' };
    }
    if (this.afkTimer) {
      clearInterval(this.afkTimer);
      this.afkTimer = null;
    }
    return { ok: true, message: 'AFK mode nonaktif' };
  }
}