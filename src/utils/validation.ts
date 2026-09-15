import { z } from 'zod';

export const BotConfigSchema = z.object({
  name: z.string().trim().min(1, 'Nama bot wajib').max(32).default('bot'),
  host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/, 'Host invalid'),
  port: z.number().int().min(1).max(65535).default(19132),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Versi harus format x.y.z').default('1.21.0'),
  offlineMode: z.boolean().default(false),
  username: z.string().min(1).max(32).optional(),
  /** Folder cache auth Microsoft (stabil per akun, tanpa hashtag) */
  authProfile: z.string().min(1).max(32).optional(),
  /** Pemilik bot — dipakai feed aktivitas supaya tahu siapa pemiliknya */
  ownerId: z.number().int().positive().optional(),
  autoReconnect: z.boolean().default(true),
  maxReconnectAttempts: z.number().int().min(0).max(100).default(10),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

export const ChatMessageSchema = z.object({
  message: z.string().trim().min(1, 'Pesan kosong').max(256),
});

export const MoveSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  yaw: z.number().min(-180).max(180).optional(),
  pitch: z.number().min(-90).max(90).optional(),
  sprint: z.boolean().default(false),
});

export const BlockTargetSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  face: z.number().int().min(0).max(5).optional(),
});

export const InventoryActionSchema = z.object({
  slot: z.number().int().min(0).max(35),
  count: z.number().int().min(1).max(64).default(1),
  action: z.enum(['drop', 'transfer', 'swap']).default('drop'),
  targetSlot: z.number().int().min(0).max(35).optional(),
});

export const ModuleToggleSchema = z.object({
  module: z.enum(['antiAfk', 'autoChat', 'fishFarm', 'autoSwing', 'followPlayer']),
  enabled: z.boolean(),
  config: z.record(z.any()).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type MoveInput = z.infer<typeof MoveSchema>;
export type BlockTarget = z.infer<typeof BlockTargetSchema>;
export type InventoryAction = z.infer<typeof InventoryActionSchema>;
export type ModuleToggle = z.infer<typeof ModuleToggleSchema>;