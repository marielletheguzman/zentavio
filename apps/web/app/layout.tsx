/**
 * The root layout.
 *
 * `next/font/google` **self-hosts** Inter — the files are fetched once at build time and served
 * from this origin, so there is no runtime request to Google, no third-party origin in the CSP, and
 * no user IP handed to a font CDN on page load (ADR-0038). That privacy property is the reason the
 * ADR chose this over a stylesheet link, not a performance one.
 *
 * The font is exposed as a **variable**, never as a class name on `<body>`. `--font-inter` is what
 * `packages/ui/src/tokens.css` reads to build `--font-sans`, which keeps the token layer the single
 * place a typeface is decided (ADR-0023's ownership hierarchy) instead of splitting it between a
 * token file and a layout.
 */

import { Inter } from 'next/font/google';

import { AppShell } from '../components/app-shell.tsx';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  // Text renders in the fallback stack immediately and swaps when Inter arrives. The alternative
  // blocks first paint on a font file, which is a worse failure for the surfaces here — every one
  // of them exists to tell someone where they stand.
  display: 'swap',
});

export const metadata = {
  title: 'Zentavio',
  description: 'Career intelligence — what the platform believes about you, and why.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
