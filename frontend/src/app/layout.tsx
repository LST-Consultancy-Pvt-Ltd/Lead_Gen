import type { Metadata } from 'next';
import { DM_Sans, Sora } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['400','600','700','800'] });

export const metadata: Metadata = {
  title: 'LeadForge AI — AI-Powered Lead Discovery',
  description: 'Autonomous AI sales intelligence. Discover, research, and reach out to leads automatically.',
  keywords: ['lead generation', 'AI sales', 'B2B leads', 'sales automation'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${sora.variable} font-sans bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
