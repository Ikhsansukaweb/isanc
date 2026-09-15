'use client';

/**
 * Hook WebSocket untuk chat global & feed aktivitas realtime.
 *
 * Token tidak bisa dikirim lewat header di WebSocket browser, jadi dipakai
 * query `?token=`. Kalau token berubah (habis refresh), socket dibuka ulang.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WS_URL, getAccessToken as getAccessTokenCached } from './api';

export interface GlobalMessage {
  id: number;
  username: string;
  tag: string;
  body: string;
  /** URL foto profil (dari catbox.moe). null = belum pasang foto. */
  avatarUrl?: string | null;
  createdAt: string;
  self?: boolean;
}

export type FeedKind =
  | 'deposit'
  | 'buy'
  | 'register';

export interface FeedItem {
  id: number;
  kind: FeedKind;
  label: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

type Status = 'connecting' | 'open' | 'closed';

export function useRealtime() {
  const [chat, setChat] = useState<GlobalMessage[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [online, setOnline] = useState(0);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

    const token = getAccessTokenCached();
    const url = token ? `${WS_URL}/ws?token=${encodeURIComponent(token)}` : `${WS_URL}/ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setStatus('closed');
      return;
    }
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      retryRef.current = 0;
      setStatus('open');
      setError(null);
    };

    ws.onmessage = (ev) => {
      let m: {
        type?: string;
        chat?: GlobalMessage[];
        feed?: FeedItem[];
        message?: GlobalMessage;
        item?: FeedItem;
        online?: number;
        error?: string;
      };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (m.type === 'init') {
        setChat(m.chat ?? []);
        setFeed(m.feed ?? []);
        return;
      }
      if (m.type === 'chat' && m.message) {
        setChat((prev) => {
          // Hindari duplikat kalau pesan sendiri sudah dioptimistic-add
          if (prev.some((x) => x.id === m.message!.id)) return prev;
          return [...prev, m.message!].slice(-200);
        });
        return;
      }
      if (m.type === 'feed' && m.item) {
        setFeed((prev) => [...prev, m.item!].slice(-100));
        return;
      }
      if (m.type === 'presence') {
        setOnline(m.online ?? 0);
        return;
      }

      /*
       * Server menolak mengirim data sebelum terautentikasi (audit #25).
       * Biasanya terjadi kalau token belum ada / sudah kedaluwarsa saat
       * handshake. Kirim ulang token terbaru lewat pesan 'auth'.
       */
      if (m.type === 'need-auth') {
        const fresh = getAccessTokenCached();
        if (fresh && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'auth', token: fresh }));
        }
        return;
      }
      if (m.type === 'error') {
        setError(m.error ?? 'Terjadi kesalahan.');
      }
    };

    ws.onclose = () => {
      setStatus('closed');
      if (closedRef.current) return;
      // Sambung ulang dengan backoff naik (maks 15 detik).
      retryRef.current = Math.min(retryRef.current + 1, 5);
      const wait = Math.min(1000 * 2 ** (retryRef.current - 1), 15000);
      setTimeout(() => { if (!closedRef.current) connect(); }, wait);
    };

    ws.onerror = () => {
      /* onclose akan menangani percobaan ulang */
    };
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
    };
    // Token bisa berubah setelah refresh sesi; disambung ulang saat event itu.
  }, [connect]);

  /** Kirim pesan chat global. */
  const send = useCallback((body: string) => {
    const text = body.trim();
    if (!text) return false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Koneksi belum siap. Coba lagi sebentar.');
      return false;
    }
    ws.send(JSON.stringify({ type: 'chat', body: text }));
    return true;
  }, []);

  return { chat, feed, online, status, error, setError, send };
}

/** Ambil feed sekali lewat REST — dipakai kalau WebSocket belum terhubung. */
export async function fetchFeed(kinds: FeedKind[] = ['deposit', 'buy']): Promise<FeedItem[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'https://api.skadesmart.web.id'}/api/feed?kind=${kinds.join(',')}&limit=30`,
      { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items: FeedItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
