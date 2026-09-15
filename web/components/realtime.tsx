'use client';

/**
 * Panel realtime untuk dashboard:
 * - ActivityFeed : live deposit + pesan bot digabung jadi satu aliran
 *   ("isan#5622 berhasil deposit Rp50.000", "bot1#8064: halo")
 * - GlobalChat   : chat global realtime lewat WebSocket
 * - OnlineBadge  : jumlah pengguna yang sedang terhubung
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRealtime, type FeedItem } from '../lib/realtime';
import { useAuth } from '../lib/auth-context';
import { Avatar } from './avatar';
import {
  IconWallet, IconBot, IconChat, IconSend, IconClock, IconRefresh, IconSparkle,
} from './icons';

/* ============ Utilitas ============ */

/** Waktu relatif singkat: "baru saja", "3m", "2j". */
function relative(iso: string): string {
  // Backend menyimpan format "YYYY-MM-DD HH:MM:SS" (UTC) — tambah Z agar benar.
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return 'baru saja';
  if (s < 60) return `${s}d`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  return `${Math.floor(h / 24)}h`;
}

const FEED_STYLE: Record<string, { icon: typeof IconWallet; tint: string; label: string }> = {
  deposit: { icon: IconWallet, tint: 'bg-peach text-sienna', label: 'Deposit' },
  buy: { icon: IconSparkle, tint: 'bg-[#55db9c]/20 text-[#2aa76c]', label: 'Beli Bot' },
  register: { icon: IconSparkle, tint: 'bg-mist text-slate', label: 'Anggota Baru' },
};

/* ============ Badge online ============ */

export function OnlineBadge({ online }: { online: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill bg-paper px-2.5 py-1 text-[11px] font-medium text-slate shadow-sm">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#55db9c] opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#55db9c]" />
      </span>
      {online} online
    </span>
  );
}

/* ============ Feed aktivitas ============ */

export function ActivityFeed({
  items,
  limit = 12,
  compact = false,
  maxHeight = '17.5rem',
}: {
  items: FeedItem[];
  limit?: number;
  compact?: boolean;
  /** Tinggi maksimum daftar; isinya di-scroll di dalam kotak, bukan memanjangkan halaman. */
  maxHeight?: string;
}) {
  const shown = useMemo(() => items.slice(-limit).reverse(), [items, limit]);
  const [, forceTick] = useState(0);

  // Segarkan label waktu tiap 30 detik supaya "3m" tetap akurat.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (shown.length === 0) {
    return (
      <div className="rounded-card bg-paper p-8 text-center shadow-sm">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-input bg-mist text-smoke">
          <IconClock size={20} />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">Belum ada aktivitas</p>
        <p className="mt-1 text-xs text-slate">
          Deposit dan pembelian bot akan muncul di sini secara langsung.
        </p>
      </div>
    );
  }

  return (
    // Scroll internal: kotak ini punya tinggi maksimum sendiri, jadi
    // menambah aktivitas baru tidak memanjangkan halaman.
    <ul
      className={`scroll-area ${compact ? 'space-y-1.5 pr-1' : 'space-y-2 pr-1.5'}`}
      style={{ maxHeight }}
    >
      {shown.map((it) => {
        const st = FEED_STYLE[it.kind] ?? FEED_STYLE.deposit;
        const Icon = st.icon;
        return (
          <li
            key={it.id}
            className="flex items-start gap-3 rounded-input bg-paper p-3 shadow-sm transition-shadow hover:shadow-md"
          >
            <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-input ${st.tint}`}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-ink">{it.body}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ash">
                <span>{st.label}</span>
                <span>·</span>
                <span>{relative(it.createdAt)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ============ Chat global ============ */

export function GlobalChat({
  chat,
  online,
  status,
  error,
  send,
  setError,
  height = 'h-[420px]',
}: {
  chat: ReturnType<typeof useRealtime>['chat'];
  online: ReturnType<typeof useRealtime>['online'];
  status: ReturnType<typeof useRealtime>['status'];
  error: string | null;
  send: (b: string) => boolean;
  setError: (e: string | null) => void;
  height?: string;
}) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // Auto-scroll hanya kalau pengguna sedang di bawah (jangan ganggu saat baca ke atas).
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const doSend = () => {
    if (!user) {
      setError('Masuk dulu untuk ikut chat.');
      return;
    }
    if (send(text)) {
      setText('');
      atBottomRef.current = true;
      setError(null);
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-paper shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-mist px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-input bg-ink text-paper">
            <IconChat size={15} />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">Global Chat</p>
            <p className="text-[11px] text-ash">
              {status === 'open'
                ? 'Terhubung realtime'
                : status === 'connecting'
                  ? 'Menghubungkan...'
                  : 'Terputus — mencoba lagi'}
            </p>
          </div>
        </div>
        <OnlineBadge online={online} />
      </div>

      {/* Daftar pesan */}
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className={`scroll-area ${height} space-y-3 bg-fog px-4 py-4`}
      >
        {chat.length === 0 && (
          <p className="pt-12 text-center text-xs text-ash">
            Belum ada pesan. Jadilah yang pertama menyapa.
          </p>
        )}
        {chat.map((m) => {
          const mine = m.self || (user != null && m.username === user.username && m.tag === user.tag);
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
              {/* Baris chat memakai struktur cermin supaya pesan sendiri dan
                  pesan orang lain tingginya sama:
                    kiri : [avatar] [nama + bubble + waktu]
                    kanan: [nama + bubble + waktu] [avatar]
                  Semua elemen di-align ke atas agar teks satu baris sejajar
                  dengan bagian atas foto profil. */}

              {/* Foto profil di kiri untuk pesan orang lain */}
              {!mine && (
                <Avatar url={m.avatarUrl} name={m.username} size={28} className="mt-0.5" />
              )}

              <div className={`min-w-0 max-w-[78%] sm:max-w-[70%] ${mine ? 'text-right' : 'text-left'}`}>
                {/* Nama selalu ditampilkan (kedua sisi) supaya simetris */}
                <p className="mb-1 px-1 text-[11px] text-ash">
                  <span className="font-medium text-slate">{m.username}</span>
                  <span className="text-smoke">#{m.tag}</span>
                  {mine && <span className="ml-1 text-smoke">(kamu)</span>}
                </p>
                <div
                  className={`inline-block max-w-full whitespace-pre-wrap break-words rounded-input px-3.5 py-2.5 text-left text-sm leading-snug ${
                    mine ? 'bg-ink text-paper' : 'bg-paper text-ink shadow-sm'
                  }`}
                >
                  {m.body}
                </div>
                <p className="mt-1 px-1 text-[10px] text-smoke">{relative(m.createdAt)}</p>
              </div>

              {/* Foto profil di kanan untuk pesan sendiri */}
              {mine && (
                <Avatar url={m.avatarUrl} name={m.username} size={28} className="mt-0.5" />
              )}
            </div>
          );
        })}
      </div>

      {/* Pesan error */}
      {error && (
        <p className="border-t border-mist bg-[#fdd] px-4 py-2 text-xs text-red-500">{error}</p>
      )}

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-mist p-3">
        <input
          className="input-composer flex-1 py-2.5"
          placeholder={user ? 'Tulis pesan...' : 'Masuk untuk ikut chat'}
          value={text}
          maxLength={300}
          disabled={!user}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              doSend();
            }
          }}
        />
        <button
          className="btn-filled shrink-0 px-3.5 py-2.5"
          onClick={doSend}
          disabled={!user || !text.trim()}
          title="Kirim (Enter)"
        >
          <IconSend size={15} />
        </button>
      </div>
    </section>
  );
}

/* ============ Panel gabungan siap pakai ============ */

/** Feed aktivitas yang sudah tersambung ke WebSocket sendiri. */
export function LiveActivityCard({
  limit = 20,
  maxHeight = '17.5rem',
}: {
  limit?: number;
  maxHeight?: string;
}) {
  const { feed, status } = useRealtime();
  return (
    <section className="rounded-card bg-paper p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <IconRefresh size={15} /> Aktivitas Langsung
          </h2>
          <p className="mt-0.5 text-[11px] text-slate">Deposit &amp; pembelian bot secara realtime</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ash">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'open' ? 'bg-[#55db9c]' : status === 'connecting' ? 'bg-peach' : 'bg-smoke'
            }`}
          />
          {status === 'open' ? 'live' : status === 'connecting' ? 'menyambung' : 'terputus'}
        </span>
      </div>
      <ActivityFeed items={feed} limit={limit} maxHeight={maxHeight} />
    </section>
  );
}
