/**
 * Logo IsanC — memakai foto asli yang diberikan user (public/logo.jpg).
 * Tidak menggambar ulang: hanya menampilkan file gambar aslinya.
 */

/** Logo penuh — foto asli di dalam kotak rounded (sidebar, header, footer) */
export function Logo({ size = 32, radius = 10, className = '' }: { size?: number; radius?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.jpg"
      alt="Logo IsanC"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }}
      className={className}
    />
  );
}

/** Logo bulat — untuk avatar / badge kecil */
export function LogoCircle({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.jpg"
      alt="Logo IsanC"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: '9999px', objectFit: 'cover' }}
      className={className}
    />
  );
}

/** Logo besar untuk landing (foto asli, tanpa crop) */
export function LogoLarge({ size = 96, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.jpg"
      alt="Logo IsanC"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 24, objectFit: 'cover' }}
      className={className}
    />
  );
}
