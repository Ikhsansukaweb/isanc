'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { createUserBot, UserBot } from '../../../lib/api';
import { IconPlus, IconArrowRight, IconInfo, IconBot } from '../../../components/icons';

export default function AddBotPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [baseName, setBaseName] = useState('bot1');
  const [host, setHost] = useState('be.prownetwork.net');
  const [port, setPort] = useState('19132');
  const [version, setVersion] = useState('1.26.30');
  const [offlineMode, setOfflineMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<UserBot | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard/add');
  }, [loading, user, router]);

  const label = user ? `${baseName.trim().replace(/\s+/g, '')}#${user.tag}` : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const bot = await createUserBot({
        baseName: baseName.trim(),
        host: host.trim(),
        port: Number(port) || 19132,
        version: version.trim() || undefined,
        offlineMode,
      });
      setCreated(bot);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user) {
    return <p className="py-20 text-center text-sm text-slate">Memuat...</p>;
  }

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-ink">Tambah Bot</h1>
      <p className="mt-1 text-sm text-slate">
        Nama bot otomatis diberi hashtag akunmu agar tidak bentrok dengan pengguna lain.
      </p>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      {created ? (
        <section className="mt-6 rounded-card bg-paper p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-input bg-[#55db9c]/15 text-[#2aa76c]">
              <IconBot size={20} />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">Bot berhasil ditambahkan</p>
              <p className="font-mono text-sm text-sienna">{created.label}</p>
            </div>
          </div>

          <div className="mt-5 rounded-input bg-peach p-4">
            <p className="text-xs font-medium text-sienna">Langkah selanjutnya</p>
            <p className="mt-1 text-sm text-sienna/80">
              Aktifkan masa sewa pakai saldo dulu (mis. harian Rp3.000), baru bot bisa dijalankan.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/account" className="btn-filled px-4 py-2 text-sm">
              Isi Saldo <IconArrowRight size={14} />
            </Link>
            <Link href="/dashboard" className="btn-ghost px-4 py-2 text-sm">
              Ke Dashboard
            </Link>
          </div>
        </section>
      ) : (
        <form onSubmit={submit} className="mt-6 max-w-2xl rounded-card bg-paper p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-slate">Nama Bot</label>
              <input
                className="input-composer mt-1 py-2.5"
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                placeholder="bot1"
                required
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ash">
                <IconInfo size={11} /> Nama lengkap: <span className="font-mono text-sienna">{label}</span>
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-slate">Server (Host/IP)</label>
              <input
                className="input-composer mt-1 py-2.5"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="be.prownetwork.net"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate">Port</label>
              <input
                className="input-composer mt-1 py-2.5 font-mono"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                placeholder="19132"
                inputMode="numeric"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-slate">
                Versi Minecraft <span className="text-ash">(bisa diganti)</span>
              </label>
              <input
                className="input-composer mt-1 py-2.5 font-mono"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.26.30"
                required
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
              <p className="mt-1.5 text-[11px] text-ash">
                Terisi otomatis <span className="font-mono text-slate">1.26.30</span> — ganti kalau servermu pakai versi lain.
              </p>
            </div>

            <label className="flex items-center gap-2.5 sm:col-span-2">
              <input
                type="checkbox"
                checked={offlineMode}
                onChange={(e) => setOfflineMode(e.target.checked)}
                className="h-4 w-4 accent-[#17191c]"
              />
              <span className="text-sm text-ink">Offline mode</span>
              <span className="text-xs text-ash">server tanpa autentikasi Microsoft</span>
            </label>
          </div>

          <div className="mt-6 flex gap-2">
            <button type="submit" className="btn-filled px-5 py-2.5 text-sm" disabled={busy}>
              <IconPlus size={15} /> {busy ? 'Menambahkan...' : 'Tambah Bot'}
            </button>
            <Link href="/dashboard" className="btn-ghost px-4 py-2.5 text-sm">
              Batal
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
