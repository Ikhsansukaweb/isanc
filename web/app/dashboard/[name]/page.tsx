'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  BotState, UserBot, AuthCode, getBot, getOwnedBot, getBotAuth, getUserBots, connectUserBot,
  updateUserBot, setMove, botJump, botTurn, botGoto, botGotoCancel, botAttack, botPlace, botUse,
  botHotbar, botAfk, disconnectBot,
} from '../../../lib/api';
import {
  IconUp, IconDown, IconLeft, IconRight, IconSneak, IconSwords, IconBox, IconHand,
  IconRotateL, IconRotateR, IconPlay, IconStop, IconExit, IconHeart, IconUsers, IconPin,
  IconClock, IconArrowUp, IconArrowDown, IconArrowLeft, IconArrowRight, IconLink, IconWallet, IconGear,
} from '../../../components/icons';

export default function BotControlPage() {
  const params = useParams<{ name: string }>();
  // Next.js mengembalikan segmen URL yang MASIH ter-encode (mis. "bot3%238064").
  // Decode dulu supaya label aslinya "bot3#8064" — kalau tidak, encode ulang
  // di lapisan API menghasilkan double-encode (%2523) → 404.
  const rawName = params?.name ?? '';
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    name = rawName;
  }
  const [bot, setBot] = useState<BotState | null>(null);
  const [owned, setOwned] = useState<UserBot | null>(null);
  const [authCode, setAuthCode] = useState<AuthCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goto, setGoto] = useState('');
  const [moveKeys, setMoveKeys] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      // Satu panggilan: kepemilikan + status live + device code Microsoft.
      const info = await getOwnedBot(name);
      setOwned(info);
      setBot(info.live ?? null);
      setAuthCode(info.live?.msaCode ?? null);

      // Fallback: kalau live belum membawa msaCode (timing), cek endpoint auth.
      if (!info.live?.msaCode && (info.live?.status === 'awaiting_auth' || info.live?.status === 'connecting')) {
        try {
          const a = await getBotAuth(name);
          setAuthCode(a.authCode);
        } catch {
          /* abaikan */
        }
      }

      setError(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(err.status === 404 ? `Bot '${name}' tidak terdaftar di akunmu.` : err.message);
    }
  }, [name]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pressMove = (dir: string, active: boolean) => {
    setMoveKeys((prev) => ({ ...prev, [dir]: active }));
    act(() => setMove(name, dir, active));
  };

  const spawned = bot?.status === 'spawned';
  const selected = bot?.selectedHotbarSlot ?? 0;
  const pos = bot?.position;
  const notRented = owned != null && (owned.expires_at == null || owned.expired);
  const canRun = owned != null && !notRented;
  const liveStatus = bot?.status ?? (notRented ? 'belum disewa' : 'berhenti');

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-ink">{name}</h1>
      <p className="mt-0.5 text-sm text-slate">
        {owned ? `${owned.host}:${owned.port}${owned.version ? ` · v${owned.version}` : ''}` : '—'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-pill px-3 py-1 text-xs ${spawned ? 'bg-[#55db9c]/20 text-[#2aa76c]' : notRented ? 'bg-peach text-sienna' : 'bg-mist text-slate'}`}>
          {liveStatus}
        </span>

        {!spawned && canRun && (
          <button
            className="btn-filled px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await connectUserBot(name);
                if (r.msaCode) setAuthCode(r.msaCode);
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <IconPlay size={14} /> {busy ? 'Menjalankan...' : 'Jalankan Bot'}
          </button>
        )}

        {notRented && (
          <Link href="/dashboard/saldo" className="btn-filled px-3 py-1.5 text-xs">
            <IconWallet size={14} /> Sewa / Isi Saldo
          </Link>
        )}

        {spawned && (
          <button
            className="btn-ghost border-red-300 px-3 py-1.5 text-xs text-red-500"
            onClick={async () => { await act(() => disconnectBot(name)); await refresh(); }}
          >
            <IconExit size={14} /> Putuskan
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      {/* Pengaturan server — penting kalau versi kosong (bot tidak bisa jalan) */}
      {owned && (
        <BotSettings
          owned={owned}
          busy={busy}
          onSaved={async () => { await refresh(); }}
        />
      )}
      {bot?.lastError && (
        <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{bot.lastError}</p>
      )}

      {/* Bar koordinat live ala isanc */}
      {spawned && pos && (
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-card bg-paper p-3 text-center shadow-sm">
          <div>
            <span className="block font-mono text-base font-medium text-ink">{pos.x.toFixed(1)}</span>
            <span className="text-[10px] text-ash">X</span>
          </div>
          <div>
            <span className="block font-mono text-base font-medium text-ink">{pos.y.toFixed(1)}</span>
            <span className="text-[10px] text-ash">Y</span>
          </div>
          <div>
            <span className="block font-mono text-base font-medium text-ink">{pos.z.toFixed(1)}</span>
            <span className="text-[10px] text-ash">Z</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <section className="mt-5 rounded-card bg-paper p-5 shadow-sm">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ash">Status</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-input bg-mist p-3">
            <IconHeart className="text-ash" size={14} />
            <p className="mt-1 text-sm font-medium text-ink">{bot && bot.health > 0 ? Math.round(bot.health) : '—'}</p>
          </div>
          <div className="rounded-input bg-mist p-3">
            <IconUsers className="text-ash" size={14} />
            <p className="mt-1 text-sm font-medium text-ink">{bot?.playersOnline ?? 0}</p>
          </div>
          <div className="rounded-input bg-mist p-3">
            <IconPin className="text-ash" size={14} />
            <p className="mt-1 font-mono text-[11px] text-ink">
              {pos ? `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}` : '—'}
            </p>
          </div>
          <div className="rounded-input bg-mist p-3">
            <IconClock className="text-ash" size={14} />
            <p className="mt-1 text-sm font-medium text-ink">
              {bot?.uptimeSeconds ? `${Math.floor(bot.uptimeSeconds / 60)}m ${bot.uptimeSeconds % 60}s` : '—'}
            </p>
          </div>
        </div>
      </section>

      {/* Auth 1-klik — tampil selama bot menunggu login Microsoft */}
      {authCode && bot?.status !== 'spawned' && (
        <AuthPanel auth={authCode} />
      )}

      {/* Gerak + aksi — ala isanc */}
      {spawned && (
        <>
          <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ash">Gerakin Bot</h2>

            <div className="mt-4 grid grid-cols-1 items-center gap-6 sm:grid-cols-2">
              {/* D-pad 3x3 gaya isanc — Lompat di tengah */}
              <div className="mx-auto grid grid-cols-3 gap-1.5">
                <div />
                <MoveBtn active={moveKeys.forward} onDown={() => pressMove('forward', true)} onUp={() => pressMove('forward', false)} title="Maju"><IconArrowUp size={18} /></MoveBtn>
                <div />
                <MoveBtn active={moveKeys.left} onDown={() => pressMove('left', true)} onUp={() => pressMove('left', false)} title="Kiri"><IconArrowLeft size={18} /></MoveBtn>
                <button
                  className="grid h-12 w-12 place-items-center rounded-input bg-sienna text-paper select-none transition-transform active:scale-90"
                  title="Lompat"
                  onClick={() => act(() => botJump(name))}
                >
                  <IconUp size={18} />
                </button>
                <MoveBtn active={moveKeys.right} onDown={() => pressMove('right', true)} onUp={() => pressMove('right', false)} title="Kanan"><IconArrowRight size={18} /></MoveBtn>
                <div />
                <MoveBtn active={moveKeys.back} onDown={() => pressMove('back', true)} onUp={() => pressMove('back', false)} title="Mundur"><IconArrowDown size={18} /></MoveBtn>
                <MoveBtn active={moveKeys.sneak} onDown={() => pressMove('sneak', true)} onUp={() => pressMove('sneak', false)} title="Sneak"><IconSneak size={18} /></MoveBtn>
              </div>

              {/* Look grid + tombol aksi */}
              <div className="flex flex-col items-center gap-4">
                <div className="grid grid-cols-3 gap-1.5">
                  <div />
                  <MoveBtn active={false} onDown={() => act(() => botTurn(name, 0, -20))} onUp={() => {}} title="Lihat atas"><IconArrowUp size={14} /></MoveBtn>
                  <div />
                  <MoveBtn active={false} onDown={() => act(() => botTurn(name, 30, 0))} onUp={() => {}} title="Lihat kiri"><IconRotateL size={14} /></MoveBtn>
                  <MoveBtn active={false} onDown={() => act(() => botTurn(name, 0, 20))} onUp={() => {}} title="Lihat bawah"><IconArrowDown size={14} /></MoveBtn>
                  <MoveBtn active={false} onDown={() => act(() => botTurn(name, -30, 0))} onUp={() => {}} title="Lihat kanan"><IconRotateR size={14} /></MoveBtn>
                </div>
                <div className="flex gap-2">
                  <button
                    className="grid h-14 w-14 place-items-center rounded-full bg-sienna text-[10px] font-bold text-paper select-none transition-transform active:scale-90"
                    onClick={() => act(() => botAttack(name))}
                  >
                    <IconSwords size={16} />
                    PUKUL
                  </button>
                  <button
                    className="grid h-14 w-14 place-items-center rounded-full bg-mist text-[10px] font-bold text-ink select-none transition-transform active:scale-90"
                    onClick={() => act(() => botPlace(name))}
                  >
                    <IconBox size={16} />
                    TARUH
                  </button>
                  <button
                    className="grid h-14 w-14 place-items-center rounded-full bg-ink text-[9px] font-bold text-paper select-none transition-transform active:scale-90"
                    onClick={() => act(() => botUse(name))}
                  >
                    <IconHand size={15} />
                    KLIK KANAN
                  </button>
                </div>
              </div>
            </div>

            {/* AFK + otopilot (goto X/Y/Z) */}
            <div className="mt-5 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-slate">
                AFK
                <button
                  className={`relative h-5 w-9 rounded-pill transition-colors ${bot.afk ? 'bg-sienna' : 'bg-smoke/40'}`}
                  onClick={() => act(() => botAfk(name, !bot.afk))}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-all ${bot.afk ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </label>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ash">Pindah ke Koordinat</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="input-composer px-2 py-2 text-center font-mono text-xs"
                  placeholder="X"
                  value={goto.split(/\s+/)[0] ?? ''}
                  onChange={(e) => {
                    const parts = goto.split(/\s+/);
                    parts[0] = e.target.value;
                    setGoto(parts.join(' ').trim());
                  }}
                />
                <input
                  className="input-composer px-2 py-2 text-center font-mono text-xs"
                  placeholder="Y (opsional)"
                  value={goto.split(/\s+/)[1] ?? ''}
                  onChange={(e) => {
                    const parts = goto.split(/\s+/);
                    parts[1] = e.target.value;
                    setGoto(parts.join(' ').trim());
                  }}
                />
                <input
                  className="input-composer px-2 py-2 text-center font-mono text-xs"
                  placeholder="Z"
                  value={goto.split(/\s+/)[2] ?? ''}
                  onChange={(e) => {
                    const parts = goto.split(/\s+/);
                    parts[2] = e.target.value;
                    setGoto(parts.join(' ').trim());
                  }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-filled flex-1 py-2 text-sm"
                  onClick={() => {
                    const [x, y, z] = goto.split(/\s+/).map(Number);
                    if (!Number.isNaN(x) && !Number.isNaN(z)) act(() => botGoto(name, x, y, z));
                  }}
                >
                  <IconPlay size={14} /> Jalan Otomatis
                </button>
                <button className="btn-ghost px-4 py-2 text-sm" onClick={() => act(() => botGotoCancel(name))}>
                  <IconStop size={14} /> Batal
                </button>
              </div>
            </div>
          </section>

          {/* Hotbar */}
          <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ash">Hotbar (slot {selected + 1})</h2>
            <div className="mt-3 grid grid-cols-9 gap-1.5">
              {Array.from({ length: 9 }, (_, i) => {
                const item = bot.inventory?.[i];
                return (
                  <button
                    key={i}
                    onClick={() => act(() => botHotbar(name, i))}
                    title={`Slot ${i + 1}${item ? `: ${item.name}` : ''}`}
                    className={`relative aspect-square rounded-input text-[10px] font-medium transition-colors ${
                      selected === i ? 'bg-ink text-paper' : 'bg-mist text-ink hover:bg-smoke/30'
                    }`}
                  >
                    {item ? (
                      <>
                        <span className="block truncate px-1 pt-1">{item.name.slice(0, 6)}</span>
                        <span className="absolute bottom-0.5 right-1">{item.count}</span>
                      </>
                    ) : (
                      <span className="opacity-30">·</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      {!spawned && (
        <p className="mt-8 rounded-card bg-paper p-6 text-center text-sm text-slate">
          {notRented
            ? 'Bot belum disewa. Aktifkan masa sewa dulu di halaman Saldo.'
            : 'Bot belum berjalan. Klik "Jalankan Bot" di atas — kalau butuh login Microsoft, kode akan muncul di sini.'}
        </p>
      )}
    </>
  );
}

/** Tombol tahan-lepas (pointer) untuk gerak/look */
function MoveBtn({
  active, onDown, onUp, title, children,
}: {
  active: boolean; onDown: () => void; onUp: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      className={`grid h-12 w-12 place-items-center rounded-input select-none transition-colors ${
        active ? 'bg-ink text-paper' : 'bg-mist text-ink hover:bg-smoke/30'
      }`}
      onPointerDown={(e) => { e.preventDefault(); onDown(); }}
      onPointerUp={() => onUp()}
      onPointerLeave={() => onUp()}
    >
      {children}
    </button>
  );
}

/** Link login Microsoft langsung dengan code — tanpa buka microsoft.com/link dulu */
function remoteConnectLink(userCode: string): string {
  return `https://login.live.com/oauth20_remoteconnect.srf?otc=${encodeURIComponent(userCode)}`;
}

/** Pengaturan server bot — host, port, versi. Versi wajib agar bot bisa jalan. */
function BotSettings({ owned, busy, onSaved }: { owned: UserBot; busy: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(owned.version == null);
  const [host, setHost] = useState(owned.host);
  const [port, setPort] = useState(String(owned.port));
  const [version, setVersion] = useState(owned.version ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const missingVersion = !owned.version;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await updateUserBot(owned.label, {
        host: host.trim(),
        port: Number(port) || 19132,
        version: version.trim(),
      });
      setMsg(r.message ?? 'Disimpan.');
      setOpen(false);
      await onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-input bg-fog px-4 py-3">
        <p className="text-xs text-slate">
          <span className="font-mono text-ink">{owned.host}:{owned.port}</span>
          {owned.version ? <span className="ml-2 font-mono text-ink">v{owned.version}</span> : (
            <span className="ml-2 font-medium text-sienna">versi belum diisi</span>
          )}
        </p>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(true)} disabled={busy}>
          <IconGear size={13} /> Pengaturan
        </button>
      </div>
    );
  }

  return (
    <section className={`mt-4 rounded-card p-5 ${missingVersion ? 'bg-peach' : 'bg-paper shadow-sm'}`}>
      <h2 className={`flex items-center gap-2 text-sm font-medium ${missingVersion ? 'text-sienna' : 'text-ink'}`}>
        <IconGear size={15} /> Pengaturan Server
      </h2>
      {missingVersion && (
        <p className="mt-1 text-xs text-sienna/80">
          Versi Minecraft belum diisi — bot tidak bisa dijalankan tanpa versi.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={`text-xs font-medium ${missingVersion ? 'text-sienna' : 'text-slate'}`}>Server (Host/IP)</label>
          <input className="input-composer mt-1 py-2.5" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div>
          <label className={`text-xs font-medium ${missingVersion ? 'text-sienna' : 'text-slate'}`}>Port</label>
          <input
            className="input-composer mt-1 py-2.5 font-mono"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </div>
        <div className="sm:col-span-3">
          <label className={`text-xs font-medium ${missingVersion ? 'text-sienna' : 'text-slate'}`}>
            Versi Minecraft
          </label>
          <input
            className="input-composer mt-1 py-2.5 font-mono"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.26.30"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['1.26.30', '1.21.130', '1.21.100', '1.21.93'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVersion(v)}
                className={`rounded-pill px-3 py-1 font-mono text-[11px] transition-colors ${
                  version === v ? 'bg-ink text-paper' : 'bg-mist text-slate hover:bg-smoke/30 hover:text-ink'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {msg && <p className="mt-3 rounded-input bg-mist p-2.5 text-xs text-ink">{msg}</p>}

      <div className="mt-4 flex gap-2">
        <button className="btn-filled px-4 py-2 text-xs" onClick={save} disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        {!missingVersion && (
          <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setOpen(false)}>
            Tutup
          </button>
        )}
      </div>
    </section>
  );
}

/** Panel login Microsoft — link + code jadi satu, tinggal klik */
function AuthPanel({ auth }: { auth: AuthCode }) {
  const link = remoteConnectLink(auth.user_code);

  return (
    <section className="mt-6 rounded-card bg-peach p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-sienna">
            <IconLink size={15} /> Login Microsoft dibutuhkan
          </p>
          <p className="mt-1 text-xs text-sienna/80">
            Klik tombol di bawah, login dengan akun Microsoft-mu. Code sudah otomatis terisi.
          </p>
        </div>
        <span className="shrink-0 rounded-pill bg-sienna/10 px-2.5 py-1 font-mono text-xs font-medium text-sienna">
          {auth.user_code}
        </span>
      </div>

      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-input bg-sienna px-3 py-3.5 text-paper transition-opacity hover:opacity-90"
      >
        <IconLink size={15} />
        <span className="font-medium">Login Microsoft</span>
        <IconArrowRight size={15} />
      </a>

      <button
        onClick={() => window.open(link, '_blank')}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-input bg-paper p-3 text-left transition-opacity hover:opacity-90"
        title="Buka link login"
      >
        <span className="truncate font-mono text-[10px] text-sienna">{link}</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-sienna text-paper">
          <IconLink size={13} />
        </span>
      </button>

      <p className="mt-2 text-xs text-sienna/70">
        Setelah login berhasil, bot masuk server otomatis (halaman ini refresh sendiri
        {auth.expires_in ? ` · code berlaku ${Math.round(auth.expires_in / 60)} menit` : ''}).
      </p>
    </section>
  );
}