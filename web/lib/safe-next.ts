/**
 * Normalisasi parameter `?next=` (temuan #17 — Unvalidated Redirect).
 *
 * Sebelumnya: `const next = params.get('next') ?? '/dashboard'` lalu
 * `router.replace(next)` → `?next=https://situs-penipu.example` membuat
 * korban diarahkan ke domain penyerang TEPAT setelah login berhasil
 * (phishing yang sangat meyakinkan).
 *
 * Fungsi ini hanya mengizinkan path internal yang dikenal.
 */

/** Halaman internal yang boleh dijadikan tujuan redirect. */
const ALLOWED = /^\/(dashboard|login)(\/[A-Za-z0-9_\-%.#]*)?$/;

export function safeNext(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || typeof raw !== 'string') return fallback;

  // Buang karakter kontrol & spasi yang bisa menyamarkan skema.
  const v = raw.replace(/[\u0000-\u0020\u007F]/g, '');
  if (!v) return fallback;

  // Harus path relatif yang diawali tepat satu '/'.
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//')) return fallback;            // protocol-relative (//evil.com)
  if (v.includes('\\')) return fallback;              // backslash → dinormalkan browser jadi '/'
  if (/^\/%2f/i.test(v) || /^\/%5c/i.test(v)) return fallback;

  // Tolak kalau ada skema di posisi mana pun (mis. "/x?u=javascript:alert(1)").
  if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return fallback;

  // Hanya izinkan halaman internal yang dikenal.
  return ALLOWED.test(v) ? v : fallback;
}
