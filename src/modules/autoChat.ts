import type { Client } from 'bedrock-protocol';
import { db } from '../db/index.js';

/**
 * AutoChat module — kirim pesan interval dengan delay humanized.
 * Instance per bot.
 */

export class AutoChatModule {
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;
  private client: Client | null = null;
  private sessionId: number | null = null;
  private log: (msg: string, level?: 'info' | 'warn' | 'error') => void;

  private readonly config = {
    messages: ['Halo semua! 👋'],
    intervalSec: 60,
    jitterPct: 0.2,
  };

  constructor(log: (msg: string, level?: 'info' | 'warn' | 'error') => void) {
    this.log = log;
  }

  setConfig(config: Record<string, unknown>): void {
    if (Array.isArray(config.messages)) this.config.messages = config.messages.filter((m) => typeof m === 'string');
    if (typeof config.intervalSec === 'number') this.config.intervalSec = Math.max(5, config.intervalSec);
    if (typeof config.jitterPct === 'number') this.config.jitterPct = Math.min(0.5, Math.max(0, config.jitterPct));
  }

  start(client: Client, sessionId: number): void {
    if (this.enabled) return;
    this.enabled = true;
    this.client = client;
    this.sessionId = sessionId;
    this.sendNext();
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client = null;
    this.sessionId = null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private sendNext(): void {
    if (!this.enabled || !this.client) return;
    this.sendMessage();
    const jitter = this.config.intervalSec * this.config.jitterPct * 1000 * Math.random();
    this.timer = setTimeout(() => this.sendNext(), this.config.intervalSec * 1000 + jitter);
  }

  private sendMessage(): void {
    const msg = this.config.messages[Math.floor(Math.random() * this.config.messages.length)];
    try {
      this.client!.queue('text_message', {
        type: 'chat',
        needs_translation: false,
        source_name: '',
        message: msg,
        xuid: '',
        platform_chat_id: '',
      });
      this.log(`[autoChat] ${msg}`);
      if (this.sessionId) {
        // Catat log tanpa memblokir engine (insert DB tidak boleh menahan
        // alur bot). Error cukup dicatat ke console.
        void db
          .run('INSERT INTO chat_logs (session_id, direction, message) VALUES (?, ?, ?)', [
            this.sessionId,
            'out',
            msg,
          ])
          .catch((e: Error) => this.log(`[autoChat] gagal simpan log: ${e.message}`, 'error'));
      }
    } catch (e) {
      this.log(`[autoChat] error: ${(e as Error).message}`, 'error');
    }
  }
}