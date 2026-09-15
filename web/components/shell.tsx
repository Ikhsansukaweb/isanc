'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BotState, UserBot, getBots, getUserBots } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  IconGrid, IconPlus, IconBot, IconUser, IconWallet, IconChat, IconBox,
  IconArrowRight, IconBack,
} from './icons';
import { Logo } from './logo';
import { Avatar } from './avatar';

const STATUS_DOT: Record<string, string> = {
  spawned: 'bg-[#55db9c]',
  awaiting_auth: 'bg-peach',
  connecting: 'bg-blue-400',
  kicked: 'bg-red-400',
  error: 'bg-red-400',
};

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [bots, setBots] = useState<BotState[]>([]);
  const [owned, setOwned] = useState<UserBot[]>([]);

  // Guard: halaman dashboard wajib login
  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const [b, o] = await Promise.all([getBots(), getUserBots()]);
        if (alive) {
          setBots(b);
          setOwned(o);
        }
      } catch {
        /* backend belum siap / token kedaluwarsa */
      }
    };

    load();
    // Daftar bot berubah saat user menambah/menjalankan bot di halaman lain —
    // polling cepat (3s) + refresh saat tab kembali aktif + saat pindah halaman.
    const t = setInterval(load, 3000);
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, pathname]);

  // Segment: '' (dashboard) | 'add' | '<name>' | '<name>/chat' | '<name>/inventory'
  const seg = pathname.replace(/^\/dashboard\/?/, '').split('/').filter(Boolean);
  // Segmen statis: bukan nama bot, jadi jangan diperlakukan sebagai bot.
  const STATIC_SEG = new Set(['add', 'bots', 'chat', 'account', 'saldo']);
  const botName = seg[0] && !STATIC_SEG.has(seg[0]) ? decodeURIComponent(seg[0]) : null;
  const sub = seg[1];

  /*
   * Halaman detail bot = sedang membuka salah satu bot (Kontrol/Chat/Inventory).
   * HANYA di sini header atas mobile ditampilkan; semua halaman lain bersih
   * tanpa header, navigasi cukup lewat bar bawah + sub-tab.
   */
  const isBotDetail = botName !== null;

  const navItem = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`flex items-center gap-3 rounded-input px-3 py-2.5 text-sm transition-colors ${
        active ? 'bg-ink text-paper' : 'text-slate hover:bg-mist hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-fog">
      {/* Sidebar desktop (lg+) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-mist bg-paper lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
          <Logo size={36} radius={11} />
          <span className="text-lg font-medium tracking-tight text-ink">
            Isan<span className="font-serif italic">C</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {navItem('/dashboard', 'Dashboard', <IconGrid size={18} />, pathname === '/dashboard')}
          {navItem('/dashboard/bots', 'Bot Saya', <IconBot size={18} />, pathname === '/dashboard/bots')}
          {navItem('/dashboard/add', 'Tambah Bot', <IconPlus size={18} />, pathname === '/dashboard/add')}
          {navItem('/dashboard/chat', 'Global Chat', <IconChat size={18} />, pathname === '/dashboard/chat')}
          {navItem('/dashboard/account', 'Akun', <IconUser size={18} />, pathname === '/dashboard/account')}
          {navItem('/dashboard/saldo', 'Saldo', <IconWallet size={18} />, pathname === '/dashboard/saldo')}

          {owned.length > 0 && (
            <div className="pt-4">
              <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-ash">
                Bot Saya ({owned.length})
              </p>
              <div className="space-y-0.5">
                {owned.map((b) => {
                  const expired = b.expired || b.expires_at == null;
                  const active = botName === b.label;
                  return (
                    <Link
                      key={b.label}
                      href={`/dashboard/${encodeURIComponent(b.label)}`}
                      className={`flex items-center gap-2.5 rounded-input px-3 py-2.5 text-sm transition-colors ${
                        active ? 'bg-ink text-paper' : 'text-slate hover:bg-mist hover:text-ink'
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${expired ? 'bg-smoke/50' : b.live ? 'bg-[#55db9c]' : 'bg-peach'}`} />
                      <span className="flex-1 truncate font-mono text-xs">{b.label}</span>
                      <span className={`shrink-0 text-[10px] ${active ? 'text-paper/70' : expired ? 'text-ash' : 'text-[#2aa76c]'}`}>
                        {expired ? 'nonaktif' : b.live?.status === 'spawned' ? 'jalan' : 'siap'}
                      </span>
                      <IconArrowRight size={12} className="shrink-0 opacity-50" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {bots.length > 0 && (
            <div className="pt-4">
              <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-ash">
                Bots Online ({bots.length})
              </p>
              <div className="space-y-0.5">
                {bots.map((b) => {
                  const active = botName === b.name;
                  return (
                    <div key={b.name}>
                      <Link
                        href={`/dashboard/${encodeURIComponent(b.name)}`}
                        className={`flex items-center gap-2.5 rounded-input px-3 py-2 text-sm transition-colors ${
                          active && !sub ? 'bg-ink text-paper' : 'text-slate hover:bg-mist hover:text-ink'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[b.status] ?? 'bg-smoke'}`} />
                        <span className="flex-1 truncate">{b.name}</span>
                        <span className="text-[10px] text-ash">{Math.floor((b.uptimeSeconds ?? 0) / 60)}m</span>
                      </Link>
                      {(active || sub) && (
                        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-mist pl-3">
                          <Link
                            href={`/dashboard/${encodeURIComponent(b.name)}`}
                            className={`rounded-input px-2.5 py-1.5 text-xs ${sub === 'chat' || sub === 'inventory' ? 'text-slate hover:text-ink' : active ? 'bg-ink/5 font-medium text-ink' : 'text-slate hover:text-ink'}`}
                          >
                            Kontrol
                          </Link>
                          <Link
                            href={`/dashboard/${encodeURIComponent(b.name)}/chat`}
                            className={`flex items-center gap-1.5 rounded-input px-2.5 py-1.5 text-xs ${sub === 'chat' ? 'bg-ink text-paper' : 'text-slate hover:text-ink'}`}
                          >
                            <IconChat size={13} /> Chat
                          </Link>
                          <Link
                            href={`/dashboard/${encodeURIComponent(b.name)}/inventory`}
                            className={`flex items-center gap-1.5 rounded-input px-2.5 py-1.5 text-xs ${sub === 'inventory' ? 'bg-ink text-paper' : 'text-slate hover:text-ink'}`}
                          >
                            <IconBox size={13} /> Inventory
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        <div className="border-t border-mist p-3">
          {user ? (
            <Link href="/dashboard/account" className="block rounded-input bg-fog p-3 transition-colors hover:bg-mist">
              <div className="flex items-center gap-2.5">
                <Avatar url={user.avatarUrl} name={user.username} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{user.displayName}</p>
                  <p className="flex items-center gap-1 font-mono text-[11px] text-slate">
                    <IconWallet size={10} /> {rupiah(user.balance)}
                  </p>
                </div>
              </div>
            </Link>
          ) : (
            <p className="px-2 py-1 text-xs text-slate">Belum login</p>
          )}
        </div>
      </aside>

      {/* Bottom nav mobile (< lg) — 5 tab.
          Tab "Bot" menuju halaman daftar bot (/dashboard/bots), bukan lagi
          menebak bot pertama. Di halaman detail bot, tab ini tetap aktif
          supaya user tahu sedang berada di area bot. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-mist bg-paper/95 backdrop-blur lg:hidden">
        {[
          { href: '/dashboard', label: 'Dashboard', icon: IconGrid, active: pathname === '/dashboard' },
          { href: '/dashboard/bots', label: 'Bot', icon: IconBot, active: pathname === '/dashboard/bots' || isBotDetail },
          { href: '/dashboard/chat', label: 'Chat', icon: IconChat, active: pathname === '/dashboard/chat' },
          { href: '/dashboard/saldo', label: 'Saldo', icon: IconWallet, active: pathname === '/dashboard/saldo' },
          { href: '/dashboard/account', label: 'Akun', icon: IconUser, active: pathname === '/dashboard/account' },
        ].map(({ href, label, icon: Icon, active }) => (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors ${active ? 'text-ink' : 'text-slate'}`}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>

      {/*
       * Header atas mobile — HANYA di halaman detail bot.
       *
       * Semua halaman lain (dashboard, Bot Saya, Tambah Bot, Chat, Saldo,
       * Akun) tampil tanpa header atas di mobile; navigasinya cukup dari bar
       * bawah. Di detail bot header ini perlu karena memuat tombol kembali,
       * nama bot, dan saldo — tanpa itu user bisa tersesat di sub-halaman.
       */}
      {isBotDetail && (
        <header className="sticky top-0 z-20 border-b border-mist bg-paper/95 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Link
              href="/dashboard/bots"
              aria-label="Kembali ke daftar bot"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-input text-slate transition-colors hover:bg-mist hover:text-ink"
            >
              <IconBack size={18} />
            </Link>

            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-medium text-ink">{botName}</p>
              <p className="text-[10px] text-ash">Detail bot</p>
            </div>

            {user && (
              <Link
                href="/dashboard/saldo"
                className="flex shrink-0 items-center gap-1.5 rounded-pill bg-mist px-3 py-1.5"
              >
                <IconWallet size={12} />
                <span className="font-mono text-[11px] font-medium text-ink">{rupiah(user.balance)}</span>
              </Link>
            )}
          </div>

          {/* Sub-tab bot menempel langsung di bawah header detail (satu baris,
              tanpa celah) supaya tidak ada sisa ruang menggantung di mobile. */}
          <div className="flex overflow-x-auto border-t border-mist">
            {[
              { href: `/dashboard/${encodeURIComponent(botName)}`, label: 'Kontrol', icon: IconGrid, active: !sub },
              { href: `/dashboard/${encodeURIComponent(botName)}/chat`, label: 'Chat', icon: IconChat, active: sub === 'chat' },
              { href: `/dashboard/${encodeURIComponent(botName)}/inventory`, label: 'Inventory', icon: IconBox, active: sub === 'inventory' },
            ].map(({ href, label, icon: Icon, active }) => (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs transition-colors whitespace-nowrap ${
                  active ? 'bg-ink/5 font-medium text-ink' : 'text-slate'
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            ))}
          </div>
        </header>
      )}

      {/* Konten */}
      <div className="lg:pl-64">
        <main className="mx-auto min-h-[calc(100vh-56px)] max-w-[1200px] px-4 pb-24 pt-6 sm:px-6 lg:pb-10">
          {children}
        </main>

        <footer className="border-t border-mist bg-paper py-6">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-3 px-6 text-sm text-slate sm:flex-row sm:justify-between">
            <span className="flex items-center gap-2">
              <Logo size={26} radius={8} />
              <span className="text-base font-medium tracking-tight text-ink">
                Isan<span className="font-serif italic">C</span>
              </span>
            </span>
            <span className="text-center">
              Dibuat dengan <span className="text-sienna">♥</span> oleh{' '}
              <span className="font-medium text-ink">isan ganteng</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}