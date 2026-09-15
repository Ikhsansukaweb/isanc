import { db } from '../db/index.js';
import { pushFeed } from './realtime.js';

// ============ Konfigurasi QRIS Go (ariepulsa) ============
const QRIS_URL = process.env.QRIS_URL ?? 'https://ariepulsa.com/api/qrisgo';
const QRIS_API_KEY = process.env.QRIS_API_KEY ?? '';
if (!QRIS_API_KEY) {
  console.warn('[qris] QRIS_API_KEY belum diset — fitur deposit nonaktif.');
}

// Fee ditanggung pelanggan (type_fee=1), sesuai permintaan.
const TYPE_FEE = '1';

const MIN_DEPOSIT = 1000;
const MAX_DEPOSIT = 5_000_000;

export interface DepositRow {
  id: number;
  user_id: number;
  kode_deposit: string;
  amount: number;
  total_bayar: number | null;
  fee: number | null;
  qr_url: string | null;
  qr_string: string | null;
  status: string;
  raw_response: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

export function qrisEnabled(): boolean {
  return QRIS_API_KEY.length > 0;
}

/** Panggil API QRIS. Timeout 25s supaya tidak menggantung. */
async function callQris(fields: Record<string, string>): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('api_key', QRIS_API_KEY);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(QRIS_URL, { method: 'POST', body: form, signal: ctrl.signal });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Respons QRIS tidak valid: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Ambil angka dari respons dengan beberapa kemungkinan nama field. */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  // kadang data dibungkus { data: {...} }
  const data = obj.data;
  if (data && typeof data === 'object') return pickString(data as Record<string, unknown>, keys);
  return null;
}

function isSuccess(obj: Record<string, unknown>): boolean {
  // ariepulsa: { status: true, data: {...} }
  if (obj.status === true) return true;
  const status = String(obj.status ?? obj.result ?? '').toLowerCase();
  if (['success', 'sukses', 'ok', 'true', 'berhasil'].includes(status)) return true;
  if (obj.success === true) return true;
  if (pickString(obj, ['kode_deposit', 'qris_url', 'qr_url', 'qr_string'])) return true;
  return false;
}

export interface CreatedDeposit {
  kode_deposit: string;
  amount: number;          // nominal yang diminta user
  total_bayar: number;     // yang harus dibayar (termasuk fee + kode unik)
  fee: number;
  saldo_didapat: number;   // saldo yang masuk setelah dibayar
  reff_id: string;         // referensi internal ke gateway
  qr_url: string | null;   // gambar QR
  qr_string: string | null;
  pay_url: string | null;  // halaman pembayaran
  expired_at: string | null;
  panduan: string | null;
  status: string;
}

/**
 * Buat deposit baru. Fee + kode unik ditanggung user
 * (total bayar = nominal + fee + kode unik).
 * qrisgo mewajibkan reff_id unik per transaksi.
 */
export async function createDeposit(userId: number, amount: number): Promise<CreatedDeposit> {
  if (!qrisEnabled()) throw new Error('Deposit sedang tidak tersedia (gateway belum dikonfigurasi).');
  if (!Number.isInteger(amount) || amount < MIN_DEPOSIT) {
    throw new Error(`Minimal deposit Rp${MIN_DEPOSIT.toLocaleString('id-ID')}.`);
  }
  if (amount > MAX_DEPOSIT) {
    throw new Error(`Maksimal deposit Rp${MAX_DEPOSIT.toLocaleString('id-ID')}.`);
  }

  // reff_id: unik, mudah dilacak (AFK-<userId>-<timestamp>-<acak>)
  const reffId = `AFK-${userId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const resp = await callQris({
    action: 'get-deposit',
    jumlah: String(amount),
    reff_id: reffId,
    type_fee: TYPE_FEE,
  });

  if (!isSuccess(resp)) {
    const msg = pickString(resp, ['message', 'pesan', 'error', 'msg']) ?? 'Gateway menolak permintaan deposit.';
    throw new Error(msg);
  }

  const kode = pickString(resp, ['kode_deposit', 'kode', 'trx_id', 'id_deposit', 'reff_id']);
  if (!kode) throw new Error('Gateway tidak mengembalikan kode deposit.');

  const fee = pickNumber(resp, ['fee', 'biaya', 'biaya_admin']) ?? 0;
  const unik = pickNumber(resp, ['kode_unik']) ?? 0;
  const total = pickNumber(resp, ['jumlah_transfer', 'total_bayar', 'total', 'jumlah_bayar']) ?? amount + fee + unik;
  const saldoDidapat = pickNumber(resp, ['saldo_didapat']) ?? amount;
  const qrUrl = pickString(resp, ['link_qr', 'qr_url', 'url_qr', 'qris_url', 'url']);
  const qrString = pickString(resp, ['qr_string', 'qris_string', 'qr_content', 'qris_content']);
  const payUrl = pickString(resp, ['link_payment', 'payment_url', 'url_payment']);
  const expiredAt = pickString(resp, ['expired', 'expired_at', 'kadaluarsa']);
  const panduan = pickString(resp, ['panduan_pembayaran', 'panduan', 'instruksi']);

  await db.run(
    `INSERT INTO deposits (user_id, kode_deposit, amount, total_bayar, fee, qr_url, qr_string, status, raw_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      userId,
      kode,
      amount,
      total,
      fee + unik,
      qrUrl,
      qrString,
      JSON.stringify({ reff_id: reffId, ...resp }).slice(0, 4000),
    ]
  );

  return {
    kode_deposit: kode,
    amount,
    total_bayar: total,
    fee: fee + unik,
    saldo_didapat: saldoDidapat,
    reff_id: reffId,
    qr_url: qrUrl,
    qr_string: qrString,
    pay_url: payUrl,
    expired_at: expiredAt,
    panduan,
    status: 'pending',
  };
}

/**
 * Cek status ke gateway; kalau sudah dibayar → saldo user ditambah
 * (sekali saja, dijaga oleh status di DB + transaksi SQL).
 */
export async function checkDeposit(userId: number, kodeDeposit: string) {
  const dep = await db.get<DepositRow>(
    'SELECT * FROM deposits WHERE kode_deposit = ? AND user_id = ?',
    [kodeDeposit, userId]
  );
  if (!dep) throw new Error('Deposit tidak ditemukan.');

  // Sudah final → kembalikan apa adanya
  if (dep.status === 'success' || dep.status === 'cancel' || dep.status === 'expired') {
    return { ...dep, credited: dep.status === 'success' ? dep.amount : 0 };
  }

  const resp = await callQris({ action: 'status-deposit', kode_deposit: kodeDeposit });
  const rawStatus = String(pickString(resp, ['status', 'status_deposit', 'state']) ?? '').toLowerCase();

  // Gateway kadang tidak mengirim ulang link QR saat cek status → isi dari nilai lama
  const qrUrl = pickString(resp, ['link_qr', 'qr_url', 'url_qr', 'qris_url']);
  const qrString = pickString(resp, ['qr_string', 'qris_string', 'qr_content']);
  const payUrl = pickString(resp, ['link_payment', 'payment_url']);
  const total = pickNumber(resp, ['jumlah_transfer', 'total_bayar', 'total', 'jumlah_bayar']);

  let newStatus = 'pending';
  if (['success', 'sukses', 'paid', 'berhasil', 'settlement', 'lunas'].includes(rawStatus)) newStatus = 'success';
  else if (['cancel', 'cancelled', 'batal', 'failed', 'gagal', 'expired'].includes(rawStatus)) {
    newStatus = rawStatus.includes('expire') ? 'expired' : 'cancel';
  }

  let credited = 0;
  if (newStatus === 'success' && dep.status !== 'success') {
    credited = await creditDeposit(dep.id);
  } else {
    await db.run(
      `UPDATE deposits SET status = ?,
         qr_url = COALESCE(?, qr_url), qr_string = COALESCE(?, qr_string),
         total_bayar = COALESCE(?, total_bayar),
         raw_response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newStatus, qrUrl, qrString, total, JSON.stringify(resp).slice(0, 4000), dep.id]
    );
  }

  const fresh = await db.get<DepositRow>('SELECT * FROM deposits WHERE id = ?', [dep.id]);
  return { ...(fresh as DepositRow), credited, pay_url: payUrl, raw_status: rawStatus };
}

/** Tambah saldo untuk deposit yang sudah dibayar. Idempoten. */
export async function creditDeposit(depositId: number): Promise<number> {
  // Transaksi mengembalikan info deposit; feed disiarkan SETELAH commit supaya
  // dashboard tidak pernah menampilkan aktivitas dari transaksi yang gagal.
  //
  // Anti race condition (#12): dua polling status yang berbarengan bisa
  // sama-sama melihat status 'pending' lalu menambah saldo dua kali. Karena
  // itu baris deposit DIKUNCI (FOR UPDATE) dan statusnya diklaim dengan
  // UPDATE bersyarat — hanya satu transaksi yang bisa berhasil.
  const result = await db.transaction(async (tx) => {
    const dep = await tx.get<DepositRow>(
      'SELECT * FROM deposits WHERE id = ? FOR UPDATE',
      [depositId]
    );
    if (!dep || dep.status === 'success') return null;

    const nominal = Number(dep.amount);

    // Klaim status secara atomik. Kalau transaksi lain sudah mengklaim lebih
    // dulu, affectedRows = 0 → batalkan supaya saldo tidak bertambah 2×.
    const claim = await tx.run(
      `UPDATE deposits SET status = 'success', paid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status <> 'success'`,
      [depositId]
    );
    if (claim.affectedRows === 0) return null;

    // Tambah saldo langsung di SQL (atomik), lalu baca hasilnya untuk catatan.
    await tx.run('UPDATE users SET balance = balance + ? WHERE id = ?', [
      nominal,
      dep.user_id,
    ]);
    const user = await tx.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', [
      dep.user_id,
    ]);
    if (!user) return null;
    const after = Number(user.balance);

    await tx.run(
      `INSERT INTO balance_transactions (user_id, type, amount, balance_after, description, ref)
       VALUES (?, 'deposit', ?, ?, ?, ?)`,
      [dep.user_id, nominal, after, `Deposit QRIS ${dep.kode_deposit}`, dep.kode_deposit]
    );

    const owner = await tx.get<{ username: string; tag: string }>(
      'SELECT username, tag FROM users WHERE id = ?',
      [dep.user_id]
    );

    return { nominal, userId: dep.user_id, owner };
  });

  if (!result) return 0;

  if (result.owner) {
    const label = `${result.owner.username}#${result.owner.tag}`;
    await pushFeed({
      kind: 'deposit',
      userId: result.userId,
      label,
      body: `${label} berhasil deposit Rp${result.nominal.toLocaleString('id-ID')}`,
      meta: { amount: result.nominal },
    });
  }

  return result.nominal;
}

/** Batalkan deposit pending. */
export async function cancelDeposit(userId: number, kodeDeposit: string) {
  // Kunci baris + klaim status secara atomik (#12), sama seperti creditDeposit.
  // Mencegah deposit yang baru saja lunas ikut dibatalkan oleh request bersamaan.
  const dep = await db.transaction(async (tx) => {
    const row = await tx.get<DepositRow>(
      'SELECT * FROM deposits WHERE kode_deposit = ? AND user_id = ? FOR UPDATE',
      [kodeDeposit, userId]
    );
    if (!row) throw new Error('Deposit tidak ditemukan.');
    if (row.status === 'success') {
      throw new Error('Deposit sudah dibayar, tidak bisa dibatalkan.');
    }
    if (row.status === 'cancel' || row.status === 'expired') return row; // sudah final

    const claim = await tx.run(
      `UPDATE deposits SET status = 'cancel', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status NOT IN ('success','cancel','expired')`,
      [row.id]
    );
    if (claim.affectedRows === 0) {
      throw new Error('Deposit sudah berubah status, coba muat ulang.');
    }
    return row;
  });

  const resp = await callQris({ action: 'cancel-deposit', kode_deposit: kodeDeposit });

  await db.run(
    `UPDATE deposits SET raw_response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(resp).slice(0, 4000), dep.id]
  );

  return { kode_deposit: kodeDeposit, status: 'cancel' };
}

export async function listDeposits(userId: number, limit = 20): Promise<DepositRow[]> {
  return db.all<DepositRow>('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?', [
    userId,
    limit,
  ]);
}
