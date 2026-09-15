'use client';

/**
 * Halaman Global Chat — obrolan realtime semua pengguna (WebSocket).
 * Di samping chat ada feed aktivitas (deposit & pesan bot) supaya
 * pengguna tahu apa yang sedang terjadi di server.
 */
import { useRealtime } from '../../../lib/realtime';
import { GlobalChat, ActivityFeed, OnlineBadge } from '../../../components/realtime';
import { IconChat, IconRefresh } from '../../../components/icons';

export default function GlobalChatPage() {
  const { chat, feed, online, status, error, setError, send } = useRealtime();

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading-serif text-2xl tracking-tight">Global Chat</h1>
          <p className="mt-1 text-sm text-slate">
            Obrolan realtime semua pengguna IsanC — langsung tanpa perlu refresh.
          </p>
        </div>
        <OnlineBadge online={online} />
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <GlobalChat
          chat={chat}
          online={online}
          status={status}
          error={error}
          send={send}
          setError={setError}
          height="h-[60vh] lg:h-[calc(100vh-320px)]"
        />

        <aside className="space-y-4">
          <section className="rounded-card bg-paper p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <IconChat size={15} /> Cara pakai
            </h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate">
              <li>Tekan <span className="font-medium text-ink">Enter</span> untuk mengirim pesan.</li>
              <li>Maksimal 300 karakter per pesan.</li>
              <li>Batasi 20 pesan per menit supaya tetap nyaman.</li>
              <li>Jaga sopan santun — pesan tersimpan di server.</li>
            </ul>
          </section>

          <section className="rounded-card bg-paper p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
              <IconRefresh size={15} /> Aktivitas
            </h2>
            <ActivityFeed items={feed} limit={15} compact maxHeight="15rem" />
          </section>
        </aside>
      </div>
    </>
  );
}
