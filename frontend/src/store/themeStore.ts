import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_DARK_THEME, DEFAULT_THEME, THEME_STORAGE_KEY, applyThemeToDocument, getTheme, normalizeThemeId, type ThemeId } from '../lib/themes';

interface ThemeState {
  /** Active theme id (see src/lib/themes.json) */
  theme: ThemeId;
  /** Last dark theme used — the header's quick toggle returns to it */
  lastDarkTheme: ThemeId;
  /** Each signed-in user's own theme choice on this browser (user id → theme id) */
  byUser: Record<string, ThemeId>;
  /** User whose preference is currently applied (null when signed out) */
  activeUserId: string | null;
  setTheme: (theme: ThemeId) => void;
  /** Switch to a signed-in user's saved theme (or the default for a new user) */
  activateUser: (userId: string | null) => void;
}

const darkOr = (id: ThemeId, fallback: ThemeId) => (getTheme(id).appearance === 'dark' ? id : fallback);

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,
      lastDarkTheme: DEFAULT_DARK_THEME,
      byUser: {},
      activeUserId: null,
      setTheme: (theme) => {
        const id = normalizeThemeId(theme);
        applyThemeToDocument(id);
        set((s) => ({
          theme: id,
          lastDarkTheme: darkOr(id, s.lastDarkTheme),
          byUser: s.activeUserId ? { ...s.byUser, [s.activeUserId]: id } : s.byUser,
        }));
      },
      activateUser: (userId) => {
        const s = get();
        if (userId === s.activeUserId) return;
        if (!userId) {
          // Signed out: keep showing the last theme (e.g. on the login page)
          set({ activeUserId: null });
          return;
        }
        const saved = s.byUser[userId];
        // The first user after per-user themes were introduced keeps the theme already
        // in use; any other user without a saved choice starts on the default theme.
        const isFirstEver = Object.keys(s.byUser).length === 0;
        const id = normalizeThemeId(saved ?? (isFirstEver ? s.theme : DEFAULT_THEME));
        applyThemeToDocument(id);
        set({
          activeUserId: userId,
          theme: id,
          lastDarkTheme: darkOr(id, s.lastDarkTheme),
          byUser: { ...s.byUser, [userId]: id },
        });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v0 stored 'light' | 'dark' | 'system'; v1 had no per-user map. Map old or invalid values safely.
      migrate: (persisted: any) => {
        const theme = normalizeThemeId(persisted?.theme);
        return {
          theme,
          lastDarkTheme: darkOr(normalizeThemeId(persisted?.lastDarkTheme ?? theme), DEFAULT_DARK_THEME),
          byUser: {},
          activeUserId: null,
        } as unknown as ThemeState;
      },
      merge: (persisted: any, current) => {
        const theme = normalizeThemeId(persisted?.theme ?? current.theme);
        const byUser: Record<string, ThemeId> = {};
        if (persisted?.byUser && typeof persisted.byUser === 'object') {
          for (const [uid, t] of Object.entries(persisted.byUser)) byUser[uid] = normalizeThemeId(t);
        }
        return {
          ...current,
          theme,
          lastDarkTheme: darkOr(normalizeThemeId(persisted?.lastDarkTheme ?? DEFAULT_DARK_THEME), DEFAULT_DARK_THEME),
          byUser,
          activeUserId: typeof persisted?.activeUserId === 'string' ? persisted.activeUserId : null,
        };
      },
    }
  )
);
