import Link from 'next/link';
import {
  IconArrowRight, IconGrid, IconServer, IconWallet, IconBot, IconChat, IconBox,
  IconSparkle, IconLock, IconHeart,
} from '../components/icons';
import { Logo } from '../components/logo';

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

const FEATURES = [
  {
    k: 'PROTOCOL',
    t: 'Balas Semua Paket',
    d: 'keep_alive, tick_sync, move_player, resource pack — semuanya dijawab otomatis, tidak ada disconnect diam-diam.',
    icon: IconServer,
  },
  {
    k: 'AUTH',
    t: 'Microsoft Auth',
    d: 'Device code login sekali klik — code langsung menyatu di link. Refresh token tersimpan aman, offline mode didukung.',
    icon: IconLock,
  },
  {
    k: 'KONTROL',
    t: 'Kontrol Ala Game',
    d: 'D-pad 3×3, look grid, teleport, break & place block, hotbar, chat, dan inventory — semua dari browser HP.',
    icon: IconGrid,
  },
  {
    k: 'MODULES',
    t: 'Modul AFK Cerdas',
    d: 'Anti-AFK humanized, auto-chat, fish farm, break block otomatis, dan inventory manager.',
    icon: IconBot,
  },
  {
    k: 'CHAT',
    t: 'Chat & Riwayat',
    d: 'Kirim pesan dari panel, lihat chat server masuk realtime — bot bisa jadi penerjemah atau penjaga toko.',
    icon: IconChat,
  },
  {
    k: 'INVENTORY',
    t: 'Inventory & Container',
    d: 'Lihat isi inventory bot, pindahkan item, dan kelola chest langsung tanpa buka game.',
    icon: IconBox,
  },
  {
    k: 'GLOBAL CHAT',
    t: 'Global Chat Realtime',
    d: 'Ruang obrolan semua pengguna lewat WebSocket — pesan muncul seketika tanpa refresh, lengkap dengan jumlah yang sedang online.',
    icon: IconChat,
  },
  {
    k: 'LIVE DEPOSIT',
    t: 'Live Deposit',
    d: 'Setiap deposit yang berhasil langsung tampil di dashboard semua orang: "isan#5622 berhasil deposit Rp50.000".',
    icon: IconWallet,
  },
  {
    k: 'BELI BOT',
    t: 'Riwayat Pembelian',
    d: 'Pembelian bot tampil realtime dengan rincian paket: "isans#8064 beli bot1#8064 — 1 hari (Rp3.000)".',
    icon: IconHeart,
  },
];

const PLANS = [
  { nama: 'Harian', harga: 3000, ket: 'Cocok buat nyoba', populer: false },
  { nama: 'Mingguan', harga: 17500, ket: 'Hemat 17%', populer: true },
  { nama: 'Bulanan', harga: 20000, ket: 'Paling murah per hari', populer: false },
];

const LANGKAH = [
  { n: '01', t: 'Buat akun', d: 'Daftar username & password. Kamu otomatis dapat tag unik (#5622) supaya bot tidak tabrakan dengan pengguna lain.' },
  { n: '02', t: 'Isi saldo', d: 'Top up lewat QRIS — scan, bayar, saldo masuk otomatis. Fee transaksi ditanggung kamu, tanpa biaya tersembunyi.' },
  { n: '03', t: 'Tambah bot & sewa', d: 'Isi server Minecraft dan versi (sudah terisi 1.26.30). Pilih paket harian sampai bulanan, saldo langsung terpotong.' },
  { n: '04', t: 'Login Microsoft & jalan', d: 'Klik tombol login, code sudah terisi otomatis. Bot masuk server, dan kontrolnya muncul di panel.' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-fog">
      {/* ===== Header ===== */}
      <header className="sticky top-0 z-40 border-b border-mist/80 bg-fog/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={34} radius={10} />
            <span className="text-lg font-medium tracking-tight text-ink">
              Isan<span className="font-serif italic">C</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#fitur"
              className="hidden rounded-pill px-3 py-2 text-sm text-slate transition-colors hover:bg-mist hover:text-ink sm:block"
            >
              Fitur
            </a>
            <a
              href="#harga"
              className="hidden rounded-pill px-3 py-2 text-sm text-slate transition-colors hover:bg-mist hover:text-ink sm:block"
            >
              Harga
            </a>
            <a
              href="#cara"
              className="hidden rounded-pill px-3 py-2 text-sm text-slate transition-colors hover:bg-mist hover:text-ink md:block"
            >
              Cara Pakai
            </a>
            <Link href="/login" className="btn-ghost px-4 py-2 text-sm">
              Masuk
            </Link>
            <Link href="/dashboard" className="btn-filled px-4 py-2 text-sm">
              Buka Panel
            </Link>
          </nav>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* Wallpaper foto (dari user) + lapisan gelap supaya teks tetap terbaca */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/hero.jpg')" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/55 to-ink/75" aria-hidden />

        <div className="relative mx-auto max-w-[1200px] px-5 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
          <span className="inline-flex items-center gap-2 rounded-pill bg-paper/15 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-paper backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#55db9c]" />
            Bot AFK Minecraft Bedrock
          </span>

          <h1 className="heading-serif mt-7 max-w-3xl text-[38px] leading-[1.1] tracking-[-0.02em] text-paper sm:text-[58px] md:text-[74px]">
            Bot yang <em className="font-serif italic">tetep online</em>,
            ngobrol, &amp; farming buat kamu.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-paper/80 sm:text-lg">
            Panel web untuk mengendalikan bot AFK Minecraft Bedrock. Balas semua paket
            server otomatis, login Microsoft sekali klik, kontrol lengkap dari HP.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="btn-filled bg-paper px-6 py-3 text-sm text-ink">
              Mulai Sekarang <IconArrowRight size={15} />
            </Link>
            <a href="#harga" className="btn-ghost border-paper/40 px-6 py-3 text-sm text-paper hover:bg-paper/10">
              <IconWallet size={15} /> Lihat Harga
            </a>
          </div>

          {/* Statistik singkat */}
          <div className="mt-12 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-card bg-paper/25 backdrop-blur-sm sm:grid-cols-4">
            {[
              { v: '1.26.30', l: 'Versi Bedrock' },
              { v: rupiah(3000), l: 'Mulai / hari' },
              { v: '24 Jam', l: 'Bot Online' },
              { v: 'QRIS', l: 'Bayar Instan' },
            ].map((s) => (
              <div key={s.l} className="bg-ink/45 px-5 py-5">
                <p className="font-mono text-lg font-medium text-paper sm:text-xl">{s.v}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-paper/60">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Kutipan ===== */}
      <section className="mx-auto max-w-[1200px] px-5 py-6 sm:px-6">
        <div className="rounded-card bg-peach p-8 sm:p-11">
          <p className="text-[11px] font-medium uppercase tracking-wider text-sienna/70">
            Kenapa IsanC?
          </p>
          <blockquote className="mt-4 max-w-3xl text-xl leading-relaxed text-sienna sm:text-[26px]">
            &quot;Bot yang balas semua paket server bukan cuma AFK — dia tetep online,
            bisa ngobrol, break block, dan keliatan aktif.&quot;
          </blockquote>
          <div className="mt-6 flex items-center gap-3">
            <Logo size={34} radius={10} />
            <div>
              <p className="text-sm font-medium text-sienna">Tim IsanC</p>
              <p className="text-xs text-sienna/70">Pembuat panel ini</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Fitur ===== */}
      <section id="fitur" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-14 sm:px-6 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ash">Fitur</p>
        <h2 className="heading-serif mt-3 max-w-2xl text-3xl leading-tight sm:text-[40px]">
          Semua yang bot kamu butuhin, dalam satu panel.
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ k, t, d, icon: Icon }) => (
            <article
              key={k}
              className="group rounded-card bg-paper p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-input bg-mist text-ink transition-colors group-hover:bg-ink group-hover:text-paper">
                  <Icon size={19} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-ash">{k}</span>
              </div>
              <h3 className="mt-5 text-base font-medium text-ink">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate">{d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ===== Cara pakai ===== */}
      <section id="cara" className="scroll-mt-20 border-y border-mist bg-paper">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-6 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ash">Cara Pakai</p>
          <h2 className="heading-serif mt-3 max-w-2xl text-3xl leading-tight sm:text-[40px]">
            Empat langkah, bot langsung jalan.
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {LANGKAH.map((s) => (
              <div key={s.n} className="border-t-2 border-ink pt-5">
                <p className="font-mono text-sm font-medium text-ash">{s.n}</p>
                <h3 className="mt-2 text-base font-medium text-ink">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Harga ===== */}
      <section id="harga" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-14 sm:px-6 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ash">Harga</p>
        <h2 className="heading-serif mt-3 max-w-2xl text-3xl leading-tight sm:text-[40px]">
          Bayar sesuai kebutuhan, tanpa langganan wajib.
        </h2>
        <p className="mt-4 max-w-xl text-sm text-slate">
          Semua paket memakai saldo yang kamu isi lewat QRIS. Fee transaksi ditanggung
          kamu — tidak ada potongan tersembunyi.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.nama}
              className={`relative rounded-card p-7 ${
                p.populer ? 'bg-ink text-paper shadow-lg' : 'bg-paper shadow-sm'
              }`}
            >
              {p.populer && (
                <span className="absolute -top-2.5 left-7 rounded-pill bg-peach px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-sienna">
                  Paling Populer
                </span>
              )}
              <p className={`text-sm font-medium ${p.populer ? 'text-paper/70' : 'text-slate'}`}>
                {p.nama}
              </p>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="font-mono text-3xl font-medium">{rupiah(p.harga)}</span>
                <span className={`text-xs ${p.populer ? 'text-paper/60' : 'text-ash'}`}>/ paket</span>
              </p>
              <p className={`mt-2 text-xs ${p.populer ? 'text-paper/70' : 'text-ash'}`}>{p.ket}</p>
              <Link
                href="/dashboard/saldo"
                className={`mt-6 flex w-full items-center justify-center gap-2 rounded-input py-2.5 text-sm font-medium transition-opacity hover:opacity-90 ${
                  p.populer ? 'bg-paper text-ink' : 'bg-ink text-paper'
                }`}
              >
                <IconWallet size={15} /> Isi Saldo
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs text-ash">
          Belum yakin? Mulai dari paket harian {rupiah(3000)} — bisa lanjut kapan saja.
        </p>
      </section>

      {/* ===== CTA ===== */}
      <section className="mx-auto max-w-[1200px] px-5 pb-16 sm:px-6 sm:pb-24">
        <div className="relative overflow-hidden rounded-card bg-ink px-7 py-12 text-center sm:px-12 sm:py-16">
          <span className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-input bg-paper/10">
            <Logo size={40} radius={12} />
          </span>
          <h2 className="heading-serif text-3xl leading-tight text-paper sm:text-[42px]">
            Siap bikin bot kamu online terus?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[#a3a6af]">
            Tambah bot pertamamu, login Microsoft sekali, dan biarkan dia jalan
            24 jam — kamu tinggal pantau dari HP.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard" className="btn-filled bg-paper px-6 py-3 text-sm text-ink hover:opacity-90">
              <IconSparkle size={15} /> Buka Panel
            </Link>
            <Link
              href="/login"
              className="rounded-input border border-paper/20 px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-paper/10"
            >
              Buat Akun Dulu
            </Link>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-mist bg-paper">
        <div className="mx-auto max-w-[1200px] px-5 py-10 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <Link href="/" className="flex items-center gap-2.5">
                <Logo size={32} radius={10} />
                <span className="text-base font-medium tracking-tight text-ink">
                  Isan<span className="font-serif italic">C</span>
                </span>
              </Link>
              <p className="mt-3 text-sm leading-relaxed text-slate">
                Panel kontrol bot AFK Minecraft Bedrock — dibuat untuk yang mau
                tetap online tanpa harus jaga layar.
              </p>
            </div>

            <div className="flex gap-12">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ash">Produk</p>
                <ul className="mt-3 space-y-2 text-sm text-slate">
                  <li><a href="#fitur" className="hover:text-ink">Fitur</a></li>
                  <li><a href="#harga" className="hover:text-ink">Harga</a></li>
                  <li><a href="#cara" className="hover:text-ink">Cara Pakai</a></li>
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-ash">Panel</p>
                <ul className="mt-3 space-y-2 text-sm text-slate">
                  <li><Link href="/login" className="hover:text-ink">Masuk</Link></li>
                  <li><Link href="/dashboard" className="hover:text-ink">Dashboard</Link></li>
                  <li><Link href="/dashboard/saldo" className="hover:text-ink">Isi Saldo</Link></li>
                  <li><Link href="/dashboard/add" className="hover:text-ink">Tambah Bot</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 border-t border-mist pt-6 text-xs text-ash sm:flex-row sm:items-center sm:justify-between">
            <p>
              Dibuat dengan <span className="text-sienna">♥</span> oleh{' '}
              <span className="font-medium text-ink">isan ganteng</span>
            </p>
            <p>© {new Date().getFullYear()} IsanC</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
