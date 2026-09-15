'use client';

import { useState } from 'react';

/**
 * Foto profil bulat.
 *
 * Kalau URL kosong atau gambarnya gagal dimuat (mis. file dihapus dari catbox),
 * otomatis jatuh ke inisial huruf pertama — jadi tampilan tidak pernah rusak.
 */
export function Avatar({
  url,
  name,
  size = 32,
  className = '',
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const showImage = Boolean(url) && !failed;

  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-mist ${className}`}
      style={{ width: size, height: size }}
      title={name ?? undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url as string}
          alt={name ? `Foto profil ${name}` : 'Foto profil'}
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-medium text-slate"
          style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
