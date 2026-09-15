import type { Client } from 'bedrock-protocol';

/**
 * BreakBlock module — hancurkan block di koordinat target.
 * Instance per bot.
 */

export class BreakBlockModule {
  private client: Client | null = null;
  private breaking = false;
  private log: (msg: string, level?: 'info' | 'warn' | 'error') => void;

  constructor(log: (msg: string, level?: 'info' | 'warn' | 'error') => void) {
    this.log = log;
  }

  attach(client: Client): void {
    this.client = client;
  }

  detach(): void {
    this.client = null;
    this.breaking = false;
  }

  get isBreaking(): boolean {
    return this.breaking;
  }

  breakBlock(x: number, y: number, z: number, face = 0): void {
    if (!this.client) throw new Error('Client belum attach');
    if (this.breaking) throw new Error('Sudah breaking block lain');

    this.breaking = true;
    const blockPos = { x, y, z };

    try {
      this.client.queue('player_action', {
        action: 'start_break',
        block_position: blockPos,
        face,
      });
      this.log(`[break] mulai hancurkan block ${x},${y},${z}`);

      const mineMs = 600 + Math.random() * 400;
      setTimeout(() => {
        try {
          this.client!.queue('player_action', {
            action: 'stop_break',
            block_position: blockPos,
            face,
          });
          this.log(`[break] selesai ${x},${y},${z}`);
        } catch (e) {
          this.log(`[break] error stop: ${(e as Error).message}`, 'error');
        } finally {
          this.breaking = false;
        }
      }, mineMs);
    } catch (e) {
      this.breaking = false;
      throw e;
    }
  }
}