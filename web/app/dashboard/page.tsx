'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import {
  BotState, ServerStats, UserBot, BotPlan,
  getUserBots, getStats, rentBot, connectUserBot, disconnectUserBot, deleteUserBot,
} from '../../lib/api';
import {
  IconPlus, IconExit, IconHeart, IconUsers, IconPin, IconClock, IconBot, IconArrowRight,
  IconServer, IconWallet, IconTrash, IconPlay, IconInfo, IconGear, IconChat,
} from '../../components/icons';
import { useRealtime } from '../../lib/realtime';
import { LiveActivityCard, OnlineBadge } from '../../components/realtime';

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

export default function DashboardPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();

  const [bots, setBots] = useState<UserBot[]>([]);
  const [live, setLive] = useState<BotState[]>([]);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [plans, setPlans] = useState<BotPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Realtime: chat global + feed aktivitas (deposit & pesan bot).
  const { chat, online } = useRealtime();

  const refresh = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([getUserBots(), getStats()]);
      setBots(b);
      setStats(s);
      setLive(b.map((x) => x.live).filter(Boolean) as BotState[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [user, refresh]);

  // Ambil harga paket dari endpoint saldo (sekali)
  useEffect(() => {
    if (!user) return;
    import('../../lib/api').then(({ getSaldo }) => getSaldo().then((s) => setPlans(s.plans)).catch(() => {}));
  }, [user]);

  const doRent = async (label: string, plan: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const r = await rentBot(label, plan);
      setNotice(r.message ?? 'Masa sewa diperpanjang.');
      await refresh();
      await refreshUser();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      // Saldo kurang → arahkan langsung ke halaman Saldo
      const low = (e as Error & { status?: number }).status === 402 || /saldo kurang/i.test(msg);
      if (low) {
        setNotice(null);
        setError(`${msg} Buka halaman Saldo untuk deposit QRIS.`);
      }
    } finally {
      setBusy(null);
    }
  };

  const doConnect = async (label: string) => {
    setBusy(label);
    setError(null);
    try {
      await connectUserBot(label);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDisconnect = async (label: string) => {
    setBusy(label);
    try {
      await disconnectUserBot(label);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (label: string) => {
    setBusy(label);
    try {
      await deleteUserBot(label);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const running = bots.filter((b) => b.live && b.live.status === 'spawned').length;

  if (loading || !user) {
    return <p className="py-20 text-center text-sm text-slate">Memuat dashboard...</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-ink">
            Halo, {user.username}
            <span className="font-mono text-base text-sienna">#{user.tag}</span>
          </h1>
          <p className="mt-1 text-sm text-slate">Panel kontrol bot AFK Minecraft Bedrock.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/account" className="btn-ghost px-4 py-2 text-sm">
            <IconWallet size={15} /> {rupiah(user.balance)}
          </Link>
          <Link href="/dashboard/add" className="btn-filled px-4 py-2 text-sm">
            <IconPlus size={15} /> Tambah Bot
          </Link>
        </div>
      </div>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-input bg-[#55db9c]/15 p-3 text-sm text-[#2aa76c]">{notice}</p>}

      {/* ===== Info web + cara pakai ===== */}
      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-card bg-ink p-6 text-paper lg:col-span-2">
          <p className="text-xs uppercase tracking-wide text-[#a3a6af]">AFK BEDROCK PANEL</p>
          <h2 className="mt-2 text-xl font-medium">Bot AFK Minecraft, dikendalikan dari browser</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#a3a6af]">
            Connect bot ke server Bedrock, login Microsoft sekali, lalu kontrol gerak
            (maju/mundur/lompat), chat in-game, kelola inventory &amp; chest, dan aktifkan mode AFK.
            Semua paket dari server dijawab otomatis biar bot tetap online.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-input bg-paper/10 p-3.5">
              <p className="text-xs text-[#a3a6af]">1 · TAMBAH BOT</p>
              <p className="mt-1 text-sm">
                Isi nama, host, port, versi. Nama otomatis jadi{' '}
                <span className="font-mono text-paper">bot1#{user.tag}</span>.
              </p>
            </div>
            <div className="rounded-input bg-paper/10 p-3.5">
              <p className="text-xs text-[#a3a6af]">2 · ISI SALDO</p>
              <p className="mt-1 text-sm">Deposit QRIS, lalu sewa bot: harian {plans[0] ? rupiah(plans[0].price) : 'Rp3.000'}.</p>
            </div>
            <div className="rounded-input bg-paper/10 p-3.5">
              <p className="text-xs text-[#a3a6af]">3 · LOGIN &amp; KONTROL</p>
              <p className="mt-1 text-sm">Klik tombol login Microsoft (link + code jadi satu), lalu kelola bot.</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/add" className="btn-filled bg-paper px-4 py-2 text-sm text-ink">
              <IconPlus size={14} /> Mulai
            </Link>
            <Link href="/dashboard/add" className="btn-ghost border-paper/30 px-4 py-2 text-sm text-paper hover:bg-paper/10">
              <IconPlus size={14} /> Tambah Bot
            </Link>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-[#a3a6af]">
              <IconInfo size={12} /> Tag #{user.tag} mencegah bot bentrok antar akun
            </span>
          </div>
        </div>

        {/* ===== Server stats ===== */}
        <div className="rounded-card bg-paper p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <IconServer size={16} /> Performa Server
          </h2>
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate">RAM (RSS)</span>
                <span className="font-mono text-ink">{stats?.ram.rssMb ?? '—'} MB</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-pill bg-mist">
                <div
                  className="h-full rounded-pill bg-sienna transition-all"
                  style={{ width: `${Math.min(100, ((stats?.ram.rssMb ?? 0) / 1024) * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate">Heap Used</span>
                <span className="font-mono text-ink">{stats?.ram.heapUsedMb ?? '—'} MB</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-pill bg-mist">
                <div
                  className="h-full rounded-pill bg-ink transition-all"
                  style={{ width: `${Math.min(100, ((stats?.ram.heapUsedMb ?? 0) / 128) * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate">CPU</span>
                <span className="font-mono text-ink">{stats?.cpu ?? 0}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-pill bg-mist">
                <div
                  className="h-full rounded-pill transition-all"
                  style={{ width: `${Math.min(100, stats?.cpu ?? 0)}%`, background: (stats?.cpu ?? 0) > 70 ? '#e5484d' : '#55db9c' }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-mist pt-3 text-xs">
              <span className="text-slate">Uptime Server</span>
              <span className="font-mono text-ink">{fmtUptime(stats?.uptime ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate">Bot Jalan</span>
              <span className="font-mono text-ink">{running} / {bots.length}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Bot saya ===== */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">Bot Saya</h2>
        <span className="text-xs text-ash">{bots.length} terdaftar · {running} jalan</span>
      </div>

      {bots.length === 0 ? (
        <div className="mt-4 grid place-items-center rounded-card border border-dashed border-smoke/50 bg-paper py-20 text-center">
          <IconBot className="text-smoke" size={40} strokeWidth={1.2} />
          <p className="mt-3 text-sm text-slate">Belum ada bot.</p>
          <p className="mt-1 text-xs text-ash">Bot pertama kamu akan bernama bot1#{user.tag}</p>
          <Link href="/dashboard/add" className="btn-filled mt-4 px-4 py-2 text-sm">
            <IconPlus size={15} /> Tambah Bot Pertama
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => {
            const l = bot.live;
            const spawned = l?.status === 'spawned';
            const notRented = bot.expires_at == null;
            const expired = bot.expired;
            const label = bot.label;

            return (
              <section key={label} className="flex flex-col rounded-card bg-paper p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-input ${spawned ? 'bg-[#55db9c]/15 text-[#2aa76c]' : 'bg-mist text-slate'}`}>
                      <IconBot size={18} />
                    </span>
                    <div>
                      <p className="font-mono text-sm font-medium text-ink">{label}</p>
                      <p className="text-xs text-slate">
                        {bot.host}:{bot.port}{bot.version ? ` · v${bot.version}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className={`rounded-pill px-2 py-0.5 text-[11px] ${l ? (STATUS_COLOR[l.status] ?? 'bg-mist text-slate') : notRented || expired ? 'bg-mist text-slate' : 'bg-blue-100 text-blue-600'}`}>
                    {l?.status ?? (notRented ? 'nonaktif' : expired ? 'habis' : 'siap')}
                  </span>
                </div>

                {/* Masa sewa */}
                <div className={`mt-4 rounded-input p-3 ${notRented || expired ? 'bg-peach' : 'bg-fog'}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={notRented || expired ? 'font-medium text-sienna' : 'text-slate'}>Masa aktif</span>
                    <span className={`font-mono ${notRented || expired ? 'text-sienna' : 'text-ink'}`}>
                      {notRented ? 'belum disewa' : expired ? 'habis' : fmtRemaining(bot.remainingMs)}
                    </span>
                  </div>

                  {notRented || expired ? (
                    <>
                      <p className="mt-2 text-[11px] text-sienna/80">
                        Saldo kamu {rupiah(user.balance)} —{' '}
                        {user.balance <= 0
                          ? 'isi saldo dulu lewat QRIS untuk menyewa.'
                          : 'pilih paket di bawah untuk mengaktifkan.'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(plans.length ? plans : FALLBACK_PLANS).map((p) => {
                          const affordable = user.balance >= p.price;
                          return (
                            <button
                              key={p.id}
                              className={`rounded-pill px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                affordable ? 'bg-paper text-ink hover:bg-mist' : 'bg-paper/60 text-slate'
                              }`}
                              onClick={() => doRent(label, p.id)}
                              disabled={busy === label || !affordable}
                              title={affordable ? `Sewa ${p.label}` : `Kurang ${rupiah(p.price - user.balance)}`}
                            >
                              {p.label} · {rupiah(p.price)}
                            </button>
                          );
                        })}
                      </div>
                      {user.balance <= 0 && (
                        <Link href="/dashboard/saldo" className="btn-filled mt-2.5 w-full py-2 text-xs">
                          <IconWallet size={13} /> Isi Saldo QRIS
                        </Link>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(plans.length ? plans : FALLBACK_PLANS).map((p) => {
                        const affordable = user.balance >= p.price;
                        return (
                          <button
                            key={p.id}
                            className="rounded-pill bg-paper px-2.5 py-1 text-[11px] font-medium text-ink shadow-sm transition-colors hover:bg-mist disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => doRent(label, p.id)}
                            disabled={busy === label || !affordable}
                            title={affordable ? `Perpanjang ${p.label}` : `Saldo kurang ${rupiah(p.price - user.balance)}`}
                          >
                            + {p.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {l?.lastError && (
                  <p className="mt-3 rounded-input bg-[#fdd] p-2.5 text-xs text-red-500">{l.lastError}</p>
                )}

                <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-input bg-mist p-2">
                    <IconHeart className="mx-auto text-ash" size={14} />
                    <p className="mt-1 truncate text-xs font-medium text-ink">{l && l.health > 0 ? Math.round(l.health) : '—'}</p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconUsers className="mx-auto text-ash" size={14} />
                    <p className="mt-1 text-xs font-medium text-ink">{l?.playersOnline ?? 0}</p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconPin className="mx-auto text-ash" size={14} />
                    <p className="mt-1 truncate font-mono text-[10px] text-ink">
                      {l?.position ? `${Math.round(l.position.x)}, ${Math.round(l.position.z)}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-input bg-mist p-2">
                    <IconClock className="mx-auto text-ash" size={14} />
                    <p className="mt-1 text-xs font-medium text-ink">{fmtUptime(l?.uptimeSeconds ?? 0)}</p>
                  </div>
                </div>

                {l?.pingMs != null && (
                  <p className="mt-2 text-[11px] text-ash">
                    Latency: <span className={`font-mono ${l.pingMs < 150 ? 'text-[#2aa76c]' : 'text-sienna'}`}>{l.pingMs} ms</span>
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {/* Detail selalu tersedia — juga di mobile */}
                  <Link
                    href={`/dashboard/${encodeURIComponent(label)}`}
                    className={`btn-ghost flex-1 py-2.5 text-sm ${spawned ? 'hidden sm:flex' : ''}`}
                  >
                    <IconGear size={15} /> Detail
                  </Link>

                  {spawned ? (
                    <>
                      <Link href={`/dashboard/${encodeURIComponent(label)}`} className="btn-filled flex-1 py-2.5 text-sm">
                        Kelola Bot <IconArrowRight size={14} />
                      </Link>
                      <button
                        className="btn-ghost shrink-0 border-red-300 py-2.5 text-sm text-red-500"
                        onClick={() => doDisconnect(label)}
                        disabled={busy === label}
                        title="Matikan bot"
                      >
                        <IconExit size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn-filled flex-1 py-2.5 text-sm"
                        onClick={() => doConnect(label)}
                        disabled={busy === label || notRented || expired}
                        title={notRented || expired ? 'Sewa dulu pakai saldo' : 'Jalankan bot'}
                      >
                        <IconPlay size={14} /> {busy === label ? '...' : 'Jalankan'}
                      </button>
                      <button
                        className="btn-ghost shrink-0 border-red-300 py-2.5 text-sm text-red-500"
                        onClick={() => doDelete(label)}
                        disabled={busy === label}
                        title="Hapus bot"
                      >
                        <IconTrash size={15} />
                      </button>
                    </>
                  )}
                </div>
                {spawned && (
                  <Link
                    href={`/dashboard/${encodeURIComponent(label)}`}
                    className="btn-ghost mt-2 w-full py-2.5 text-sm sm:hidden"
                  >
                    <IconGear size={15} /> Detail Bot
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Sisa bot live yang tidak terdaftar (mis. dibuat lewat API lama) */}
      {live.filter((x) => !bots.some((b) => b.label === x.name)).length > 0 && (
        <>
          <h2 className="mt-8 text-base font-medium text-ink">Bot Live Lain</h2>
          <div className="mt-3 space-y-2">
            {live
              .filter((x) => !bots.some((b) => b.label === x.name))
              .map((x) => (
                <div key={x.name} className="flex items-center justify-between rounded-card bg-paper p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full ${x.status === 'spawned' ? 'bg-[#55db9c]' : 'bg-peach'}`} />
                    <span className="font-mono text-sm text-ink">{x.name}</span>
                    <span className="text-xs text-slate">{x.status}</span>
                  </div>
                  <Link href={`/dashboard/${encodeURIComponent(x.name)}`} className="btn-ghost px-3 py-1.5 text-xs">
                    Kelola <IconArrowRight size={12} />
                  </Link>
                </div>
              ))}
          </div>
        </>
      )}

      {/* Aktivitas langsung: deposit & pesan bot digabung satu aliran */}
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LiveActivityCard limit={20} maxHeight="17.5rem" />

        <section className="rounded-card bg-paper p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                <IconChat size={15} /> Global Chat
              </h2>
              <p className="mt-0.5 text-[11px] text-slate">Ngobrol realtime dengan pengguna lain</p>
            </div>
            <OnlineBadge online={online} />
          </div>

          <div className="scroll-area max-h-[240px] space-y-3 rounded-input bg-fog p-3.5">
            {chat.length === 0 && (
              <p className="py-8 text-center text-xs text-ash">Belum ada pesan.</p>
            )}
            {chat.slice(-20).map((m) => (
              <div key={m.id} className="text-xs">
                <span className="font-medium text-ink">{m.username}</span>
                <span className="text-smoke">#{m.tag}</span>
                <p className="mt-0.5 leading-snug text-slate">{m.body}</p>
              </div>
            ))}
          </div>

          <Link href="/dashboard/chat" className="btn-ghost mt-4 w-full justify-center py-2.5 text-sm">
            Buka Global Chat <IconArrowRight size={13} />
          </Link>
        </section>
      </div>
    </>
  );
}
