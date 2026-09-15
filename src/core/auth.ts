import { db } from '../db/index.js';

/**
 * Microsoft auth — device code flow.
 * Simpan refresh token di MySQL supaya login sekali saja.
 * (bedrock-protocol punya auth bawaan via prismarine-auth — ini wrapper
 *  utilitas untuk simpan/dapat kembali token dari DB.)
 */

const MS_AUTH_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';

export interface MsToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export async function saveToken(token: MsToken): Promise<void> {
  // Dulu pakai ON CONFLICT(id) DO UPDATE yang selalu meng-insert baris baru
  // (id auto-increment tidak pernah bentrok), jadi efeknya selalu INSERT.
  // Di MySQL kita pakai INSERT biasa supaya perilakunya identik.
  await db.run(
    `INSERT INTO auth_tokens (provider, access_token, refresh_token, expires_at)
     VALUES ('microsoft', ?, ?, ?)`,
    [token.access_token, token.refresh_token, token.expires_at]
  );
}

export async function getSavedToken(): Promise<MsToken | null> {
  const row = await db.get<MsToken>(
    `SELECT access_token, refresh_token, expires_at FROM auth_tokens
     WHERE provider = 'microsoft' ORDER BY id DESC LIMIT 1`
  );
  if (!row) return null;
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expires_at: Number(row.expires_at),
  };
}

export async function clearToken(): Promise<void> {
  await db.run(`DELETE FROM auth_tokens WHERE provider = 'microsoft'`);
}

export function isTokenValid(token: MsToken | null): boolean {
  if (!token?.access_token) return false;
  return Number(token.expires_at) > Date.now();
}

/** Wrapper: bedakan flow online vs offline */
export function authOptions(): Record<string, unknown> {
  return {
    onMsaCode: (data: { user_code: string; verification_uri: string }) => {
      console.log('Microsoft code:', data.user_code);
      console.log(`Buka ${data.verification_uri} dan masukkan kode di atas.`);
    },
  };
}

export { MS_AUTH_URL };
