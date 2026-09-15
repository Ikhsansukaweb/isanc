import type { Client } from 'bedrock-protocol';

/**
 * Packet responder — WAJIB membalas paket yang server kirim.
 * Beberapa paket kalau tidak dibalas → server disconnect.
 */

export interface PacketContext {
  client: Client;
  log: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  onChat?: (username: string, message: string) => void;
  onSpawn?: () => void;
  onKick?: (reason: string) => void;
  onDisconnect?: (message?: string) => void;
  onUpdateBlock?: (pos: { x: number; y: number; z: number }, blockRuntimeId: number) => void;
  onGameStart?: () => void;
  onMovePlayer?: (pos: { x: number; y: number; z: number }, mode: string, pitch: number, yaw: number, onGround?: boolean) => void;
  onCorrectPrediction?: (pos: { x: number; y: number; z: number }, onGround?: boolean) => void;
  onAddPlayer?: (runtimeId: bigint, uniqueId: bigint, pos: { x: number; y: number; z: number }, username: string) => void;
  onAddEntity?: (runtimeId: bigint, uniqueId: bigint, pos: { x: number; y: number; z: number }, identifier: string) => void;
  onRemoveEntity?: (uniqueId: bigint) => void;
  onAttributes?: (health: number) => void;
  onItemRegistry?: (runtimeId: number, name: string) => void;
  onInventoryContent?: (windowId: string, slots: any[]) => void;
  onInventorySlot?: (windowId: string, slot: number, item: any) => void;
  onPlayerHotbar?: (windowId: string, selectedSlot: number) => void;
  onContainerOpen?: (windowId: string, windowType: string, coordinates: any) => void;
  onContainerClose?: (windowId: string) => void;
  onStackResponse?: (requestId: number, status: string) => void;
  onText?: (source: string, message: string) => void;
}

let lastTickTime = 0n;

export function setupPacketResponder(ctx: PacketContext): void {
  const { client, log } = ctx;

  // Listen raw packet untuk handler manual
  client.on('packet', (packet: any, meta: any) => {
    try {
      handleRaw(ctx, packet, meta);
    } catch (e) {
      log(`Packet handler error [${meta?.name}]: ${(e as Error).message}`, 'error');
    }
  });

  // Named event handlers
  client.on('keep_alive', (data: { time: bigint }) => {
    client.write('keep_alive', { time: data.time });
  });

  client.on('tick_sync', (data: { request_time: bigint; response_time?: bigint }) => {
    // Server kirim request_time → balas dengan response_time = request + delay
    lastTickTime = data.request_time;
    client.write('tick_sync', {
      request_time: data.request_time,
      response_time: data.request_time,
    });
  });

  client.on('resource_pack_info', () => {
    client.write('resource_pack_client_response', {
      response_status: 'completed',
      resourcepackids: [],
    });
  });

  client.on('server_to_client_handshake', () => {
    // bedrock-protocol handle encryption otomatis — JANGAN kirim manual.
    // Nama paketnya client_to_server_handshake di 1.26.30 (bukan client_handshake),
    // dan library sudah urus sendiri. (isanc juga tidak kirim manual.)
  });

  client.on('emerald', () => {
    client.write('client_cache_blob_status', {
      missing: [],
      have: [],
    });
  });

  client.on('chunk_radius_update', (data: { chunk_radius: number }) => {
    client.write('client_cache_status', { enabled: false });
    client.write('network_chunk_publisher_update', {
      coordinates: { x: 0, z: 0 },
      radius: data.chunk_radius,
      saved_chunks: [],
    });
  });

  client.on('set_local_player_as_initialized', () => {
    log('Player initialized — siap main');
    ctx.onSpawn?.();
  });

  // DEBUG: lihat play_status yang dikirim server (apa yang memicu spawn)
  client.on('play_status', (data: any) => {
    log(`[debug] play_status: ${JSON.stringify(data)}`, 'info');
    // Library skip auto-init kalau status internal bukan Initializing (server
    // cache session → skip handshake → status tetap Connecting). Jadi kita
    // kirim set_local_player_as_initialized MANUAL saat player_spawn.
    // runtime_entity_id diambil dari start_game (disimpan library di
    // client.startGameData.runtime_entity_id).
    if (data?.status === 'player_spawn') {
      try {
        const eid = (client as any).startGameData?.runtime_entity_id ?? 0;
        log(`[init] player_spawn diterima — kirim set_local_player_as_initialized (eid=${eid})`, 'info');
        client.write('set_local_player_as_initialized', { runtime_entity_id: eid });
        ctx.onSpawn?.();
      } catch (e) {
        log(`[init] gagal kirim init: ${(e as Error).message}`, 'error');
      }
    }
  });

  client.on('text_message', (data: any) => {
    // Chat masuk dari server/player
    const username = data?.source_name ?? data?.sender ?? '';
    const message = data?.message ?? '';
    if (username && message) {
      ctx.onChat?.(username, message);
    }
  });

  client.on('move_player', (data: any) => {
    // Server sync posisi → ack balik (proto 1.26.30: mode = u8 angka, bukan string)
    const isTeleport = data?.teleport === true || data?.mode === 2 || data?.mode === 'teleport';
    if (isTeleport) {
      // Semua field WAJIB sesuai proto: runtime_id varint (Number, bukan BigInt),
      // tick varint64 wajib ada, teleport conditional (mode 0 = normal → tidak ada).
      client.write('move_player', {
        runtime_id: Number(data.runtime_id ?? 0),
        position: data.position ?? { x: 0, y: 0, z: 0 },
        pitch: data.pitch ?? 0,
        yaw: data.yaw ?? 0,
        head_yaw: data.head_yaw ?? data.yaw ?? 0,
        mode: 0, // normal
        on_ground: typeof data.on_ground === 'boolean' ? data.on_ground : false,
        ridden_runtime_id: Number(data.ridden_runtime_id ?? 0),
        teleport: false,
        tick: Date.now() % 1000, // varint64 wajib — Number kecil aman (bukan BigInt)
      });
    }
  });

  client.on('inventory_content', (data: any) => {
    ctx.log(`Inventory update: ${(data?.inventory?.length ?? 0)} slots`, 'info');
    ctx.onInventoryContent?.(data?.window_id, data?.input || []);
  });

  client.on('inventory_slot', (data: any) => {
    ctx.onInventorySlot?.(data?.window_id, data?.slot, data?.item);
  });

  client.on('player_hotbar', (data: any) => {
    ctx.onPlayerHotbar?.(data?.window_id, data?.selected_slot);
  });

  client.on('container_open', (data: any) => {
    ctx.onContainerOpen?.(data?.window_id, data?.window_type, data?.coordinates);
  });

  client.on('container_close', (data: any) => {
    ctx.onContainerClose?.(data?.window_id);
  });

  client.on('item_stack_response', (data: any) => {
    for (const resp of (data?.responses || [])) {
      ctx.onStackResponse?.(resp?.request_id, resp?.status);
    }
  });

  // Bukti pukul/taruh block diterima server
  client.on('update_block', (data: any) => {
    if (data?.position) {
      ctx.onUpdateBlock?.({
        x: Number(data.position.x),
        y: Number(data.position.y),
        z: Number(data.position.z),
      }, data.block_runtime_id ?? 0);
    }
  });

  client.on('start_game', () => {
    ctx.onGameStart?.();
  });

  client.on('add_player', (data: any) => {
    ctx.onAddPlayer?.(data.runtime_id, data.unique_id, data.position, data.username);
  });

  client.on('add_entity', (data: any) => {
    ctx.onAddEntity?.(data.runtime_id, data.unique_id, data.position, data.identifier);
  });

  client.on('remove_entity', (data: any) => {
    ctx.onRemoveEntity?.(data.entity_id_self);
  });

  client.on('update_attributes', (data: any) => {
    const attrs = data?.attributes || [];
    const health = attrs.find((a: any) => a.name === 'minecraft:health');
    if (health) ctx.onAttributes?.(health.current);
  });

  client.on('item_registry', (data: any) => {
    for (const it of (data?.itemstates || [])) {
      ctx.onItemRegistry?.(it.runtime_id, it.name);
    }
  });

  client.on('text', (data: any) => {
    ctx.onText?.(data?.source_name || 'server', data?.message || '');
  });

  client.on('kick', (reason: any) => {
    ctx.onKick?.(typeof reason === 'string' ? reason : JSON.stringify(reason));
  });

  client.on('disconnect', (packet: any) => {
    ctx.onDisconnect?.(packet?.message);
  });

  client.on('close', () => {
    ctx.onDisconnect?.();
  });

  // Wajib Bedrock modern: detak jantung koneksi. Kalau tidak dibalas → server
  // drop "Timed out!" (pola isanc botManager.js). Balas pakai nama packet
  // yang sama, `needs_response: false` (kita balasan, bukan permintaan baru).
  client.on('network_stack_latency', (packet: any) => {
    try {
      if (packet?.needs_response) {
        client.queue('network_stack_latency', {
          timestamp: packet.timestamp,
          needs_response: false,
        });
      }
    } catch (e) {
      log(`Latency reply gagal: ${(e as Error).message}`, 'error');
    }
  });

  client.on('update_attributes', () => { /* listen only */ });
}

function handleRaw(ctx: PacketContext, _packet: any, meta: any): void {
  const name = meta?.name;
  if (!name) return;
  // Default: semua paket tak dikenal → log (jangan crash), kirim ack kalau ada pola
  const ackPackets: Record<string, boolean> = {
    command_request: false, // dihandle module
  };
  if (ackPackets[name] === undefined) {
    // Paket unknown — log ringan
    ctx.log(`[rx] ${name}`, 'info');
  }
}