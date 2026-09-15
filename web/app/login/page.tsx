'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '../../lib/safe-next';
import { useAuth } from '../../lib/auth-context';
import { IconArrowRight, IconLink } from '../../components/icons';
import { Logo } from '../../components/logo';

function LoginForm() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Tujuan redirect divalidasi dulu (audit #17 — open redirect).
  // Tanpa ini, `/login?next=https://situs-penipu.example` mengirim korban ke
  // domain penyerang TEPAT setelah login berhasil — phishing yang meyakinkan.
  const next = safeNext(params.get('next'));

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sudah login → langsung ke dashboard
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirm) {
      setError('Konfirmasi password tidak sama.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password);
      router.replace(next);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 401) {
        setError('Username atau password salah. Periksa huruf besar/kecil dan pastikan password benar.');
      } else if (e.status === 429) {
        setError('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
     * Desktop : kolom kiri = wallpaper foto, kolom kanan = form login.
     * Mobile  : foto disembunyikan (hidden lg:block) — langsung form saja.
     */
    <main className="min-h-screen bg-fog lg:grid lg:grid-cols-2">
      {/* ===== Kiri: wallpaper foto (desktop saja) ===== */}
      <aside className="relative hidden overflow-hidden lg:block">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/login-bg.jpg')" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-ink/80 via-ink/45 to-ink/60" aria-hidden />

        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex items-center gap-2.5 text-paper">
            <Logo size={38} radius={12} />
            <span className="text-lg font-medium tracking-tight">
              Isan<span className="font-serif italic">C</span>
            </span>
          </Link>

          <div>
            <h2 className="heading-serif max-w-md text-[34px] leading-[1.15] text-paper xl:text-[42px]">
              Bot AFK yang <em className="font-serif italic">tetep online</em>,
              ngobrol, &amp; jaga server kamu.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-paper/75">
              Kelola bot, pantau deposit masuk, dan ikut global chat realtime —
              semuanya dari satu panel.
            </p>

            <div className="mt-9 flex flex-wrap gap-2">
              {['Global Chat Realtime', 'Live Deposit', 'Riwayat Pembelian'].map((t) => (
                <span
                  key={t}
                  className="rounded-pill bg-paper/15 px-3 py-1.5 text-[11px] font-medium text-paper backdrop-blur-sm"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-paper/50">Dibuat oleh isan ganteng</p>
        </div>
      </aside>

      {/* ===== Kanan: form ===== */}
      <div className="grid min-h-screen place-items-center px-5 py-10 lg:min-h-0">
        <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5 text-ink">
          <Logo size={38} radius={12} />
          <span className="text-lg font-medium tracking-tight">
            Isan<span className="font-serif italic">C</span>
          </span>
        </Link>

        <section className="rounded-card bg-paper p-7 shadow-sm">
          <h1 className="text-xl font-medium tracking-tight text-ink">
            {mode === 'login' ? 'Masuk ke panel' : 'Buat akun baru'}
          </h1>
          <p className="mt-1 text-sm text-slate">
            {mode === 'login'
              ? 'Kelola bot AFK, saldo, dan masa sewa.'
              : 'Setiap akun dapat hashtag unik agar bot tidak bentrok.'}
          </p>

          {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-slate">Username</label>
              <input
                className="input-composer mt-1 py-2.5"
                placeholder="isan"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate">Password</label>
              <input
                type="password"
                className="input-composer mt-1 py-2.5"
                placeholder="minimal 8 karakter, ada angka"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>
            {mode === 'register' && (
              <div>
                <label className="text-xs font-medium text-slate">Ulangi Password</label>
                <input
                  type="password"
                  className="input-composer mt-1 py-2.5"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            <button type="submit" className="btn-filled w-full py-3 text-sm" disabled={busy}>
              {busy ? 'Memproses...' : mode === 'login' ? 'Masuk' : 'Daftar'}
              {!busy && <IconArrowRight size={15} />}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate">
            {mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
            <button
              className="font-medium text-sienna underline-offset-2 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Daftar' : 'Masuk'}
            </button>
          </p>
        </section>

        <p className="mt-5 text-center text-xs text-ash">
          <IconLink size={11} className="inline" /> Token disimpan aman · password di-hash bcrypt
        </p>
        <p className="mt-2 text-center text-xs text-ash">Dibuat oleh isan ganteng</p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-fog text-sm text-slate">Memuat...</main>}>
      <LoginForm />
    </Suspense>
  );
}
