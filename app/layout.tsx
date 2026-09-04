import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tinyship-kanban.proud-ocean-9488.chatgpt.site'),
  title: 'tinyship — 少开会，多交付',
  description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
  openGraph: {
    title: 'tinyship — 少开会，多交付',
    description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'tinyship — 少开会，多交付',
    description: '为 1–3 人 vibe coding 团队打造的极简 Kanban。',
    images: ['/og.png'],
  },
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
        {children}
      </body>
    </html>
  );
}
