/**
 * Upload foto profil ke catbox.moe.
 *
 * Catbox memakai satu endpoint (POST multipart ke /user/api.php) dengan:
 *   reqtype=fileupload
 *   userhash=<hash akun>  → tanpa ini file dianggap anonim
 *   fileToUpload=<berkas>
 *
 * Balasannya berupa URL polos, contoh:
 *   https://files.catbox.moe/7yg5my.png
 *
 * userhash diambil dari env CATBOX_USERHASH (jangan ditulis di kode).
 */
import { randomBytes } from 'node:crypto';

const CATBOX_URL = process.env.CATBOX_URL ?? 'https://catbox.moe/user/api.php';
const CATBOX_USERHASH = process.env.CATBOX_USERHASH ?? '';

/** Batas ukuran file: 2 MB (catbox sendiri 200 MB, tapi avatar tidak perlu besar). */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Tipe gambar yang diterima. */
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function catboxEnabled(): boolean {
  return CATBOX_USERHASH.length > 0;
}

export interface UploadedAvatar {
  url: string;
  bytes: number;
  mime: string;
}

/**
 * Upload buffer gambar ke catbox.
 * Throw Error dengan pesan berbahasa Indonesia kalau gagal — pemanggil
 * tinggal meneruskan pesannya ke user.
 */
export async function uploadAvatar(file: {
  buffer: Buffer;
  size: number;
}): Promise<UploadedAvatar> {
  if (!catboxEnabled()) {
    throw new Error('Upload foto profil belum dikonfigurasi (CATBOX_USERHASH kosong).');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(`Ukuran foto maksimal ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB.`);
  }

  // Tipe ditentukan SERVER dari isi berkas (audit #22a). Header Content-Type
  // dari klien diabaikan sepenuhnya — header itu bisa dipalsukan sesuka hati.
  const detected = detectImageMime(file.buffer);
  if (!detected) {
    throw new Error('File yang diunggah bukan gambar yang valid (PNG/JPG/WEBP/GIF).');
  }
  const ext = ALLOWED_MIME[detected];
  if (!ext) {
    throw new Error('Format foto harus PNG, JPG, WEBP, atau GIF.');
  }
  const mime = detected;

  // Nama file acak supaya tidak menimpa unggahan lain.
  const filename = `avatar_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;

  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('userhash', CATBOX_USERHASH);
  form.append('fileToUpload', new Blob([new Uint8Array(file.buffer)], { type: mime }), filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(CATBOX_URL, { method: 'POST', body: form, signal: ctrl.signal });
    const text = (await res.text()).trim();

    if (!res.ok) {
      throw new Error(`catbox menolak unggahan (HTTP ${res.status}).`);
    }
    // Sukses = balasan berupa URL. Selain itu berarti pesan error dari catbox.
    if (!/^https?:\/\/\S+$/.test(text)) {
      throw new Error(`catbox: ${text.slice(0, 150)}`);
    }
    // Hanya izinkan domain catbox supaya URL yang disimpan bisa dipercaya.
    if (!/^https:\/\/files\.catbox\.moe\//.test(text)) {
      throw new Error(`catbox mengembalikan URL tak dikenal: ${text.slice(0, 100)}`);
    }

    // `mime` = hasil deteksi server dari magic bytes (audit #22a).
    return { url: text, bytes: file.size, mime };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error('Unggah ke catbox melebihi batas waktu. Coba lagi.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deteksi tipe gambar dari ISI berkas (magic bytes) — BUKAN dari header
 * Content-Type kiriman klien (audit #22a).
 *
 * Sebelumnya MIME diambil dari header, sehingga berkas PNG yang dilabeli
 * `image/gif` tetap lolos dan diberi ekstensi .gif. Dengan mendeteksi
 * sendiri, ekstensi & MIME yang dikirim ke catbox selalu cocok dengan isi
 * berkas sebenarnya.
 */
export function detectImageMime(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** Cek magic bytes beberapa format gambar populer. */
function looksLikeImage(buf: Buffer): boolean {
  if (detectImageMime(buf)) return true;
  if (buf.length < 12) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // WEBP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Hapus file lama di catbox saat user ganti foto (opsional, gagal senyap). */
export async function deleteFromCatbox(url: string): Promise<void> {
  if (!catboxEnabled()) return;
  if (!/^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(url)) return;

  const filename = url.split('/').pop();
  if (!filename) return;

  const form = new FormData();
  form.append('reqtype', 'deletefiles');
  form.append('userhash', CATBOX_USERHASH);
  form.append('files', filename);

  try {
    await fetch(CATBOX_URL, { method: 'POST', body: form });
  } catch {
    /* penghapusan bersifat opsional — jangan gagalkan permintaan user */
  }
}
