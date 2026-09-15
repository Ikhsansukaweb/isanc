'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import {
  BotState, UserBot, BotPlan,
  getUserBots, getSaldo, rentBot, connectUserBot, disconnectUserBot,
} from '../../../lib/api';
import {
  IconPlus, IconBot, IconArrowRight, IconPlay, IconExit, IconGear,
  IconHeart, IconUsers, IconPin, IconClock, IconWallet, IconInfo,
} from '../../../components/icons';

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

const STATUS_COLOR: Record<string, string> = {
  spawned: 'bg-[#55db9c]/20 text-[#2aa76c]',
  awaiting_auth: 'bg-peach text-sienna',
  connecting: 'bg-blue-100 text-blue-600',
  kicked: 'bg-[#fdd] text-red-500',
  error: 'bg-[#fdd] text-red-500',
};

/** Dipakai sebelum harga dari server termuat — harus sama dengan src/lib/plans.ts */
const FALLBACK_PLANS: BotPlan[] = [
  { id: 'harian', label: 'Harian', days: 1, price: 3000 },
  { id: 'mingguan', label: 'Mingguan', days: 7, price: 17500 },
  { id: 'bulanan', label: 'Bulanan', days: 30, price: 20000 },
];

function fmtUptime(s: number): string {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function fmtRemaining(ms: number | null): string {
  if (ms == null) return 'belum aktif';
  if (ms <= 0) return 'habis';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d} hari ${h} jam` : `${h} jam`;
}

/**
 * Halaman daftar bot.
 *
 * Ini rumah tab "Bot" di bar bawah mobile. Isinya: tombol tambah bot di atas,
 * ringkasan singkat, lalu daftar semua bot milik user dengan aksi cepat
 * (sewa, jalankan, hentikan) dan tautan ke halaman detail.
 */
export default function BotsPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [bots, setBots] = useState<UserBot[]>([]);
  const [plans, setPlans] = useState<BotPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await getUserBots();
      setBots(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard/bots');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    refresh();
    // Harga paket ikut dari /api/account/saldo supaya tidak perlu endpoint baru.
    getSaldo().then((s) => setPlans(s.plans)).catch(() => { /* pakai FALLBACK_PLANS */ });
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [user, refresh]);

  /** Semua aksi bot mengembalikan data (UserBot/BotState), jadi tipe dibiarkan longgar. */
  const act = async (label: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(okMsg);
      await refresh();
      await refreshUser();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doRent = (label: string, plan: string) =>
    act(label, () => rentBot(label, plan), `${label} berhasil disewa.`);

  const doConnect = (label: string) =>
    act(label, async () => { await connectUserBot(label); }, `${label} sedang dinyalakan.`);

  const doDisconnect = (label: string) =>
    act(label, async () => { await disconnectUserBot(label); }, `${label} dimatikan.`);

  if (loading || !user) {
    return <p className="py-20 text-center text-sm text-slate">Memuat...</p>;
  }

  const running = bots.filter((b) => b.live?.status === 'spawned').length;
  const activePlans = plans.length ? plans : FALLBACK_PLANS;

  return (
    <>
      {/* ===== Judul + tombol tambah bot ===== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight text-ink">
            <IconBot size={22} /> Bot Saya
          </h1>
          <p className="mt-1 text-sm text-slate">
            {bots.length === 0
              ? 'Belum ada bot. Tambahkan satu untuk mulai.'
              : `${bots.length} terdaftar · ${running} jalan`}
          </p>
        </div>
        <Link href="/dashboard/add" className="btn-filled px-4 py-2.5 text-sm">
          <IconPlus size={15} /> Tambah Bot
        </Link>
      </div>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-input bg-[#55db9c]/15 p-3 text-sm text-[#2aa76c]">{notice}</p>}

      {/* ===== Saldo ringkas (perlu untuk menyewa) ===== */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-paper p-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-input bg-mist text-slate">
            <IconWallet size={16} />
          </span>
          <div>
            <p className="text-xs text-slate">Saldo kamu</p>
            <p className="font-mono text-sm font-medium text-ink">{rupiah(user.balance)}</p>
          </div>
        </div>
        <Link href="/dashboard/saldo" className="btn-ghost px-3.5 py-2 text-xs">
          Isi Saldo <IconArrowRight size={12} />
        </Link>
      </div>

      {/* ===== Kosong ===== */}
      {bots.length === 0 ? (
        <div className="mt-5 grid place-items-center rounded-card border border-dashed border-smoke/50 bg-paper py-20 text-center">
          <IconBot className="text-smoke" size={40} strokeWidth={1.2} />
          <p className="mt-3 text-sm text-slate">Belum ada bot.</p>
          <p className="mt-1 text-xs text-ash">Bot pertama kamu akan bernama bot1#{user.tag}</p>
          <Link href="/dashboard/add" className="btn-filled mt-4 px-4 py-2 text-sm">
            <IconPlus size={15} /> Tambah Bot Pertama
          </Link>
        </div>
      ) : (
        /* ===== Daftar bot ===== */
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => {
            const l = bot.live;
            const spawned = l?.status === 'spawned';
            const notRented = bot.expires_at == null;
            const expired = bot.expired;
            const label = bot.label;
            const isBusy = busy === label;

            return (
              <section key={label} className="flex flex-col rounded-card bg-paper p-4 shadow-sm">
                {/* Identitas bot */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-input ${spawned ? 'bg-[#55db9c]/15 text-[#2aa76c]' : 'bg-mist text-slate'}`}>
                      <IconBot size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium text-ink">{label}</p>
                      <p className="truncate text-xs text-slate">
                        {bot.host}:{bot.port}{bot.version ? ` · v${bot.version}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] ${l ? (STATUS_COLOR[l.status] ?? 'bg-mist text-slate') : notRented || expired ? 'bg-mist text-slate' : 'bg-blue-100 text-blue-600'}`}>
                    {l?.status ?? (notRented ? 'nonaktif' : expired ? 'habis' : 'siap')}
                  </span>
                </div>

                {/* Masa sewa + paket */}
                <div className={`mt-3 rounded-input p-3 ${notRented || expired ? 'bg-peach' : 'bg-fog'}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={notRented || expired ? 'font-medium text-sienna' : 'text-slate'}>Masa aktif</span>
                    <span className={`font-mono ${notRented || expired ? 'text-sienna' : 'text-ink'}`}>
                      {notRented ? 'belum disewa' : expired ? 'habis' : fmtRemaining(bot.remainingMs)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activePlans.map((p) => {
                      const affordable = user.balance >= p.price;
                      return (
                        <button
                          key={p.id}
                          className={`rounded-pill bg-paper px-2.5 py-1 text-[11px] font-medium text-ink shadow-sm transition-colors hover:bg-mist disabled:cursor-not-allowed disabled:opacity-50`}
                          onClick={() => doRent(label, p.id)}
                          disabled={isBusy || !affordable}
                          title={affordable ? `Sewa ${p.label}` : `Kurang ${rupiah(p.price - user.balance)}`}
                        >
                          {notRented || expired ? '' : '+ '}{p.label} · {rupiah(p.price)}
                        </button>
                      );
                    })}
                  </div>
                  {user.balance <= 0 && notRented && (
                    <Link href="/dashboard/saldo" className="btn-filled mt-2.5 w-full py-2 text-xs">
                      <IconWallet size={13} /> Isi Saldo QRIS
                    </Link>
                  )}
                </div>

                {l?.lastError && (
                  <p className="mt-3 rounded-input bg-[#fdd] p-2.5 text-xs text-red-500">{l.lastError}</p>
                )}

                {/* Statistik singkat */}
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-input bg-mist p-2">
                    <IconHeart className="mx-auto text-ash" size={13} />
                    <p className="mt-1 truncate text-xs font-medium text-ink">{l && l.health > 0 ? Math.round(l.health) : '—'}</p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconUsers className="mx-auto text-ash" size={13} />
                    <p className="mt-1 text-xs font-medium text-ink">{l?.playersOnline ?? 0}</p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconPin className="mx-auto text-ash" size={13} />
                    <p className="mt-1 truncate font-mono text-[10px] text-ink">
                      {l?.position ? `${Math.round(l.position.x)}, ${Math.round(l.position.z)}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconClock className="mx-auto text-ash" size={13} />
                    <p className="mt-1 text-xs font-medium text-ink">{fmtUptime(l?.uptimeSeconds ?? 0)}</p>
                  </div>
                </div>

                {/* Aksi */}
                <div className="mt-auto flex gap-2 pt-4">
                  <Link
                    href={`/dashboard/${encodeURIComponent(label)}`}
                    className="btn-ghost flex flex-1 items-center justify-center py-2.5 text-sm"
                  >
                    <IconGear size={15} /> Detail
                  </Link>
                  {spawned ? (
                    <button
                      className="btn-ghost shrink-0 border-red-300 px-3.5 py-2.5 text-sm text-red-500"
                      onClick={() => doDisconnect(label)}
                      disabled={isBusy}
                      title="Matikan bot"
                    >
                      <IconExit size={16} />
                    </button>
                  ) : (
                    <button
                      className="btn-filled flex-1 py-2.5 text-sm"
                      onClick={() => doConnect(label)}
                      disabled={isBusy || notRented || expired}
                      title={notRented || expired ? 'Sewa dulu pakai saldo' : 'Jalankan bot'}
                    >
                      <IconPlay size={14} /> {isBusy ? '...' : 'Jalankan'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ===== Petunjuk singkat ===== */}
      <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <IconInfo size={15} /> Cara pakai
        </h2>
        <ol className="mt-3 space-y-2 text-xs text-slate">
          <li>
            <span className="font-medium text-ink">1 · Tambah bot</span> — isi nama, host server, port, dan versi
            Minecraft. Nama otomatis diberi hashtag akunmu ({`bot1#${user.tag}`}) supaya tidak bentrok.
          </li>
          <li>
            <span className="font-medium text-ink">2 · Sewa pakai saldo</span> — pilih paket (harian/mingguan/bulanan)
            pada kartu bot. Tanpa masa sewa aktif, bot belum bisa dijalankan.
          </li>
          <li>
            <span className="font-medium text-ink">3 · Jalankan</span> — bot masuk ke server, lalu buka{' '}
            <span className="font-medium text-ink">Detail</span> untuk kontrol gerak, chat in-game, inventory, dan mode AFK.
          </li>
        </ol>
      </section>
    </>
  );
}
