import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { recoverySnapshot } from '@/lib/recovery';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_APP_ORIGIN ?? 'https://kanby.dev'),
  title: 'Kanby — 少开会，多交付',
  description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
  openGraph: {
    title: 'Kanby — 少开会，多交付',
    description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kanby — 少开会，多交付',
    description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f3ee',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {recoverySnapshot() && (
          <output className="block border-b border-amber-300 bg-amber-100 px-4 py-3 text-center text-sm text-amber-950">
            只读恢复预览 · {recoverySnapshot()} · 非最新数据，暂不支持修改和同步
          </output>
        )}
        {children}
      </body>
    </html>
  );
}
