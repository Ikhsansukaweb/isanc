/**
 * Anti-SSRF (temuan #7).
 *
 * Field `host` pada bot dipakai server untuk membuka koneksi TCP keluar.
 * Tanpa validasi, penyerang mendaftarkan bot dengan host 169.254.169.254
 * (metadata cloud) atau 127.0.0.1:3306 (MySQL internal) lalu memicu connect
 * → memindai jaringan internal dari dalam.
 *
 * Catatan: validasi TIDAK cukup dengan memeriksa pola string. Hostname
 * seperti `evil.com` bisa di-resolve ke 127.0.0.1 (DNS rebinding), jadi
 * hasil resolusi DNS juga harus diperiksa.
 */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** Apakah alamat IP termasuk ruang privat / loopback / link-local / reserved? */
export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);

  if (v === 4) {
    const p = addr.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    if (p[0] === 0) return true;                                  // 0.0.0.0/8 "this network"
    if (p[0] === 10) return true;                                 // privat
    if (p[0] === 127) return true;                                // loopback
    if (p[0] === 169 && p[1] === 254) return true;                // link-local + metadata cloud
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;    // privat
    if (p[0] === 192 && p[1] === 168) return true;                // privat
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;    // IETF protocol assignments
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;   // CGNAT
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmarking
    if (p[0] >= 224) return true;                                 // multicast & reserved
    return false;
  }

  if (v === 6) {
    const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
    if (a === '::1' || a === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;                // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(a)) return true;                // fe80::/10 link-local
    // IPv4-mapped (::ffff:127.0.0.1) → periksa bagian IPv4-nya.
    const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateAddress(m[1]);
    // Alamat IPv6 publik biasanya berada di 2000::/3.
    return !/^2[0-9a-f]{3}:|^3[0-9a-f]{3}:/.test(a);
  }

  return true; // bukan IP valid → anggap tidak aman
}

/** Nama host yang jelas-jelas menunjuk ke lingkungan internal. */
function isInternalName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return (
    h === 'localhost' ||
    h === 'metadata' ||
    h === 'metadata.google.internal' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost') ||
    h.endsWith('.home.arpa') ||
    !h.includes('.')            // hostname tanpa titik (mis. "redis", "db") hampir pasti internal
  );
}

/**
 * Validasi host tujuan bot.
 *
 * Mengembalikan `null` kalau aman, atau pesan error berbahasa Indonesia
 * kalau ditolak.
 *
 * `allowPrivate` hanya dipakai di lingkungan pengembangan (uji lokal).
 */
export async function assertPublicHost(
  host: unknown,
  allowPrivate = process.env.ALLOW_PRIVATE_HOSTS === '1'
): Promise<string | null> {
  if (typeof host !== 'string') return 'Host wajib berupa teks.';
  const h = host.trim().replace(/\.$/, '');
  if (!h) return 'Host wajib diisi.';
  if (h.length > 253) return 'Host terlalu panjang.';

  if (allowPrivate) return null;

  // 1) IP literal — langsung periksa, tanpa DNS.
  if (isIP(h)) {
    return isPrivateAddress(h)
      ? 'Host menunjuk ke alamat internal/privat — tidak diizinkan.'
      : null;
  }

  // 2) Hostname: pola DNS yang ketat. Menolak bentuk alternatif seperti
  //    2130706433 (desimal), 0x7f.0.0.1 (hex/oktal) yang bisa melewati
  //    pemeriksaan string naif.
  if (!/^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(h)) {
    return 'Format host tidak valid (gunakan nama domain atau IP, tanpa skema/port).';
  }
  if (isInternalName(h)) return 'Host internal tidak diizinkan.';

  // 3) Resolusi DNS: SEMUA alamat hasil resolusi harus publik.
  try {
    const addrs = await lookup(h, { all: true });
    if (addrs.length === 0) return 'Host tidak dapat diresolusi.';
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        return 'Host menunjuk ke alamat internal/privat — tidak diizinkan.';
      }
    }
  } catch {
    return 'Host tidak dapat diresolusi.';
  }

  return null;
}
