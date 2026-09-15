const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.skadesmart.web.id';

/** Basis URL WebSocket — diturunkan dari API_URL (http→ws, https→wss). */
export const WS_URL = API_URL.replace(/^http/, 'ws');

// Access token disimpan di memori + sessionStorage (bukan localStorage: kurangi risiko XSS persisten)
let accessToken: string | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
  if (typeof window === 'undefined') return;
  if (t) sessionStorage.setItem('afk_token', t);
  else sessionStorage.removeItem('afk_token');
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') {
    accessToken = sessionStorage.getItem('afk_token');
  }
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Fetch wrapper: otomatis kirim Bearer token, dan sekali coba refresh
 * kalau token kedaluwarsa (401) memakai refresh token (httpOnly cookie).
 */
async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { skipAuth, ...init } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (!skipAuth) {
    const t = getAccessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }

  let res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  // Token kedaluwarsa → refresh sekali, lalu ulangi request
  if (res.status === 401 && !skipAuth && !path.startsWith('/api/auth/')) {
    const ok = await tryRefresh();
    if (ok) {
      const t = getAccessToken();
      if (t) headers.Authorization = `Bearer ${t}`;
      res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

/** Refresh access token pakai httpOnly cookie. */
export async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export { api, API_URL };

// ==================== AKUN ====================
export interface AuthUser {
  id: number;
  username: string;
  tag: string;
  displayName: string;
  role: string;
  balance: number;
  /** URL foto profil (catbox.moe). null = belum pasang. */
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export const authRegister = (username: string, password: string) =>
  api<{ user: AuthUser; accessToken: string }>('/api/auth/register', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ username, password }),
  });

export const authLogin = (username: string, password: string) =>
  api<{ user: AuthUser; accessToken: string }>('/api/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ username, password }),
  });

export const authLogout = () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' });
export const authMe = () => api<{ user: AuthUser }>('/api/auth/me');
export const authChangePassword = (oldPassword: string, newPassword: string) =>
  api<{ ok: boolean; message: string }>('/api/account/password', {
    method: 'PATCH',
    body: JSON.stringify({ oldPassword, newPassword }),
  });

// ==================== FOTO PROFIL ====================

/** Apakah fitur foto profil aktif (butuh userhash catbox di server). */
export const getAvatarConfig = () =>
  api<{ enabled: boolean; maxBytes: number }>('/api/account/avatar/config');

/**
 * Unggah foto profil.
 * File dikirim sebagai body mentah (bukan multipart) supaya server bisa
 * menyalurkannya langsung ke catbox tanpa menyentuh disk.
 */
export async function uploadAvatar(file: File): Promise<{ ok: boolean; avatarUrl: string }> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/api/account/avatar`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/png',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });

  const data = (await res.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Gagal mengunggah foto (HTTP ${res.status}).`);
  if (!data.avatarUrl) throw new Error('Server tidak mengembalikan URL foto.');
  return { ok: true, avatarUrl: data.avatarUrl };
}

/** Hapus foto profil. */
export const deleteAvatar = () =>
  api<{ ok: boolean }>('/api/account/avatar', { method: 'DELETE' });

// ==================== SALDO ====================
export interface BalanceTx {
  id: number; type: string; amount: number; balance_after: number;
  description: string | null; ref: string | null; created_at: string;
}
export interface DepositRow {
  id: number; kode_deposit: string; amount: number; total_bayar: number | null;
  fee: number | null; qr_url: string | null; qr_string: string | null;
  status: string; created_at: string; paid_at: string | null;
}
export interface BotPlan { id: string; label: string; days: number; price: number; note?: string }

export const getSaldo = () =>
  api<{ balance: number; history: BalanceTx[]; deposits: DepositRow[]; plans: BotPlan[] }>('/api/account/saldo');

export interface CreatedDepositResult {
  kode_deposit: string; amount: number; total_bayar: number; fee: number;
  saldo_didapat: number; reff_id?: string; qr_url: string | null; qr_string: string | null;
  pay_url: string | null; expired_at: string | null; panduan: string | null; status: string;
}

export const createDeposit = (amount: number) =>
  api<CreatedDepositResult>('/api/account/deposit', { method: 'POST', body: JSON.stringify({ amount }) });

export const checkDeposit = (kode: string) =>
  api<DepositRow & { credited: number; raw_status: string }>(`/api/account/deposit/${encodeURIComponent(kode)}`);

export const cancelDeposit = (kode: string) =>
  api<{ kode_deposit: string; status: string }>(`/api/account/deposit/${encodeURIComponent(kode)}/cancel`, {
    method: 'POST',
    body: '{}',
  });

// ==================== BOT MILIK USER ====================
export interface UserBot {
  id: number; user_id: number; label: string; base_name: string; tag: string;
  host: string; port: number; version: string | null; offline_mode: number;
  expires_at: number | null; expiresAt: number | null; expired: boolean;
  remainingMs: number | null; active: number; created_at: string;
  live: BotState | null;
  message?: string; balance?: number;
}

export const getUserBots = () => api<UserBot[]>('/api/bots');

/** Satu bot milik user + status live (termasuk msaCode kalau butuh login MS) */
export const getOwnedBot = (label: string) =>
  api<UserBot>(`/api/bots/${encodeURIComponent(label)}`);

export const createUserBot = (data: { baseName: string; host: string; port?: number; version?: string; offlineMode?: boolean }) =>
  api<UserBot>('/api/bots', { method: 'POST', body: JSON.stringify(data) });

export const rentBot = (label: string, plan: string, days?: number) =>
  api<UserBot>(`/api/bots/${encodeURIComponent(label)}/rent`, {
    method: 'POST',
    body: JSON.stringify({ plan, days }),
  });

export const connectUserBot = (label: string) =>
  api<{ ok: boolean; label: string; status?: string; msaCode?: AuthCode | null }>(
    `/api/bots/${encodeURIComponent(label)}/connect`,
    { method: 'POST', body: '{}' }
  );

export const disconnectUserBot = (label: string) =>
  api<{ ok: boolean }>(`/api/bots/${encodeURIComponent(label)}/disconnect`, { method: 'POST', body: '{}' });

/** Ubah host/port/versi bot (mis. mengisi versi yang kosong agar bot bisa jalan) */
export const updateUserBot = (
  label: string,
  data: { host?: string; port?: number; version?: string; offlineMode?: boolean }
) =>
  api<UserBot>(`/api/bots/${encodeURIComponent(label)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteUserBot = (label: string) =>
  api<{ ok: boolean }>(`/api/bots/${encodeURIComponent(label)}`, { method: 'DELETE' });

// ==================== BOT (live control) ====================
export interface InventoryItem { name: string; count: number; slot: number; displayName?: string }

export interface ContainerState {
  open: boolean;
  windowId?: number;
  windowType?: string;
  slots?: (InventoryItem | null)[];
  items?: InventoryItem[];
}

export interface ChatEntry {
  username: string;
  message: string;
  timestamp?: string;
  system?: boolean;
  self?: boolean;
  source?: string;
}

export interface BotState {
  name: string;
  status: string;
  /** Device code Microsoft kalau status 'awaiting_auth' */
  msaCode?: AuthCode | null;
  position: { x: number; y: number; z: number } | null;
  health: number;
  playersOnline: number;
  players?: string[];
  container: ContainerState | null;
  inventory?: (InventoryItem | null)[];
  selectedHotbarSlot?: number;
  lastError?: string | null;
  chat?: ChatEntry[];
  uptimeSeconds?: number;
  pingMs?: number | null;
  afk?: boolean;
  config?: { host: string; port: number; version?: string; offline?: boolean };
  kickReason?: string | null;
}

export interface AuthCode {
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

export const getBots = () => api<BotState[]>('/api/bots/live');
export const getBot = (name: string) => api<BotState>(`/api/bot/${encodeURIComponent(name)}`);
export const getBotAuth = (name: string) =>
  api<{ authCode: AuthCode | null }>(`/api/bot/${encodeURIComponent(name)}/auth`);

export const connectBot = (data: {
  name: string; host: string; port?: number; version?: string; offlineMode?: boolean;
}) => api<{ ok: boolean; name: string }>('/api/bot/connect', { method: 'POST', body: JSON.stringify(data) });

export const disconnectBot = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/disconnect`, { method: 'POST', body: '{}' });

export const setMove = (name: string, dir: string, state: boolean) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction: dir, state }),
  });

export const botJump = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/jump`, { method: 'POST', body: '{}' });

export const botTurn = (name: string, deltaYaw: number, deltaPitch: number) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/turn`, {
    method: 'POST',
    body: JSON.stringify({ deltaYaw, deltaPitch }),
  });

export const botGoto = (name: string, x: number, y?: number, z?: number) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/goto`, {
    method: 'POST',
    body: JSON.stringify({ x, y, z }),
  });

export const botGotoCancel = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/goto/cancel`, { method: 'POST', body: '{}' });

export const botAttack = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/attack`, { method: 'POST', body: '{}' });

export const botPlace = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/place`, { method: 'POST', body: '{}' });

export const botUse = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/use`, { method: 'POST', body: '{}' });

export const botHotbar = (name: string, slot: number) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/hotbar`, {
    method: 'POST',
    body: JSON.stringify({ slot }),
  });

export const botAfk = (name: string, enabled: boolean) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/afk`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });

export const sendChat = (name: string, message: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

export const containerOpen = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/container/open`, { method: 'POST', body: '{}' });

export const containerClose = (name: string) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/container/close`, { method: 'POST', body: '{}' });

export const containerClick = (name: string, slot: number) =>
  api<{ ok: boolean }>(`/api/bot/${encodeURIComponent(name)}/container/click`, {
    method: 'POST',
    body: JSON.stringify({ slot }),
  });

// ==================== STATS & AI ====================
export interface ServerStats {
  uptime: number;
  ram: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
  cpu: number;
  bots: Array<{
    name: string; status: string; uptimeSeconds: number; pingMs: number | null;
    playersOnline: number; position: { x: number; y: number; z: number } | null; health: number;
  }>;
  botCount: number;
  timestamp: string;
}
export const getStats = () => api<ServerStats>('/api/stats', { skipAuth: true });

export interface AiMessage { role: string; content: string }
export const aiSend = (message: string) =>
  api<{ reply: string; history: AiMessage[] }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message }) });
export const aiHistory = () => api<{ messages: AiMessage[]; hasHistory: boolean }>('/api/ai/history');
export const aiClear = () => api<{ ok: boolean }>('/api/ai/history', { method: 'DELETE' });
