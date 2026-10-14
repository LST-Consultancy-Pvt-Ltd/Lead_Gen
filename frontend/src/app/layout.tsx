import type { Metadata } from 'next';
import { DM_Sans, Sora } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ThemeWrapper } from './ThemeWrapper';
import { THEME_BOOT_SCRIPT, DEFAULT_THEME, getTheme } from '../lib/themes';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['400','600','700','800'] });

export const metadata: Metadata = {
  title: 'LeadForge AI — AI-Powered Lead Discovery',
  description: 'Autonomous AI sales intelligence. Discover, research, and reach out to leads automatically.',
  keywords: ['lead generation', 'AI sales', 'B2B leads', 'sales automation'],
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className={getTheme(DEFAULT_THEME).appearance} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint (no flash of the wrong theme) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${dmSans.variable} ${sora.variable} font-sans antialiased`}>
        <Providers>
          <ThemeWrapper>{children}</ThemeWrapper>
        </Providers>
      </body>
    </html>
  );
}
