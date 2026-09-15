'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BotState, getBot, botHotbar, containerOpen, containerClose, containerClick } from '../../../../lib/api';
import { IconChest, IconBox } from '../../../../components/icons';

export default function BotInventoryPage() {
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

  const spawned = bot?.status === 'spawned';
  const selected = bot?.selectedHotbarSlot ?? 0;

  // Kelompokkan inventory per baris (9 kolom)
  const rows: Array<Array<{ name: string; count: number } | null>> = [];
  for (let i = 0; i < 36; i += 9) {
    rows.push(Array.from({ length: 9 }, (_, j) => bot?.inventory?.[i + j] ?? null));
  }

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-ink">Inventory — {name}</h1>
      <p className="mt-0.5 text-sm text-slate">Hotbar, item, dan chest bot.</p>

      {error && <p className="mt-4 rounded-input bg-[#fdd] p-3 text-sm text-red-500">{error}</p>}

      {!spawned ? (
        <p className="mt-8 rounded-card bg-paper p-6 text-center text-sm text-slate">
          Bot belum spawned — inventory muncul setelah berhasil masuk server.
        </p>
      ) : (
        <>
          {/* Hotbar grid */}
          <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
            <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ash">
              <IconBox size={14} /> Hotbar (slot {selected + 1})
            </h2>
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

          {/* Inventory grid 4×9 */}
          <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
            <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ash">
              <IconBox size={14} /> Inventory
            </h2>
            <div className="mt-3 space-y-1.5">
              {rows.map((row, r) => (
                <div key={r} className="grid grid-cols-9 gap-1.5">
                  {row.map((item, i) => (
                    <div
                      key={i}
                      title={item ? `${item.name} ×${item.count}` : undefined}
                      className="relative flex aspect-square flex-col items-center justify-center rounded-input bg-mist p-1 text-center"
                    >
                      {item ? (
                        <>
                          <span className="block w-full truncate px-0.5 text-[9px] font-medium text-ink">{item.name}</span>
                          <span className="text-[9px] text-ash">×{item.count}</span>
                        </>
                      ) : (
                        <span className="opacity-20">·</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {(bot.inventory ?? []).filter(Boolean).length === 0 && (
              <p className="mt-3 text-xs text-ash">Belum ada item ter-sync dari server.</p>
            )}
          </section>

          {/* Chest */}
          <section className="mt-6 rounded-card bg-paper p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ash">
                <IconChest size={14} /> Chest {bot.container?.open ? `(${bot.container.windowType ?? ''})` : ''}
              </h2>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => act(() => containerOpen(name))}
                >
                  Buka
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => act(() => containerClose(name))}
                  disabled={!bot.container?.open}
                >
                  Tutup
                </button>
              </div>
            </div>
            {bot.container?.open ? (
              <div className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                {(bot.container.slots ?? bot.container.items ?? []).map((item, i) => (
                  <button
                    key={i}
                    onClick={() => act(() => containerClick(name, i))}
                    title={`Slot #${i + 1}${item ? `: ${item.name} ×${item.count}` : ''}`}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-input p-1 text-center transition-colors ${
                      item ? 'bg-mist text-ink hover:bg-smoke/30' : 'bg-fog text-ash/60 hover:bg-mist'
                    }`}
                  >
                    {item ? (
                      <>
                        <span className="block w-full truncate px-0.5 text-[9px] font-medium">{item.name}</span>
                        <span className="text-[9px] text-ash">×{item.count}</span>
                      </>
                    ) : (
                      <span className="text-[9px]">#{i + 1}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-ash">Chest tertutup. Klik Buka saat menghadap chest di game.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}