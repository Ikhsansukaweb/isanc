'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { BotState, getBot, sendChat } from '../../../../lib/api';
import { IconSend } from '../../../../components/icons';

export default function BotChatPage() {
  const params = useParams<{ name: string }>();
  // Segmen URL masih ter-encode ("bot3%238064") — decode ke label asli "bot3#8064"
  const rawName = params?.name ?? '';
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    name = rawName;
  }
  const [bot, setBot] = useState<BotState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const chatRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBot(await getBot(name));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [name]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [bot?.chat]);

  const handleChat = async () => {
    const msg = chatMsg.trim();
    if (!msg) return;
    try {
      await sendChat(name, msg);
      setChatMsg('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const spawned = bot?.status === 'spawned';

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-ink">Chat — {name}</h1>
      <p className="mt-0.5 text-sm text-slate">Kirim pesan &amp; lihat log real-time dari server.</p>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
        <div className="flex gap-2">
          <input
            className="input-composer py-2.5"
            placeholder="Kirim chat in-game..."
            value={chatMsg}
            onChange={(e) => setChatMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleChat()}
          />
          <button className="btn-filled shrink-0 px-4" onClick={handleChat} disabled={!spawned}>
            <IconSend size={15} />
          </button>
        </div>
        <div className="mt-4 rounded-input bg-ink p-4">
          <div ref={chatRef} className="max-h-[60vh] space-y-1 overflow-y-auto font-mono text-[11px]">
            {(bot?.chat ?? []).length === 0 && <p className="text-slate">Belum ada log...</p>}
            {(bot?.chat ?? []).map((c, i) => (
              <p key={i} className={c.system ? 'text-slate' : c.self ? 'text-[#55db9c]' : 'text-[#9ac8ff]'}>
                {c.system ? `• ${c.message}` : `${c.source ?? '?'}: ${c.message}`}
              </p>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}