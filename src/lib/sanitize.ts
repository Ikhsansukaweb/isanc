/**
 * Sanitasi teks dari pengguna (temuan #3 — Stored/Reflected XSS).
 *
 * Kenapa perlu di SERVER: React memang meng-escape teks saat ini, tapi itu
 * satu-satunya lapisan. Kalau nanti ada fitur ekspor, notifikasi, integrasi
 * pihak ketiga, atau seorang dev mengganti {m.body} menjadi
 * dangerouslySetInnerHTML, payload yang sudah tersimpan di DB akan langsung
 * tereksekusi menjadi stored XSS. Jadi bersihkan SEBELUM disimpan.
 */

/** Entitas HTML yang lazim di-decode browser menjadi karakter berbahaya. */
const ENTITIES: Record<string, string> = {
  '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&',
  '&#x3c;': '<', '&#x3e;': '>', '&#60;': '<', '&#62;': '>',
};

/**
 * Bersihkan teks: buang karakter kontrol, tag HTML, komentar HTML, dan
 * netralkan entitas yang bisa di-decode menjadi tag. Sisakan teks polos.
 */
export function sanitizeText(input: string, maxLen = 300): string {
  if (typeof input !== 'string') return '';

  return input
    .normalize('NFC')
    // Karakter kontrol (kecuali tab/baris baru — dirapatkan di bawah).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Komentar HTML (bisa menyembunyikan tag).
    .replace(/<!--[\s\S]*?-->/g, '')
    // Blok berbahaya beserta isinya.
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Tag HTML apa pun.
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // Entitas yang men-decode jadi tag.
    .replace(/&(?:#x?[0-9a-f]+|[a-z]+);/gi, (m) => ENTITIES[m.toLowerCase()] ?? '')
    // Sisa karakter tag mentah.
    .replace(/[<>]/g, '')
    // Rapikan spasi & potong.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Validasi ketat nama resource (label bot, dsb) — dipakai sebelum nilai
 * apa pun direfleksikan ke respons (temuan #3b, Reflected XSS).
 */
export function isSafeLabel(s: unknown): boolean {
  return typeof s === 'string' && /^[a-zA-Z0-9_#\-\s]{1,64}$/.test(s);
}

/**
 * Batasi nilai yang akan dimasukkan ke header HTTP — cegah CRLF injection
 * (temuan #19) walau Node/Express sudah menolaknya.
 */
export function stripHeaderChars(s: string): string {
  return String(s).replace(/[\r\n\u0000]/g, '');
}
