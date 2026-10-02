import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Onest, Unbounded } from 'next/font/google';
import { Nav } from '@/components/nav';
import { SessionProvider } from '@/lib/session';
import { ServiceWorker } from '@/components/service-worker';
import './globals.css';

// next/font скачивает шрифты при сборке и раздаёт их с нашего сервера, без запросов к Google у пользователя.
const onest = Onest({ subsets: ['latin', 'cyrillic'], weight: ['300', '400', '500', '600', '700'], variable: '--font-onest' });
// Unbounded — только для надписи бренда.
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['300', '800'], variable: '--font-unbounded' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Павхелп',
  description: 'Поиск доноров крови для собак и кошек в Петербурге',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'Павхелп', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ECEBE7' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0B0B' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${onest.variable} ${unbounded.variable} ${plexMono.variable}`}>
      <body>
        <SessionProvider>
          <main className="app">{children}</main>
          <Nav />
        </SessionProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
