import os from 'node:os';
import { db } from '../db/index.js';
import { botManager } from '../core/manager.js';

// Konfigurasi AI — key & base URL dari env (jangan commit ke repo)
const AI_API_KEY = process.env.AI_API_KEY ?? '';
const AI_BASE_URL = (process.env.AI_BASE_URL ?? 'http://localhost:20128/v1').replace(/\/$/, '');

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `Kamu adalah asisten AI dari panel IsanC — panel kontrol bot Minecraft Bedrock buatan "isan ganteng".
Kamu membantu user mengelola bot AFK Minecraft: connect bot, login Microsoft, gerak (maju mundur lompat), chat in-game, inventory, chest, AFK anti-kick, otopilot goto.
Jawab singkat, praktis, bahasa Indonesia santai. Kalau ditanya soal code/teknis, jawab langsung.`;

/** Ambil riwayat chat AI dari DB (konteks/session) */
export async function getAiHistory(limit = 20): Promise<ChatMessage[]> {
  const rows = await db.all<{ role: string; content: string }>(
    `SELECT role, content FROM ai_messages ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  return rows.reverse().map((r) => ({ role: r.role as ChatMessage['role'], content: r.content }));
}

/** Simpan pesan ke DB */
export async function saveAiMessage(role: ChatMessage['role'], content: string): Promise<void> {
  await db.run(`INSERT INTO ai_messages (role, content) VALUES (?, ?)`, [role, content]);
}

/** Hapus riwayat AI (session baru) */
export async function clearAiHistory(): Promise<void> {
  await db.run(`DELETE FROM ai_messages`);
}

/** Server stats: RAM, CPU, uptime, latency tiap bot */
export function getServerStats() {
  const mem = process.memoryUsage();
  const cpu = osCpuUsage();

  // botManager.list() SUDAH mengembalikan status JSON (bukan objek BotClient).
  // Dibungkus try/catch supaya satu bot bermasalah tidak mematikan seluruh stats.
  let bots: Array<Record<string, unknown>> = [];
  try {
    bots = botManager.list().map((raw) => {
      const s = raw as unknown as {
        name?: string; status?: string; uptimeSeconds?: number; pingMs?: number;
        playersOnline?: number; position?: unknown; health?: number;
      };
      return {
        name: s.name ?? '?',
        status: s.status ?? 'unknown',
        uptimeSeconds: s.uptimeSeconds ?? 0,
        pingMs: s.pingMs ?? null,
        playersOnline: s.playersOnline ?? 0,
        position: s.position ?? null,
        health: s.health ?? 0,
      };
    });
  } catch (e) {
    console.error('[stats] gagal baca daftar bot:', (e as Error).message);
  }

  return {
    uptime: process.uptime(),
    ram: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    cpu: cpu,
    bots,
    botCount: bots.length,
    timestamp: new Date().toISOString(),
  };
}

let _lastCpuSample: { idle: number; total: number } | null = null;
function osCpuUsage(): number {
  try {
    const cpus = os.cpus() as Array<{ times: { idle: number; user: number; nice: number; sys: number; irq: number } }>;
    let idle = 0, total = 0;
    for (const c of cpus) {
      idle += c.times.idle;
      total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
    }
    if (_lastCpuSample) {
      const dIdle = idle - _lastCpuSample.idle;
      const dTotal = total - _lastCpuSample.total;
      _lastCpuSample = { idle, total };
      if (dTotal > 0) return Math.round((1 - dIdle / dTotal) * 100);
    } else {
      _lastCpuSample = { idle, total };
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Panggil AI (OpenAI-compatible) dengan riwayat session */
export async function aiChat(userMessage: string): Promise<{ reply: string; history: ChatMessage[] }> {
  const history = await getAiHistory(30);

  // Simpan pesan user dulu
  await saveAiMessage('user', userMessage);

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history, // termasuk pesan user yang baru
  ];

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key diambil dari env (AI_API_KEY). Jangan hardcode di kode.
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'isan',
        messages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = (data?.choices?.[0]?.message?.content ?? '').trim();
    if (!reply) throw new Error('AI balasan kosong');

    await saveAiMessage('assistant', reply);
    return { reply, history: await getAiHistory(30) };
  } catch (e) {
    // Rollback pesan user kalau gagal (biar konteks tidak korup)
    await db.run(
      `DELETE FROM ai_messages WHERE id = (SELECT MAX(id) FROM ai_messages) AND role = 'user'`
    );
    throw e;
  }
}
