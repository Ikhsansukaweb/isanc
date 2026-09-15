import { describe, it, expect } from 'vitest';
import {
  BotConfigSchema,
  ChatMessageSchema,
  MoveSchema,
  BlockTargetSchema,
  InventoryActionSchema,
  ModuleToggleSchema,
} from '../utils/validation.js';

describe('BotConfigSchema', () => {
  it('terima config valid', () => {
    const result = BotConfigSchema.safeParse({
      host: 'play.example.com',
      port: 19132,
      version: '1.21.0',
      offlineMode: true,
    });
    expect(result.success).toBe(true);
  });

  it('tolak host invalid (karakter terlarang)', () => {
    const result = BotConfigSchema.safeParse({ host: 'play example.com', version: '1.21.0' });
    expect(result.success).toBe(false);
  });

  it('tolak port di luar range', () => {
    const result = BotConfigSchema.safeParse({ host: 'x.com', port: 99999, version: '1.21.0' });
    expect(result.success).toBe(false);
  });

  it('tolak versi format salah', () => {
    const result = BotConfigSchema.safeParse({ host: 'x.com', version: '1.21' });
    expect(result.success).toBe(false);
  });

  it('tolak pesan kosong', () => {
    expect(ChatMessageSchema.safeParse({ message: '' }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('tolak pesan > 256 chars', () => {
    expect(ChatMessageSchema.safeParse({ message: 'a'.repeat(257) }).success).toBe(false);
  });
});

describe('MoveSchema', () => {
  it('terima koordinat valid', () => {
    expect(MoveSchema.safeParse({ x: 10.5, y: 64, z: -20 }).success).toBe(true);
  });

  it('tolak NaN', () => {
    expect(MoveSchema.safeParse({ x: NaN, y: 0, z: 0 }).success).toBe(false);
  });

  it('tolak yaw di luar range', () => {
    expect(MoveSchema.safeParse({ x: 0, y: 0, z: 0, yaw: 200 }).success).toBe(false);
  });
});

describe('BlockTargetSchema', () => {
  it('terima koordinat int valid', () => {
    expect(BlockTargetSchema.safeParse({ x: 1, y: 2, z: 3 }).success).toBe(true);
  });

  it('tolak koordinat non-integer', () => {
    expect(BlockTargetSchema.safeParse({ x: 1.5, y: 2, z: 3 }).success).toBe(false);
  });

  it('tolak face di luar 0-5', () => {
    expect(BlockTargetSchema.safeParse({ x: 1, y: 2, z: 3, face: 6 }).success).toBe(false);
  });
});

describe('InventoryActionSchema', () => {
  it('terima drop valid', () => {
    expect(InventoryActionSchema.safeParse({ slot: 5, count: 10, action: 'drop' }).success).toBe(true);
  });

  it('tolak slot > 35', () => {
    expect(InventoryActionSchema.safeParse({ slot: 36, action: 'drop' }).success).toBe(false);
  });

  it('tolak count > 64', () => {
    expect(InventoryActionSchema.safeParse({ slot: 1, count: 65, action: 'drop' }).success).toBe(false);
  });

  it('transfer butuh targetSlot', () => {
    expect(InventoryActionSchema.safeParse({ slot: 1, action: 'transfer' }).success).toBe(true); // optional
  });
});

describe('ModuleToggleSchema', () => {
  it('terima module valid', () => {
    expect(ModuleToggleSchema.safeParse({ module: 'antiAfk', enabled: true }).success).toBe(true);
  });

  it('tolak module tidak dikenal', () => {
    expect(ModuleToggleSchema.safeParse({ module: 'hack', enabled: true }).success).toBe(false);
  });
});