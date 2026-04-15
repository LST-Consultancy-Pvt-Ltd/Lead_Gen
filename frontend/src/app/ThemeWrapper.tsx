'use client';
import { useEffect } from 'react';
import { useThemeStore } from '../store/themeStore';

export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    function applyTheme(mode: 'light' | 'dark') {
      if (mode === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
        document.body.style.background = '#060b18';
        document.body.style.color = '#e2e8f0';
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
        document.body.style.background = '#f8fafc';
        document.body.style.color = '#1e293b';
      }
    }

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return <>{children}</>;
}