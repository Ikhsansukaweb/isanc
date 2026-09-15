import type { Client } from 'bedrock-protocol';

/**
 * Player auth input loop — WAJIB kirim tiap tick (50ms) setelah spawn.
 * Tanpa ini server anggap bot freeze/invalid → drop. Pola isanc/botManager.js:
 * - setTimeout recursive + jitter acak (±4ms) biar anti-cheat gak curiga
 * - input_data = bitflags object {nama_flag: true/false}, BUKAN array
 *   (protodef Write.bitflags baca value[key]; kalau array → semua flag 0)
 * - tick must nyambung ke tick dunia server (current_tick di start_game)
 */

export const TICK_MS = 50;
export const TICK_JITTER_MS = 4;
export const MOVE_SPEED = 0.2;
export const GRAVITY = 0.08;
export const AIR_DRAG = 0.98;
export const JUMP_VELOCITY = 0.42;
export const JUMP_AIR_MS = 700;
export const SPAWN_GRACE_MS = 3000;
export const AFK_INTERVAL_MS = 20000;
export const BREAK_BURST_MS = 8000;
export const ATTACK_RANGE = 3.5;
export const ACTION_CONFIRM_TIMEOUT_MS = 2500;

export interface TickState {
  client: Client | null;
  status: string;
  position: { x: number; y: number; z: number };
  lastSentPos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  runtimeId: bigint | null;
  authTick: bigint;
  moveState: { forward: boolean; back: boolean; left: boolean; right: boolean; sneak: boolean };
  airborneSince: number;
  velY: number;
  jumping: number; // 0 = tidak lompat; 3,2,1 = hitung mundur tick lompat
  prevSneak: boolean;
  breaking: boolean;
  breakPos: { x: number; y: number; z: number } | null;
  breakFace: number;
  breakFirstTick: boolean;
  pendingPlace: any | null;
  autoWalk: { x: number; z: number; y: number | null } | null;
  autoWalkStuckPos: { x: number; y: number; z: number } | null;
  autoWalkStuckTicks: number;
  spawnedAt: number;
}

export interface TickCallbacks {
  onSetMoveState: (s: TickState['moveState']) => void;
  onTurn: (deltaYaw: number, deltaPitch: number) => void;
  onJump: () => void;
  onGoto: (x: number, y: number | null, z: number) => void;
  onCancelGoto: () => void;
  onChat: (msg: string) => void;
  onBreak: () => void;
  onPlace: () => void;
  onUseItem: () => void;
  onSetAfk: (b: boolean) => void;
  onSpawn: () => void;
}

export class PlayerTick {
  private state: TickState;
  private cb: TickCallbacks;
  private timer: NodeJS.Timeout | null = null;

  constructor(state: TickState, cb: TickCallbacks) {
    this.state = state;
    this.cb = cb;
  }

  start(client: Client, spawnTime: number): void {
    this.state.client = client;
    this.state.spawnedAt = spawnTime;
    this.state.status = 'spawned';
    if (this.timer) return;
    const loop = () => {
      this.tick();
      const jitter = Math.floor(Math.random() * (TICK_JITTER_MS * 2 + 1)) - TICK_JITTER_MS;
      this.timer = setTimeout(loop, TICK_MS + jitter);
    };
    this.timer = setTimeout(loop, TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private warmedUp(): boolean {
    return this.state.spawnedAt > 0 && Date.now() - this.state.spawnedAt >= SPAWN_GRACE_MS;
  }

  private forwardVector(yawDeg: number): { x: number; z: number } {
    const rad = (yawDeg * Math.PI) / 180;
    return { x: -Math.sin(rad), z: Math.cos(rad) };
  }

  private _lastErrAt = 0;

  tick(): void {
    if (this.state.status !== 'spawned' || !this.state.client) return;
    const s = this.state;
    const flags: Record<string, boolean> = {};
    let localX = 0;
    let localZ = 0;

    // Otopilot
    if (s.autoWalk) {
      const dx = s.autoWalk.x - s.position.x;
      const dz = s.autoWalk.z - s.position.z;
      const flatDist = Math.hypot(dx, dz);
      if (flatDist <= 0.4) {
        this.cb.onChat(`Otopilot: sampai di tujuan (${s.autoWalk.x}, ${s.autoWalk.z})`);
        s.autoWalk = null;
      } else {
        const targetYawRad = Math.atan2(-dx, dz);
        s.yaw = (((targetYawRad * 180) / Math.PI) % 360 + 360) % 360;
        localZ = 1;
        flags.up = true;
        s.autoWalkStuckTicks++;
        if (s.autoWalkStuckTicks >= 12) {
          const moved = s.autoWalkStuckPos ? dist3(s.position, s.autoWalkStuckPos) : 999;
          if (moved < 0.15) this.cb.onJump();
          s.autoWalkStuckPos = { ...s.position };
          s.autoWalkStuckTicks = 0;
        }
      }
    } else {
      const { forward, back, left, right } = s.moveState;
      if (forward) { localZ += 1; flags.up = true; }
      if (back) { localZ -= 1; flags.down = true; }
      if (right) { localX += 1; flags.right = true; }
      if (left) { localX -= 1; flags.left = true; }
    }

    if (localX !== 0 || localZ !== 0) {
      const mag = Math.hypot(localX, localZ) || 1;
      const nx = localX / mag;
      const nz = localZ / mag;
      const fwd = this.forwardVector(s.yaw);
      const right90 = this.forwardVector(s.yaw + 90);
      s.position.x += (fwd.x * nz + right90.x * nx) * MOVE_SPEED;
      s.position.z += (fwd.z * nz + right90.z * nx) * MOVE_SPEED;
    }

    if (s.moveState.sneak) {
      flags.sneaking = true;
      flags.sneak_down = true;
      if (!s.prevSneak) flags.start_sneaking = true;
    } else if (s.prevSneak) {
      flags.stop_sneaking = true;
    }
    s.prevSneak = s.moveState.sneak;

    if (s.jumping > 0) {
      flags.jumping = true;
      flags.jump_down = true;
      if (s.jumping === 3) {
        flags.start_jumping = true;
        s.velY = JUMP_VELOCITY;
        s.onGround = false;
        s.airborneSince = Date.now();
      }
      s.jumping--;
    }

    // Fallback mendarat
    if (!s.onGround && s.airborneSince && Date.now() - s.airborneSince > JUMP_AIR_MS) {
      s.onGround = true;
      s.velY = 0;
    }
    if (!s.onGround) {
      s.position.y += s.velY;
      s.velY = (s.velY - GRAVITY) * AIR_DRAG;
    }

    let blockAction;
    if (s.breaking && s.breakPos) {
      flags.block_action = true;
      blockAction = [{
        action: s.breakFirstTick ? 'start_break' : 'continue_break',
        position: s.breakPos,
        face: s.breakFace,
      }];
      s.breakFirstTick = false;
    }

    let pendingTransaction;
    if (s.pendingPlace) {
      pendingTransaction = {
        legacy: { legacy_request_id: 0 },
        actions: [],
        data: {
          action_type: 'click_block',
          trigger_type: 'player_input',
          block_position: s.pendingPlace.targetPos,
          face: 1,
          hotbar_slot: s.pendingPlace.hotbarSlot,
          held_item: s.pendingPlace.heldItem,
          player_pos: s.position,
          click_pos: { x: 0.5, y: 1, z: 0.5 },
          block_runtime_id: 0,
          client_prediction: 'success',
          client_cooldown_state: 'off',
        },
      };
      s.pendingPlace = null;
    }

    const delta = {
      x: s.position.x - s.lastSentPos.x,
      y: s.position.y - s.lastSentPos.y,
      z: s.position.z - s.lastSentPos.z,
    };
    s.lastSentPos = { ...s.position };
    s.authTick += 1n;

    const packet: Record<string, any> = {
      pitch: s.pitch,
      yaw: s.yaw,
      position: s.position,
      move_vector: { x: localX, z: localZ },
      head_yaw: s.yaw,
      input_data: flags,
      input_mode: 'mouse',
      play_mode: 'normal',
      interaction_model: 'crosshair',
      interact_rotation: { x: s.pitch, z: s.yaw },
      // varint64: protodef terima BigInt TAPI campur Number → "Cannot mix BigInt
      // and other types" di zigzag64. Kirim Number selama < 2^53 (aman),
      // BigInt hanya kalau melewati batas (jarang).
      tick: s.authTick <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(s.authTick) : s.authTick,
      delta,
      analogue_move_vector: { x: localX, z: localZ },
      camera_orientation: { x: 0, y: 0, z: 0 },
      raw_move_vector: { x: localX, z: localZ },
    };
    if (blockAction) packet.block_action = blockAction;
    if (pendingTransaction) packet.transaction = pendingTransaction;

    try {
      if (s.client) s.client.queue('player_auth_input', packet);
    } catch (err) {
      // throttled log — tampilkan sekali sekian detik biar keliatan kalau error
      const now = Date.now();
      if (!this._lastErrAt || now - this._lastErrAt > 5000) {
        this._lastErrAt = now;
        // eslint-disable-next-line no-console
        console.log('[playerTick] player_auth_input error:', (err as Error).message);
        this.cb.onChat(`player_auth_input gagal: ${(err as Error).message}`);
      }
    }
  }
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}