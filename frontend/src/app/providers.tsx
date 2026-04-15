'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { useThemeStore } from '../store/themeStore';

function ThemedToaster() {
  const theme = useThemeStore((s) => s.theme);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setIsDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      setIsDark(theme === 'dark');
    }
  }, [theme]);

  return (
    <Toaster position="top-right" toastOptions={{
      style: isDark
        ? { background: '#0d1628', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.1)' }
        : { background: '#ffffff', color: '#1e293b', border: '1px solid #e2e8f0' },
    }} />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ThemedToaster />
    </QueryClientProvider>
  );
}
