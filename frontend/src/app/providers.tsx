'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

// Toasts read the active theme's tokens directly, so they follow every theme.
function ThemedToaster() {
  return (
    <Toaster position="top-right" toastOptions={{
      style: {
        background: 'rgb(var(--surface))',
        color: 'rgb(var(--ink))',
        border: '1px solid rgb(var(--line))',
        borderRadius: '12px',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 12px 32px -12px rgba(0,0,0,0.35)',
      },
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
