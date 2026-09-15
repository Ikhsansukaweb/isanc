'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import {
  BalanceTx, BotPlan, DepositRow, CreatedDepositResult,
  getSaldo, createDeposit, checkDeposit, cancelDeposit,
} from '../../../lib/api';
import {
  IconWallet, IconPlus, IconRefresh, IconTrash, IconArrowRight, IconInfo,
} from '../../../components/icons';

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

const DEPOSIT_STATUS: Record<string, string> = {
  pending: 'bg-peach text-sienna',
  success: 'bg-[#55db9c]/20 text-[#2aa76c]',
  cancel: 'bg-mist text-slate',
  expired: 'bg-mist text-slate',
};

export default function SaldoPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<BalanceTx[]>([]);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [plans, setPlans] = useState<BotPlan[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('10000');
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<CreatedDepositResult | null>(null);
  const [polling, setPolling] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getSaldo();
      setBalance(s.balance);
      setHistory(s.history);
      setDeposits(s.deposits);
      setPlans(s.plans);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard/saldo');
  }, [loading, user, router]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Auto-poll status deposit yang aktif
  useEffect(() => {
    if (!active || active.status !== 'pending') return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await checkDeposit(active.kode_deposit);
        if (s.credited > 0) {
          await load();
          await refreshUser();
          setActive({ ...active, status: 'success' });
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (s.status !== 'pending') {
          await load();
          setActive({ ...active, status: s.status });
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* coba lagi */
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [active, load, refreshUser]);

  const doCreate = async () => {
    const n = Number(amount.replace(/\D/g, ''));
    if (!n || n < 1000) {
      setError('Nominal minimal Rp1.000.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const dep = await createDeposit(n);
      setActive(dep);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const checkNow = async () => {
    if (!active) return;
    setPolling(true);
    try {
      const s = await checkDeposit(active.kode_deposit);
      if (s.credited > 0 || s.status !== 'pending') {
        await load();
        await refreshUser();
        setActive({ ...active, status: s.credited > 0 ? 'success' : s.status });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPolling(false);
    }
  };

  const doCancel = async (kode: string) => {
    try {
      await cancelDeposit(kode);
      setActive(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading || !user) {
    return <p className="py-20 text-center text-sm text-slate">Memuat saldo...</p>;
  }

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight text-ink">
          <IconWallet size={22} /> Saldo
        </h1>
        <p className="mt-1 text-sm text-slate">Isi saldo lewat QRIS, lalu pakai untuk sewa bot.</p>
      </div>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      {/* Saldo + deposit */}
      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-card bg-ink p-6 text-paper">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#a3a6af]">
            <IconWallet size={14} /> Saldo Saat Ini
          </p>
          <p className="mt-3 font-mono text-3xl font-medium">{rupiah(balance)}</p>

          <div className="mt-5 space-y-2 border-t border-paper/15 pt-4 text-xs text-[#a3a6af]">
            <p className="font-medium uppercase tracking-wide text-paper/70">Harga sewa</p>
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span>{p.label} · {p.days} hari</span>
                <span className="font-mono text-paper">{rupiah(p.price)}</span>
              </div>
            ))}
            {plans.length === 0 && <p className="text-paper/50">Memuat harga...</p>}
          </div>
        </div>

        {/* Form deposit */}
        <div className="rounded-card bg-paper p-6 shadow-sm lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <IconPlus size={15} /> Deposit via QRIS
          </h2>
          <p className="mt-1 text-xs text-slate">
            Biaya admin &amp; kode unik ditanggung kamu (pembayar), jadi saldo yang masuk sesuai nominal.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {[10000, 20000, 50000, 100000].map((v) => (
              <button
                key={v}
                className={`rounded-pill px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  Number(amount) === v ? 'bg-ink text-paper' : 'bg-mist text-ink hover:bg-smoke/30'
                }`}
                onClick={() => setAmount(String(v))}
              >
                {rupiah(v)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              className="input-composer py-2.5 font-mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              placeholder="10000"
              inputMode="numeric"
            />
            <button className="btn-filled shrink-0 px-5 py-2.5 text-sm" onClick={doCreate} disabled={creating}>
              {creating ? 'Membuat...' : 'Buat QRIS'}
            </button>
          </div>

          {active && (
            <div className="mt-5 rounded-input bg-fog p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate">Kode deposit</p>
                  <p className="font-mono text-sm font-medium text-ink">{active.kode_deposit}</p>
                </div>
                <span className={`rounded-pill px-2.5 py-1 text-[11px] ${DEPOSIT_STATUS[active.status] ?? 'bg-mist text-slate'}`}>
                  {active.status}
                </span>
              </div>

              {active.status === 'pending' && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
                  {active.qr_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={active.qr_url}
                      alt="QRIS"
                      className="h-48 w-48 rounded-input border border-mist bg-paper object-contain"
                    />
                  ) : (
                    <div className="grid h-48 w-48 place-items-center rounded-input bg-mist text-xs text-slate">
                      QR tidak tersedia
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate">Nominal</span>
                      <span className="font-mono text-ink">{rupiah(active.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate">Biaya + kode unik</span>
                      <span className="font-mono text-ink">{rupiah(active.fee)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-mist pt-2 text-sm font-medium">
                      <span className="text-ink">Total bayar</span>
                      <span className="font-mono text-sienna">{rupiah(active.total_bayar)}</span>
                    </div>
                    <p className="text-[11px] text-ash">Saldo masuk: {rupiah(active.saldo_didapat)}</p>
                    {active.expired_at && <p className="text-[11px] text-ash">Kadaluarsa: {active.expired_at}</p>}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {active.pay_url && (
                        <a href={active.pay_url} target="_blank" rel="noreferrer" className="btn-filled px-4 py-2 text-xs">
                          Buka Halaman Bayar <IconArrowRight size={13} />
                        </a>
                      )}
                      <button className="btn-ghost px-3 py-2 text-xs" onClick={checkNow} disabled={polling}>
                        <IconRefresh size={13} /> {polling ? 'Cek...' : 'Cek Status'}
                      </button>
                      <button
                        className="btn-ghost border-red-300 px-3 py-2 text-xs text-red-500"
                        onClick={() => doCancel(active.kode_deposit)}
                      >
                        <IconTrash size={13} /> Batal
                      </button>
                    </div>
                    <p className="text-[11px] text-ash">Status dicek otomatis tiap 4 detik.</p>
                  </div>
                </div>
              )}

              {active.status === 'success' && (
                <div className="mt-3 rounded-input bg-[#55db9c]/15 p-3">
                  <p className="text-sm text-[#2aa76c]">Pembayaran berhasil — saldo sudah ditambahkan.</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-input bg-mist p-3">
            <IconInfo size={14} className="mt-0.5 shrink-0 text-ash" />
            <p className="text-xs text-slate">
              Pembayaran lewat aplikasi bank / e-wallet apa pun yang mendukung QRIS. Setelah bayar,
              saldo masuk otomatis (biasanya &lt; 1 menit).
            </p>
          </div>
        </div>
      </section>

      {/* Riwayat */}
      <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-paper p-6 shadow-sm">
          <h2 className="text-sm font-medium text-ink">Riwayat Saldo</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Belum ada transaksi.</p>
          ) : (
            /* Scroll internal — riwayat panjang tidak memanjangkan halaman. */
            <div className="scroll-area mt-3 max-h-[19rem] divide-y divide-mist pr-1">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{h.description ?? h.type}</p>
                    <p className="text-[11px] text-ash">{h.created_at}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className={`font-mono text-sm ${h.amount >= 0 ? 'text-[#2aa76c]' : 'text-sienna'}`}>
                      {h.amount >= 0 ? '+' : ''}{rupiah(h.amount)}
                    </p>
                    <p className="text-[11px] text-ash">{rupiah(h.balance_after)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card bg-paper p-6 shadow-sm">
          <h2 className="text-sm font-medium text-ink">Deposit Terakhir</h2>
          {deposits.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Belum ada deposit.</p>
          ) : (
            /* Scroll internal — daftar deposit panjang tidak memanjangkan halaman. */
            <div className="scroll-area mt-3 max-h-[19rem] divide-y divide-mist pr-1">
              {deposits.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-ink">{d.kode_deposit}</p>
                    <p className="text-[11px] text-ash">{d.created_at}</p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm text-ink">
                      {rupiah(d.total_bayar ?? d.amount)}
                    </span>
                    <span className={`rounded-pill px-2 py-0.5 text-[11px] ${DEPOSIT_STATUS[d.status] ?? 'bg-mist text-slate'}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
