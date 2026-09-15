import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';

export const metadata: Metadata = {
  title: 'IsanC — Bot AFK Minecraft Bedrock',
  description:
    'Panel kontrol bot AFK Minecraft Bedrock: chat, farm, break block otomatis, plus sewa bot harian–bulanan dengan pembayaran QRIS.',
  applicationName: 'IsanC',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/logo-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
  keywords: ['isanc', 'bot afk', 'minecraft bedrock', 'afk bot', 'sewa bot minecraft'],
  openGraph: {
    title: 'IsanC — Bot AFK Minecraft Bedrock',
    description: 'Bot AFK Minecraft Bedrock yang tetap online, balas paket server, dan farming otomatis.',
    siteName: 'IsanC',
    type: 'website',
    images: ['/logo.jpg'],
  },
  twitter: { card: 'summary', images: ['/logo.jpg'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
