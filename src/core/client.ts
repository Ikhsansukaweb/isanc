import { createClient, type Client } from 'bedrock-protocol';
import { EventEmitter } from 'node:events';
import { setupPacketResponder } from './packets.js';
import { PlayerTick, TickState, SPAWN_GRACE_MS, BREAK_BURST_MS, ACTION_CONFIRM_TIMEOUT_MS, ATTACK_RANGE } from './playerTick.js';
import type { BotConfig } from '../utils/validation.js';

/**
 * BotClient — satu bot (multi-bot aman via BotManager).
 * Fitur dipindahkan dari isanc/botManager.js: move loop, jump, break,
 * place, useItem, container, hotbar, chat, otopilot, AFK.
 */

const EMPTY_ITEM: any = { network_id: 0 };
const EMPTY_ITEM_V4: any = { network_id: 0, count: 0, metadata: 0, block_runtime_id: 0, extra_data: Buffer.alloc(0) };

function isEmptyItem(item: any): boolean {
  return !item || !item.network_id;
}

function forwardVector(yawDeg: number): { x: number; z: number } {
  const rad = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(rad), z: Math.cos(rad) };
}

function dist3(a: any, b: any): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toTransactionItem(item: any): any {
  if (isEmptyItem(item)) return EMPTY_ITEM;
  return {
    network_id: item.network_id,
    count: item.count || 1,
    metadata: item.metadata || 0,
    has_stack_id: 0,
    block_runtime_id: item.block_runtime_id || 0,
    extra: item.extra,
  };
}

function stackIdOf(item: any): number {
  if (item && item.net_id_variant && item.net_id_variant.type === 'item_stack_net_id') {
    return item.net_id_variant.id;
  }
  return 0;
}

export class BotClient extends EventEmitter {
  readonly name: string;
  config: BotConfig;
  client: Client | null = null;
  status: string = 'stopped'; // stopped | connecting | awaiting_auth | authenticated | joined | spawned | kicked | disconnected | error
  msaCode: any = null;
  error: string | null = null;
  kickReason: string | null = null;

  runtimeId: bigint | null = null;
  position: { x: number; y: number; z: number } = { x: 0, y: 64, z: 0 };
  private lastSentPos: { x: number; y: number; z: number } = { x: 0, y: 64, z: 0 };
  yaw = 0;
  pitch = 0;
  onGround = true;
  health = 20;
  private authTick = 0n;
  private airborneSince = 0;
  private velY = 0;
  private spawnedAt = 0;

  chat: any[] = [];
  entities = new Map<bigint, any>();
  playersOnline = 0;
  inventory: any[] = [];
  selectedHotbarSlot = 0;
  private itemNames = new Map<number, string>();
  container: any = { open: false, windowId: null, windowType: null, position: null, slots: [] };
  private pendingBlockAction: any = null;
  private pendingBlockTimeout: NodeJS.Timeout | null = null;
  private pendingContainerOpen: any = null;
  private pendingContainerOpenTimeout: NodeJS.Timeout | null = null;
  private stackRequestId = 0;
  private pendingStackRequests = new Map<number, any>();
  moveState: any = { forward: false, back: false, left: false, right: false, sneak: false };
  afk = false;
  private breakTimeout: NodeJS.Timeout | null = null;
  private tick: PlayerTick | null = null;

  private pendingAuthCode: { user_code: string; verification_uri: string; expires_in: number } | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private lastCorrectionMsgAt = 0;
  private teleportGraceUntil = 0;

  // state breaking (diakses PlayerTick via state object)
  tickState: TickState;

  constructor(name: string, config: BotConfig) {
    super();
    this.name = name;
    this.config = config;
    this.tickState = {
      client: null,
      status: 'stopped',
      position: this.position,
      lastSentPos: this.lastSentPos,
      yaw: 0,
      pitch: 0,
      onGround: true,
      runtimeId: null,
      authTick: 0n,
      moveState: this.moveState,
      airborneSince: 0,
      velY: 0,
      jumping: 0,
      prevSneak: false,
      breaking: false,
      breakPos: null,
      breakFace: 1,
      breakFirstTick: false,
      pendingPlace: null,
      autoWalk: null,
      autoWalkStuckPos: null,
      autoWalkStuckTicks: 0,
      spawnedAt: 0,
    };
    this.tick = new PlayerTick(this.tickState, {
      onSetMoveState: () => {},
      onTurn: (dy, dp) => this.turn(dy, dp),
      onJump: () => this.jump(),
      onGoto: () => {},
      onCancelGoto: () => {},
      onChat: (m) => this.pushChat({ system: true, message: m }),
      onBreak: () => {},
      onPlace: () => {},
      onUseItem: () => {},
      onSetAfk: () => {},
      onSpawn: () => {},
    });
  }

  getPendingAuthCode() {
    return this.pendingAuthCode;
  }

  connect(): void {
    const config = this.config;
    const options: Record<string, any> = {
      host: config.host,
      port: config.port,
      version: config.version,
      offline: config.offlineMode,
      profilesFolder: `./data/mc-profiles/${this.name}`,
      skipPing: true,
      // WAJIB: auto-init player. Tanpa ini client tidak kirim
      // set_local_player_as_initialized → server tunggu init → timeout kick.
      // (pola bedrock-protocol onPlayStatus: butuh autoInitPlayer true)
      autoInitPlayer: true,
    };
    if (config.username) options.username = config.username;
    if (!config.offlineMode) {
      // Default auth (Nintendo Switch + flow live) — pola isanc yang terbukti jalan
      options.onMsaCode = (data: any) => {
        this.status = 'awaiting_auth';
        this.msaCode = {
          user_code: data.user_code,
          verification_uri: data.verification_uri || 'https://microsoft.com/link',
          message: data.message || null,
          expires_in: data.expires_in || null,
        };
        this.pendingAuthCode = {
          user_code: data.user_code,
          verification_uri: data.verification_uri || 'https://microsoft.com/link',
          expires_in: data.expires_in || 900,
        };
        this.emit('auth-code', { ...this.pendingAuthCode, bot: this.name });
        this.log(`[auth] Buka ${this.pendingAuthCode.verification_uri}, masukkan code ${this.pendingAuthCode.user_code}`, 'warn');
      };
    }

    try {
      this.client = createClient(options as any);
    } catch (err) {
      this.status = 'error';
      this.error = (err as Error).message;
      this.log(`[connect] Gagal: ${this.error}`, 'error');
      return;
    }
    this.status = 'connecting';

    const client = this.client;
    this.setupPacketResponders(client);
    this.registerListeners(client);

    // Auto-disconnect timeout + retry
    this.client.on('close', () => {
      this.log('[client] Koneksi ditutup', 'info');
      this.tick?.stop();
    });
  }

  private setupPacketResponders(client: Client): void {
    setupPacketResponder({
      client,
      log: (msg, lvl) => this.log(msg, lvl),
      onChat: (u, m) => this.pushChat({ system: false, source: u, message: m }),
      onSpawn: () => {
        this.status = 'spawned';
        this.spawnedAt = Date.now();
        // KRITIS: tickState.status harus 'spawned' juga, kalau tidak
        // PlayerTick.tick() return early → player_auth_input tidak pernah
        // terkirim → server kick timeout.
        this.tickState.status = 'spawned';
        this.tickState.spawnedAt = Date.now();
        this.tick?.start(client, this.spawnedAt);
      },
      onKick: (reason) => {
        this.status = 'kicked';
        this.kickReason = reason;
        this.log(`[kick] ${reason}`, 'warn');
        this.tick?.stop();
      },
      onDisconnect: (msg) => {
        if (this.status !== 'kicked') this.status = 'disconnected';
        if (msg) this.kickReason = msg;
        this.tick?.stop();
      },
      onUpdateBlock: (pos, blockRuntimeId) => {
        const pending = this.pendingBlockAction;
        if (!pending || !pos) return;
        if (pos.x === pending.pos.x && pos.y === pending.pos.y && pos.z === pending.pos.z) {
          if (this.pendingBlockTimeout) clearTimeout(this.pendingBlockTimeout);
          this.pushChat({
            system: true,
            message: `${pending.kind === 'pecah' ? 'Block berhasil dipecah' : 'Block berhasil ditaruh'} (dikonfirmasi server, block_runtime_id: ${blockRuntimeId}).`,
          });
          this.pendingBlockAction = null;
        }
      },
      onGameStart: () => {
        this.status = 'joined';
      },
      onMovePlayer: (pos, mode, pitch, yaw, onGround) => {
          if (this.runtimeId != null) {
            this.reportServerCorrection(pos, mode as string);
          this.position = { ...pos };
          this.lastSentPos = { ...this.position };
          this.pitch = pitch;
          this.yaw = yaw;
          if (typeof onGround === 'boolean') this.setOnGround(onGround);
          this.velY = 0;
        }
      },
      onCorrectPrediction: (pos, onGround) => {
        try {
          if (pos) {
            this.reportServerCorrection(pos);
            this.position = { ...pos };
            this.lastSentPos = { ...this.position };
          }
          if (typeof onGround === 'boolean') this.setOnGround(onGround);
          this.velY = 0;
        } catch (_) {}
      },
      onAddPlayer: (runtimeId, uniqueId, pos, username) => {
        this.entities.set(runtimeId, { uniqueId, position: pos, name: username, kind: 'player' });
        this.playersOnline = this.entities.size;
      },
      onAddEntity: (runtimeId, uniqueId, pos, identifier) => {
        this.entities.set(runtimeId, { uniqueId, position: pos, name: identifier, kind: 'mob' });
      },
      onRemoveEntity: (uniqueId) => {
        for (const [rid, ent] of this.entities) {
          if (ent.uniqueId === uniqueId) {
            this.entities.delete(rid);
            break;
          }
        }
        this.playersOnline = this.entities.size;
      },
      onAttributes: (health) => {
        this.health = health;
      },
      onItemRegistry: (runtimeId, name) => {
        this.itemNames.set(runtimeId, name);
      },
      onInventoryContent: (windowId, slots) => {
        if (windowId === 'inventory') this.inventory = slots;
        else if (this.container.open && windowId === this.container.windowId) this.container.slots = slots;
      },
      onInventorySlot: (windowId, slot, item) => {
        if (windowId === 'inventory') this.inventory[slot] = item;
        else if (this.container.open && windowId === this.container.windowId) this.container.slots[slot] = item;
      },
      onPlayerHotbar: (windowId, selectedSlot) => {
        if (windowId === 'inventory' && typeof selectedSlot === 'number') this.selectedHotbarSlot = selectedSlot;
      },
      onContainerOpen: (windowId, windowType, coordinates) => {
        if (this.pendingContainerOpenTimeout) clearTimeout(this.pendingContainerOpenTimeout);
        this.pendingContainerOpen = null;
        this.container = { open: true, windowId, windowType, position: coordinates || null, slots: [] };
        this.pushChat({ system: true, message: `Chest/container kebuka (${windowType}).` });
      },
      onContainerClose: () => {
        this.container = { open: false, windowId: null, windowType: null, position: null, slots: [] };
      },
      onStackResponse: (requestId, status) => {
        const pending = this.pendingStackRequests.get(requestId);
        if (!pending) return;
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingStackRequests.delete(requestId);
        this.pushChat({
          system: true,
          message: `${pending.desc} - ${status === 'ok' ? 'diterima server.' : `DITOLAK server (status: ${status}).`}`,
        });
      },
      onText: (source, message) => {
        this.pushChat({ system: false, source, message });
      },
    });
  }

  private registerListeners(client: Client): void {
    client.on('session', () => {
      this.status = 'authenticated';
      this.msaCode = null;
      this.pendingAuthCode = null;
      this.log('[auth] Session OK', 'info');
    });
    client.on('join', () => {
      this.status = 'joined';
      this.pushChat({ system: true, message: 'Berhasil login, menunggu spawn...' });
    });
    client.on('start_game', (packet: any) => {
      try {
        this.runtimeId = packet.runtime_entity_id;
        if (packet.player_position) {
          this.position = { ...packet.player_position };
          this.lastSentPos = { ...this.position };
        }
        if (packet.rotation) {
          this.pitch = packet.rotation.x || 0;
          this.yaw = packet.rotation.y || 0;
        }
        if (packet.current_tick != null) {
          try { this.authTick = BigInt(packet.current_tick); } catch (_) { this.authTick = 0n; }
        }
        // Sync ke tickState
        this.tickState.position = this.position;
        this.tickState.lastSentPos = this.lastSentPos;
        this.tickState.yaw = this.yaw;
        this.tickState.pitch = this.pitch;
        this.tickState.runtimeId = this.runtimeId;
        this.tickState.authTick = this.authTick;
      } catch (_) {}
    });
    client.on('spawn', () => {
      this.status = 'spawned';
      this.spawnedAt = Date.now();
      this.tickState.status = 'spawned';
      this.tickState.spawnedAt = Date.now();
      this.pushChat({ system: true, message: 'Bot sudah spawn di dunia.' });
      // PENTING: start tick loop di sini — ini satu-satunya trigger yang
      // dijamin dari library (emit 'spawn' saat player_spawn diterima).
      // Guard di PlayerTick.start() mencegah dobel.
      this.tick?.start(client, this.spawnedAt);
    });
    client.on('error', (err: any) => {
      this.status = 'error';
      this.error = err?.message || String(err);
      this.log(`[error] ${this.error}`, 'error');
    });
  }

  private setOnGround(grounded: boolean): void {
    if (grounded) {
      this.onGround = true;
      this.airborneSince = 0;
    } else if (this.onGround) {
      this.onGround = false;
      this.airborneSince = Date.now();
    }
    this.tickState.onGround = this.onGround;
    this.tickState.airborneSince = this.airborneSince;
  }

  private reportServerCorrection(pos: any, mode?: string): void {
    if (mode === 'teleport' || mode === 'reset') {
      this.teleportGraceUntil = Date.now() + 2000;
      return;
    }
    if (this.teleportGraceUntil && Date.now() < this.teleportGraceUntil) return;
    const moved = dist3(this.position, pos);
    if (moved < 1.0) return;
    const now = Date.now();
    if (this.lastCorrectionMsgAt && now - this.lastCorrectionMsgAt < 4000) return;
    this.lastCorrectionMsgAt = now;
    this.pushChat({
      system: true,
      message: `Server narik balik posisi bot sejauh ~${moved.toFixed(1)} blok - kemungkinan gerakan/tindakan ditolak.`,
    });
  }

  pushChat(entry: any): void {
    this.chat.push({ ...entry, at: Date.now() });
    if (this.chat.length > 200) this.chat.shift();
    this.emit('chat', { bot: this.name, ...entry });
  }

  log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.emit('log', { bot: this.name, msg, level, at: Date.now() });
    console.log(`[${this.name}] ${msg}`);
  }

  // --- Modul delegate (dipakai route API) ---

  setMove(direction: string, active: boolean): { ok: boolean; message: string } | null {
    if (!(direction in this.moveState)) return { ok: false, message: 'Arah tidak valid' };
    if (active && this.tickState.autoWalk) this.cancelGoto();
    this.moveState[direction] = !!active;
    this.tickState.moveState = this.moveState;
    return null;
  }

  turn(deltaYaw: number, deltaPitch: number): void {
    if (typeof deltaYaw === 'number') this.yaw = ((this.yaw + deltaYaw) % 360 + 360) % 360;
    if (typeof deltaPitch === 'number') this.pitch = Math.max(-90, Math.min(90, this.pitch + deltaPitch));
    this.tickState.yaw = this.yaw;
    this.tickState.pitch = this.pitch;
  }

  jump(): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.warmedUp()) { this.warmupChat('lompat'); return; }
    if (!this.onGround) return;
    this.tickState.jumping = 3;
  }

  private warmedUp(): boolean {
    return this.spawnedAt > 0 && Date.now() - this.spawnedAt >= SPAWN_GRACE_MS;
  }

  private warmupChat(action: string): void {
    const sisa = SPAWN_GRACE_MS - (Date.now() - this.spawnedAt);
    this.pushChat({
      system: true,
      message: `Masih warm-up (~${Math.max(1, Math.ceil(sisa / 1000))} detik lagi) - ${action} ditunda.`,
    });
  }

  toggleSneak(active: boolean): void {
    this.moveState.sneak = !!active;
    this.tickState.moveState = this.moveState;
  }

  gotoCoordinate(x: number, y: number | null, z: number): void {
    if (!this.client || this.status !== 'spawned') return;
    const target: any = { x: Number(x), z: Number(z) };
    target.y = (y === undefined || y === null) ? null : Number(y);
    if (Number.isNaN(target.x) || Number.isNaN(target.z) || (target.y !== null && Number.isNaN(target.y))) {
      this.pushChat({ system: true, message: 'Koordinat tidak valid.' });
      return;
    }
    this.tickState.autoWalk = target;
    this.tickState.autoWalkStuckPos = { ...this.position };
    this.tickState.autoWalkStuckTicks = 0;
    this.pushChat({ system: true, message: `Otopilot: jalan ke (${target.x}, ${target.y === null ? '~' : target.y}, ${target.z})...` });
  }

  cancelGoto(): void {
    if (this.tickState.autoWalk) {
      this.tickState.autoWalk = null;
      this.pushChat({ system: true, message: 'Otopilot dibatalkan.' });
    }
  }

  chatSend(message: string): void {
    if (!this.client || !message) return;
    try {
      this.client.queue('text', {
        type: 'chat',
        category: 'authored',
        needs_translation: false,
        source_name: this.config.username || this.name,
        xuid: '',
        platform_chat_id: '',
        has_filtered_message: false,
        message,
      });
      this.pushChat({ system: false, source: this.config.username || this.name, message, self: true });
    } catch (err) {
      this.pushChat({ system: true, message: `Gagal kirim chat: ${(err as Error).message}` });
    }
  }

  private findNearestEntity(): any {
    let nearest: any = null;
    let nearestDist = Infinity;
    for (const [id, ent] of this.entities) {
      const d = dist3(this.position, ent.position);
      if (d < nearestDist && d <= ATTACK_RANGE) {
        nearest = { id, ...ent };
        nearestDist = d;
      }
    }
    return nearest;
  }

  private watchBlockAction(kind: string, pos: any, timeoutMs: number): void {
    if (this.pendingBlockTimeout) clearTimeout(this.pendingBlockTimeout);
    const pending = { kind, pos, at: Date.now() };
    this.pendingBlockAction = pending;
    this.pendingBlockTimeout = setTimeout(() => {
      if (this.pendingBlockAction === pending) {
        this.pushChat({
          system: true,
          message: `Belum ada konfirmasi server dalam ${Math.round(timeoutMs / 1000)} detik untuk ${kind} block - kemungkinan ditolak.`,
        });
        this.pendingBlockAction = null;
      }
    }, timeoutMs);
  }

  attack(): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.warmedUp()) { this.warmupChat('pukul'); return; }
    try {
      this.client.queue('animate', {
        action_id: 'swing_arm',
        runtime_entity_id: this.runtimeId,
        data: 0,
        has_swing_source: false,
      });
    } catch (_) {}
    const target = this.findNearestEntity();
    if (target) {
      try {
        this.client.queue('inventory_transaction', {
          transaction: {
            legacy: { legacy_request_id: 0 },
            transaction_type: 'item_use_on_entity',
            actions: [],
            transaction_data: {
              entity_runtime_id: target.id,
              action_type: 'attack',
              hotbar_slot: 0,
              held_item: EMPTY_ITEM_V4,
              player_pos: this.position,
              click_pos: { x: 0, y: 0, z: 0 },
            },
          },
        });
        this.pushChat({ system: true, message: `Menyerang ${target.name || 'entity'}` });
      } catch (err) {
        this.pushChat({ system: true, message: `Attack gagal: ${(err as Error).message}` });
      }
      return;
    }
    if (this.tickState.breaking) return;
    const fwd = forwardVector(this.yaw);
    this.tickState.breakPos = {
      x: Math.floor(this.position.x + fwd.x),
      y: Math.floor(this.position.y) - 1,
      z: Math.floor(this.position.z + fwd.z),
    };
    this.tickState.breakFace = 1;
    this.tickState.breaking = true;
    this.tickState.breakFirstTick = true;
    this.pushChat({ system: true, message: 'Mulai mecah block di depan...' });
    this.watchBlockAction('pecah', this.tickState.breakPos, BREAK_BURST_MS + ACTION_CONFIRM_TIMEOUT_MS);
    if (this.breakTimeout) clearTimeout(this.breakTimeout);
    this.breakTimeout = setTimeout(() => {
      this.tickState.breaking = false;
      this.tickState.breakPos = null;
    }, BREAK_BURST_MS);
  }

  placeBlock(): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.warmedUp()) { this.warmupChat('taruh block'); return; }
    const heldSlotItem = this.inventory[this.selectedHotbarSlot];
    if (isEmptyItem(heldSlotItem)) {
      this.pushChat({ system: true, message: 'Nggak bisa taruh block: slot hotbar pertama kosong. Isi block dulu.' });
      return;
    }
    const fwd = forwardVector(this.yaw);
    const targetPos = {
      x: Math.floor(this.position.x + fwd.x),
      y: Math.floor(this.position.y) - 1,
      z: Math.floor(this.position.z + fwd.z),
    };
    try {
      this.tickState.pendingPlace = {
        targetPos,
        hotbarSlot: this.selectedHotbarSlot,
        heldItem: toTransactionItem(heldSlotItem),
      };
      this.pushChat({
        system: true,
        message: `Coba taruh block di (${targetPos.x}, ${targetPos.y}, ${targetPos.z}).`,
      });
      this.watchBlockAction('taruh', targetPos, ACTION_CONFIRM_TIMEOUT_MS);
    } catch (err) {
      this.pushChat({ system: true, message: `Place block gagal: ${(err as Error).message}` });
    }
  }

  selectHotbarSlot(slot: number): void {
    if (!this.client || this.status !== 'spawned') return;
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0 || s > 8) {
      this.pushChat({ system: true, message: 'Slot hotbar harus angka 0-8.' });
      return;
    }
    try {
      this.client.queue('player_hotbar', {
        selected_slot: s,
        window_id: 'inventory',
        select_slot: true,
      });
      this.selectedHotbarSlot = s;
      this.pushChat({ system: true, message: `Pindah ke slot hotbar ${s + 1}.` });
    } catch (err) {
      this.pushChat({ system: true, message: `Gagal pindah slot: ${(err as Error).message}` });
    }
  }

  openContainer(x?: number, y?: number, z?: number): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.warmedUp()) { this.warmupChat('buka chest'); return; }
    if (this.container.open) {
      this.pushChat({ system: true, message: 'Sudah ada chest yang kebuka - tutup dulu.' });
      return;
    }
    let targetPos: any;
    if (x !== undefined && x !== null && z !== undefined && z !== null) {
      targetPos = { x: Math.floor(x), y: Math.floor(y != null ? y : (this.position.y - 0.5)), z: Math.floor(z) };
    } else {
      const fwd = forwardVector(this.yaw);
      targetPos = {
        x: Math.floor(this.position.x + fwd.x),
        y: Math.floor(this.position.y - 0.5),
        z: Math.floor(this.position.z + fwd.z),
      };
    }
    const heldSlotItem = this.inventory[this.selectedHotbarSlot];
    try {
      this.client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'item_use',
          actions: [],
          transaction_data: {
            action_type: 'click_block',
            trigger_type: 'player_input',
            block_position: targetPos,
            face: 1,
            hotbar_slot: this.selectedHotbarSlot,
            held_item: toTransactionItem(heldSlotItem),
            player_pos: this.position,
            click_pos: { x: 0.5, y: 0.5, z: 0.5 },
            block_runtime_id: 0,
            client_prediction: 'failure',
            client_cooldown_state: 'off',
          },
        },
      });
      this.pushChat({ system: true, message: `Coba buka chest di (${targetPos.x}, ${targetPos.y}, ${targetPos.z})...` });
      if (this.pendingContainerOpenTimeout) clearTimeout(this.pendingContainerOpenTimeout);
      const pending = { pos: targetPos, at: Date.now() };
      this.pendingContainerOpen = pending;
      this.pendingContainerOpenTimeout = setTimeout(() => {
        if (this.pendingContainerOpen === pending) {
          this.pushChat({ system: true, message: 'Belum ada balasan container_open - kemungkinan bukan chest.' });
          this.pendingContainerOpen = null;
        }
      }, ACTION_CONFIRM_TIMEOUT_MS);
    } catch (err) {
      this.pushChat({ system: true, message: `Buka chest gagal: ${(err as Error).message}` });
    }
  }

  closeContainer(): void {
    if (!this.client) return;
    if (!this.container.open) return;
    try {
      this.client.queue('container_close', {
        window_id: this.container.windowId,
        window_type: this.container.windowType || 'container',
        server: false,
      });
    } catch (err) {
      this.pushChat({ system: true, message: `Gagal kirim tutup chest: ${(err as Error).message}` });
    }
    this.container = { open: false, windowId: null, windowType: null, position: null, slots: [] };
    this.pushChat({ system: true, message: 'Chest ditutup.' });
  }

  useItem(): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.warmedUp()) { this.warmupChat('klik kanan / pakai item'); return; }
    const heldSlotItem = this.inventory[this.selectedHotbarSlot];
    if (isEmptyItem(heldSlotItem)) {
      this.pushChat({ system: true, message: 'Tangan kosong - tidak ada item untuk diklik kanan.' });
      return;
    }
    const roundedPos = {
      x: Math.floor(this.position.x),
      y: Math.floor(this.position.y),
      z: Math.floor(this.position.z),
    };
    try {
      this.client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'item_use',
          actions: [],
          transaction_data: {
            action_type: 'click_air',
            trigger_type: 'player_input',
            block_position: roundedPos,
            face: 0,
            hotbar_slot: this.selectedHotbarSlot,
            held_item: toTransactionItem(heldSlotItem),
            player_pos: this.position,
            click_pos: { x: 0, y: 0, z: 0 },
            block_runtime_id: 0,
            client_prediction: 'failure',
            client_cooldown_state: 'off',
          },
        },
      });
      try {
        this.client.queue('animate', {
          action_id: 'swing_arm',
          runtime_entity_id: this.runtimeId,
          data: 0,
          has_swing_source: false,
        });
      } catch (_) {}
      this.pushChat({ system: true, message: `Klik kanan pakai item di slot ${this.selectedHotbarSlot + 1}.` });
    } catch (err) {
      this.pushChat({ system: true, message: `Klik kanan gagal: ${(err as Error).message}` });
    }
  }

  clickContainerSlot(slotIndex: number): void {
    if (!this.client || this.status !== 'spawned') return;
    if (!this.container.open) {
      this.pushChat({ system: true, message: 'Tidak ada chest yang kebuka.' });
      return;
    }
    const idx = Number(slotIndex);
    const item = this.container.slots[idx];
    if (isEmptyItem(item)) {
      this.pushChat({ system: true, message: 'Slot chest itu kosong.' });
      return;
    }
    let destSlot = this.selectedHotbarSlot;
    if (!isEmptyItem(this.inventory[destSlot])) {
      const emptyIdx = this.inventory.findIndex((it, i) => i < 36 && isEmptyItem(it));
      if (emptyIdx !== -1) destSlot = emptyIdx;
    }
    const requestId = ++this.stackRequestId;
    const desc = `Klik slot chest #${idx + 1}`;
    try {
      this.client.queue('item_stack_request', {
        requests: [{
          request_id: requestId,
          actions: [{
            type_id: 'take',
            count: item.count || 1,
            source: {
              slot_type: { container_id: 'container' },
              slot: idx,
              stack_id: stackIdOf(item),
            },
            destination: {
              slot_type: { container_id: 'hotbar_and_inventory' },
              slot: destSlot,
              stack_id: 0,
            },
          }],
          custom_names: [],
          cause: 0,
        }],
      });
      this.pushChat({ system: true, message: `${desc} - dikirim, nunggu balasan server...` });
      const timeout = setTimeout(() => {
        if (this.pendingStackRequests.has(requestId)) {
          this.pendingStackRequests.delete(requestId);
          this.pushChat({ system: true, message: `${desc} - belum ada balasan server.` });
        }
      }, ACTION_CONFIRM_TIMEOUT_MS);
      this.pendingStackRequests.set(requestId, { desc, at: Date.now(), timeout });
    } catch (err) {
      this.pushChat({ system: true, message: `Klik slot chest gagal: ${(err as Error).message}` });
    }
  }

  setAfk(enabled: boolean): { ok: boolean; message: string } {
    this.afk = !!enabled;
    // AFK loop di PlayerTick via move module; disini cukup set state
    this.tickState.moveState = this.moveState;
    if (this.afk && !this.afkTimer) {
      this.afkTimer = setInterval(() => {
        if (this.status !== 'spawned') return;
        this.turn(Math.random() * 20 - 10, 0);
        if (this.onGround) this.tickState.jumping = 3;
      }, 20000);
      return { ok: true, message: 'AFK mode aktif' };
    }
    if (!this.afk && this.afkTimer) {
      clearInterval(this.afkTimer);
      this.afkTimer = null;
    }
    return { ok: true, message: this.afk ? 'AFK mode aktif' : 'AFK mode nonaktif' };
  }

  private afkTimer: NodeJS.Timeout | null = null;

  getModules(): any[] { return []; }
  toggleModule(name: string, enabled: boolean, config?: any): any { return { ok: true }; }

  disconnect(): void {
    this.tick?.stop();
    if (this.afkTimer) { clearInterval(this.afkTimer); this.afkTimer = null; }
    if (this.breakTimeout) clearTimeout(this.breakTimeout);
    if (this.pendingBlockTimeout) clearTimeout(this.pendingBlockTimeout);
    if (this.pendingContainerOpenTimeout) clearTimeout(this.pendingContainerOpenTimeout);
    for (const pending of this.pendingStackRequests.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
    }
    this.pendingStackRequests.clear();
    try {
      if (this.client) this.client.close();
    } catch (_) {}
    this.client = null;
    this.status = 'stopped';
    this.log('[disconnect] Bot dihentikan', 'info');
  }

  toStatusJSON(): any {
    return {
      id: null,
      name: this.name,
      status: this.status,
      config: { ...this.config },
      pingMs: null,
      uptimeSeconds: this.spawnedAt ? Math.floor((Date.now() - this.spawnedAt) / 1000) : 0,
      lastError: this.error || this.kickReason || null,
      reconnectAttempts: 0,
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      health: this.health,
      afk: this.afk,
      playersOnline: this.playersOnline,
      selectedHotbarSlot: this.selectedHotbarSlot,
      inventory: Array.from({ length: 36 }, (_, i) => {
        const it = this.inventory[i];
        if (!it || !it.network_id) return null;
        const raw = this.itemNames.get(it.network_id);
        return { name: (raw ? raw.replace(/^minecraft:/, '') : 'item #' + it.network_id), count: it.count || 1 };
      }),
      container: {
        open: this.container.open,
        windowType: this.container.windowType,
        position: this.container.position,
        slots: this.container.open ? this.container.slots.map((s: any) => {
          if (!s || !s.network_id) return null;
          const raw = this.itemNames.get(s.network_id);
          return { name: (raw ? raw.replace(/^minecraft:/, '') : 'item #' + s.network_id), count: s.count || 1 };
        }) : [],
      },
      chat: this.chat.slice(-50),
    };
  }
}