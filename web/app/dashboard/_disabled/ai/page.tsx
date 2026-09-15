'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AiMessage, aiSend, aiHistory, aiClear } from '../../../lib/api';
import { IconSend, IconSparkle, IconTrash } from '../../../components/icons';

export default function AiPage() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Muat riwayat session
  const loadHistory = useCallback(async () => {
    try {
      const h = await aiHistory();
      setMessages(h.messages.filter((m) => m.role !== 'system'));
      setHasHistory(h.hasHistory);
    } catch {
      /* backend belum siap */
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setInput('');
    try {
      const res = await aiSend(msg);
      // Pakai history dari server (akurat, termasuk pesan user & system)
      setMessages(res.history.filter((m) => m.role !== 'system'));
      setHasHistory(true);
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.slice(0, -1)); // hapus pesan gagal
    } finally {
      setBusy(false);
    }
  };

  const clearSession = async () => {
    try {
      await aiClear();
      setMessages([]);
      setHasHistory(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight text-ink">
            <IconSparkle size={22} /> Tanya AI
          </h1>
          <p className="mt-1 text-sm text-slate">
            Asisten panel IsanC — tanya cara pakai, bikin bot, troubleshooting, dll.
          </p>
        </div>
        {hasHistory && (
          <button className="btn-ghost px-3 py-1.5 text-xs text-red-500" onClick={clearSession}>
            <IconTrash size={13} /> Session Baru
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      <section className="mt-6 flex flex-col rounded-card bg-paper shadow-sm">
        {/* Area chat */}
        <div ref={boxRef} className="flex h-[55vh] flex-col gap-3 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <IconSparkle className="mx-auto text-smoke" size={36} strokeWidth={1.2} />
                <p className="mt-3 text-sm text-slate">Belum ada percakapan.</p>
                <p className="mt-1 text-xs text-ash">Contoh: &quot;cara tambah bot pake Microsoft auth&quot;</p>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-elevated px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-ink text-paper' : 'bg-mist text-ink'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-elevated bg-mist px-4 py-3 text-sm text-slate">AI sedang mengetik...</div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2 border-t border-mist p-4">
          <input
            className="input-composer py-3"
            placeholder="Tanya apa saja..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          />
          <button className="btn-filled shrink-0 px-4" onClick={send} disabled={busy || !input.trim()}>
            <IconSend size={16} />
          </button>
        </div>
      </section>
    </>
  );
}