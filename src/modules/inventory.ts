import type { Client } from 'bedrock-protocol';
import { db } from '../db/index.js';

/**
 * Inventory module — baca inventory, drop item.
 * Instance per bot.
 */

export class InventoryModule {
  private client: Client | null = null;
  private sessionId: number | null = null;
  private items: Array<{ slot: number; item: { itemId?: string; count?: number; name?: string } | null }> = [];
  private inventoryVersion = 0;
  private log: (msg: string, level?: 'info' | 'warn' | 'error') => void;

  constructor(log: (msg: string, level?: 'info' | 'warn' | 'error') => void) {
    this.log = log;
  }

  attach(client: Client, sessionId: number): void {
    this.client = client;
    this.sessionId = sessionId;
    this.items = [];

    client.on('inventory_content', (data: any) => {
      try {
        this.capture(data);
      } catch (e) {
        this.log(`[inventory] capture error: ${(e as Error).message}`, 'error');
      }
    });
  }

  detach(): void {
    this.client = null;
    this.sessionId = null;
    this.items = [];
  }

  getItems() {
    return this.items;
  }

  dropItem(slot: number, count = 1): void {
    if (!this.client) throw new Error('Client belum attach');
    this.client.queue('inventory_transaction', {
      legacy_request_id: 0,
      actions: [
        {
          source_type: 'container',
          window_id: 0,
          slot,
          count,
          item: this.items[slot]?.item ?? null,
        },
      ],
      transaction_type: 'normal',
    });
    this.log(`[inventory] drop ${count}x dari slot ${slot}`);
  }

  private capture(data: any): void {
    const inventory = data?.inventory;
    if (!Array.isArray(inventory)) return;

    this.inventoryVersion++;
    this.items = [];

    for (const [index, entry] of inventory.entries()) {
      this.items.push({
        slot: index,
        item: entry
          ? { itemId: entry.itemId, count: entry.count ?? 1, name: entry.itemName ?? entry.itemId ?? 'unknown' }
          : null,
      });

      if (this.sessionId && entry) {
        // Fire-and-forget: snapshot inventory tidak boleh memperlambat capture.
        void db
          .run(
            `INSERT INTO inventory_snapshots (session_id, slot, item_name, count)
             VALUES (?, ?, ?, ?)`,
            [this.sessionId, index, entry.itemName ?? entry.itemId ?? null, entry.count ?? 0]
          )
          .catch((e: Error) => this.log(`[inventory] gagal simpan snapshot: ${e.message}`, 'error'));
      }
    }
    this.log(`[inventory] capture ${this.items.filter((i) => i.item).length} item (v${this.inventoryVersion})`);
  }
}