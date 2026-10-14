'use client';
import { useEffect } from 'react';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { applyThemeToDocument } from '../lib/themes';

// Keeps <html> in sync with the selected theme and switches to the signed-in
// user's own theme on login. The initial theme is applied before paint by
// THEME_BOOT_SCRIPT in the root layout; this handles changes.
export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const activateUser = useThemeStore((s) => s.activateUser);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const authHydrated = useAuthStore((s) => s._hasHydrated);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (authHydrated) activateUser(userId);
  }, [authHydrated, userId, activateUser]);

  return <>{children}</>;
}
