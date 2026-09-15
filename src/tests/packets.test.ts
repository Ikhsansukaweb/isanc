import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bedrock-protocol sebelum import client
vi.mock('bedrock-protocol', () => ({
  createClient: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    queue: vi.fn(),
    disconnect: vi.fn(),
    ping: vi.fn(),
  }),
}));

// Gunakan dynamic import — TypeScript ESM
let setupPacketResponder: (ctx: any) => void;

beforeEach(async () => {
  const mod = await import('../core/packets.js');
  setupPacketResponder = mod.setupPacketResponder;
});

describe('packet responder handlers', () => {
  let client: any;
  let handlers: Record<string, (d: any) => void>;
  let writes: any[];

  beforeEach(() => {
    writes = [];
    handlers = {};
    client = {
      on: vi.fn((event: string, fn: (d: any) => void) => {
        handlers[event] = fn;
      }),
      write: vi.fn((name: string, data: any) => writes.push({ name, data })),
      queue: vi.fn(),
    };
  });

  it('keep_alive harus dibalas', () => {
    setupPacketResponder({ client, log: vi.fn() });
    handlers['keep_alive']({ time: 12345n });
    expect(writes.some((w) => w.name === 'keep_alive')).toBe(true);
  });

  it('tick_sync harus dibalas dengan response_time', () => {
    setupPacketResponder({ client, log: vi.fn() });
    handlers['tick_sync']({ request_time: 999n });
    const tick = writes.find((w) => w.name === 'tick_sync');
    expect(tick).toBeDefined();
    expect(tick.data.response_time).toBe(999n);
  });

  it('resource_pack_info → balas completed', () => {
    setupPacketResponder({ client, log: vi.fn() });
    handlers['resource_pack_info']({});
    const resp = writes.find((w) => w.name === 'resource_pack_client_response');
    expect(resp).toBeDefined();
    expect(resp.data.response_status).toBe('completed');
  });

  it('chunk_radius_update → kirim cache status + publisher update', () => {
    setupPacketResponder({ client, log: vi.fn() });
    handlers['chunk_radius_update']({ chunk_radius: 4 });
    expect(writes.some((w) => w.name === 'client_cache_status')).toBe(true);
    expect(writes.some((w) => w.name === 'network_chunk_publisher_update')).toBe(true);
  });
});