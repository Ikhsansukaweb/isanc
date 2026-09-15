/** @type {import('next').NextConfig} */

/*
 * URL backend. Dipakai untuk rewrite /api/* DAN untuk izin connect-src CSP.
 *
 * PENTING — harus sama dengan URL yang benar-benar dipanggil browser
 * (web/lib/api.ts & web/lib/realtime.ts memakai NEXT_PUBLIC_API_URL).
 * Sebelumnya nilai default di sini `localhost:3738` (port salah, backend di
 * 3737) padahal kode frontend memanggil https://api.skadesmart.web.id →
 * CSP memblokir SEMUA request API sehingga login tidak bisa sama sekali.
 */
const API = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'https://api.skadesmart.web.id'
).replace(/\/$/, '');
const WS = API.replace(/^http/, 'ws');

// Origin tambahan yang memang diperlukan halaman.
//  - cloudflareinsights.com → beacon analitik yang disuntik Cloudflare, bukan kode kita.
//  - challenges.cloudflare.com → widget Turnstile kalau nanti diaktifkan.
const CLOUDFLARE = 'https://static.cloudflareinsights.com https://cloudflareinsights.com';

/*
 * Content-Security-Policy (audit #6a).
 *
 * Sebelumnya tidak ada CSP sama sekali — diverifikasi dengan
 * `curl -I https://skadesmart.web.id/ | grep -i content-security-policy`
 * yang menghasilkan nol hasil. Padahal backend mematikannya dengan alasan
 * "dikelola frontend". Akibatnya setiap celah XSS (audit #3) langsung
 * menjadi eksekusi kode penuh tanpa lapis pertahanan kedua.
 *
 * Catatan:
 *  - 'unsafe-inline' pada script/style diperlukan runtime Next.js.
 *    Untuk pengerasan lanjutan, migrasikan ke nonce berbasis middleware.
 *  - img-src mengizinkan files.catbox.moe karena foto profil disimpan di sana.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CLOUDFLARE} https://challenges.cloudflare.com`,
  "script-src-elem 'self' 'unsafe-inline' " + CLOUDFLARE + " https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://files.catbox.moe",
  "font-src 'self' data:",
  `connect-src 'self' ${API} ${WS}`,
  // Blob/data: dipakai untuk pembuatan worker & sumber internal Next.js.
  "worker-src 'self' blob:",
  // Turnstile/iframe pihak ketiga yang memang dibutuhkan.
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // form-action: 'self' + API (semua form submit lewat fetch, tapi aman).
  `form-action 'self' ${API}`,
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  output: 'standalone',

  // Jangan bocorkan stack yang dipakai (audit #6c).
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // Halaman berisi data pribadi: jangan pernah di-cache oleh CDN
      // (audit #16 — pengerasan cache).
      {
        source: '/dashboard/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
      {
        source: '/login',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },

  /*
   * Rewrite proxy /api/* → backend.
   *
   * Catatan penting: frontend TIDAK memakai jalur ini. web/lib/api.ts dan
   * web/lib/realtime.ts memanggil `NEXT_PUBLIC_API_URL` secara langsung
   * (https://api.skadesmart.web.id), sehingga yang menentukan izin adalah
   * connect-src pada CSP di atas — bukan rewrites ini.
   *
   * Sebelumnya default API di sini `localhost:3738` (port salah) sehingga
   * proxy ini balas 500. Sekarang defaultnya sudah benar, dan CSP memakai
   * variabel yang SAMA supaya keduanya tidak bisa lagi berbeda.
   * Dibiarkan aktif sebagai cadangan untuk pemanggilan same-origin.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
