'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { authChangePassword, uploadAvatar, deleteAvatar } from '../../../lib/api';
import { Avatar } from '../../../components/avatar';
import { IconLock, IconUser, IconInfo, IconWallet, IconPlus } from '../../../components/icons';

export default function AccountPage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const router = useRouter();

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Foto profil
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard/account');
  }, [loading, user, router]);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (newPw !== confirm) {
      setMsg({ type: 'err', text: 'Konfirmasi password tidak sama.' });
      return;
    }
    setBusy(true);
    try {
      const r = await authChangePassword(oldPw, newPw);
      setMsg({ type: 'ok', text: r.message ?? 'Password diubah. Silakan login ulang.' });
      setOldPw(''); setNewPw(''); setConfirm('');
      setTimeout(() => { logout(); router.replace('/login'); }, 1800);
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** Unggah foto ke catbox lalu simpan URL-nya di akun. */
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoMsg(null);

    if (!file.type.startsWith('image/')) {
      setPhotoMsg({ type: 'err', text: 'File harus berupa gambar (PNG, JPG, WEBP, GIF).' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPhotoMsg({ type: 'err', text: 'Ukuran foto maksimal 2 MB.' });
      return;
    }

    setPhotoBusy(true);
    try {
      await uploadAvatar(file);
      await refreshUser();
      setPhotoMsg({ type: 'ok', text: 'Foto profil diperbarui.' });
    } catch (err) {
      setPhotoMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setPhotoBusy(false);
      // Reset input supaya memilih file yang sama tetap memicu onChange.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    setPhotoMsg(null);
    setPhotoBusy(true);
    try {
      await deleteAvatar();
      await refreshUser();
      setPhotoMsg({ type: 'ok', text: 'Foto profil dihapus.' });
    } catch (err) {
      setPhotoMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setPhotoBusy(false);
    }
  };

  if (loading || !user) {
    return <p className="py-20 text-center text-sm text-slate">Memuat akun...</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight text-ink">
            <IconUser size={22} /> Akun
          </h1>
          <p className="mt-1 text-sm text-slate">Kelola profil dan keamanan akunmu.</p>
        </div>
        <button
          className="btn-ghost px-4 py-2 text-sm"
          onClick={async () => { await logout(); router.replace('/login'); }}
        >
          Keluar
        </button>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Profil */}
        <div className="rounded-card bg-paper p-6 shadow-sm">
          <h2 className="text-sm font-medium text-ink">Profil</h2>
          <div className="mt-4 flex items-center gap-4">
            <Avatar url={user.avatarUrl} name={user.username} size={56} />
            <div>
              <p className="text-lg font-medium text-ink">
                {user.username}
                <span className="font-mono text-base text-sienna">#{user.tag}</span>
              </p>
              <p className="text-xs text-slate">Dibuat {user.createdAt}</p>
            </div>
          </div>

          {/* Foto profil */}
          <div className="mt-4 rounded-input bg-fog p-3">
            <p className="text-xs font-medium text-slate">Foto profil</p>
            <p className="mt-0.5 text-[11px] text-ash">
              Tampil di chat global. Maks 2 MB (PNG, JPG, WEBP, GIF).
            </p>

            {photoMsg && (
              <p
                className={`mt-2 rounded-input p-2 text-xs ${
                  photoMsg.type === 'ok' ? 'bg-[#55db9c]/15 text-[#2aa76c]' : 'bg-[#fdd] text-red-500'
                }`}
              >
                {photoMsg.text}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-filled px-3 py-2 text-xs"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
              >
                <IconPlus size={13} />
                {photoBusy ? 'Mengunggah...' : user.avatarUrl ? 'Ganti Foto' : 'Unggah Foto'}
              </button>
              {user.avatarUrl && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-2 text-xs"
                  disabled={photoBusy}
                  onClick={removePhoto}
                >
                  Hapus Foto
                </button>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0])}
            />
          </div>

          <div className="mt-5 space-y-3 border-t border-mist pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate">Tag bot</span>
              <span className="font-mono text-sienna">#{user.tag}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate">Nama bot otomatis</span>
              <span className="font-mono text-ink">bot1#{user.tag}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate">Login terakhir</span>
              <span className="text-ink">{user.lastLoginAt ?? '-'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate">Role</span>
              <span className="text-ink">{user.role}</span>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-input bg-fog p-3">
            <IconInfo size={14} className="shrink-0 text-ash" />
            <p className="text-xs text-slate">
              Tag <span className="font-mono text-sienna">#{user.tag}</span> ditambahkan otomatis ke nama bot
              supaya tidak bentrok dengan akun lain di server yang sama.
            </p>
          </div>

          <a href="/dashboard/saldo" className="btn-ghost mt-4 w-full py-2.5 text-sm">
            <IconWallet size={15} /> Lihat Saldo &amp; Deposit
          </a>
        </div>

        {/* Keamanan */}
        <div className="rounded-card bg-paper p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <IconLock size={15} /> Keamanan
          </h2>
          <p className="mt-1 text-xs text-slate">
            Password disimpan sebagai hash bcrypt. Ganti password akan mengakhiri semua sesi di device lain.
          </p>

          {msg && (
            <p className={`mt-4 rounded-input p-3 text-sm ${msg.type === 'ok' ? 'bg-[#55db9c]/15 text-[#2aa76c]' : 'bg-[#fdd] text-red-500'}`}>
              {msg.text}
            </p>
          )}

          <form onSubmit={changePassword} className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-slate">Password lama</label>
              <input
                type="password"
                className="input-composer mt-1 py-2.5"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate">Password baru</label>
              <input
                type="password"
                className="input-composer mt-1 py-2.5"
                placeholder="minimal 8 karakter, ada huruf & angka"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate">Ulangi password baru</label>
              <input
                type="password"
                className="input-composer mt-1 py-2.5"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="btn-filled w-full py-2.5 text-sm" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Ganti Password'}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
