// Theme registry for the UI. The source of truth is ./themes.json, which the
// Tailwind plugin (tailwind.config.js) also reads to generate the CSS tokens.
import themeConfig from './themes.json';

export type ThemeAppearance = 'light' | 'dark';

export interface ThemeDefinition {
  id: string;
  name: string;
  /** Short palette summary shown in the theme menu, e.g. "Cream + coral" */
  tagline: string;
  description: string;
  appearance: ThemeAppearance;
  palettes: { primary: string; secondary: string; tertiary: string; neutral: string };
  surfaces: Record<string, string>;
}

export const THEMES: ThemeDefinition[] = themeConfig.themes as ThemeDefinition[];
export type ThemeId = string;
export const DEFAULT_THEME: ThemeId = themeConfig.default;
/** Dark theme used when the quick toggle / migration needs a dark fallback */
export const DEFAULT_DARK_THEME: ThemeId = (themeConfig.themes as ThemeDefinition[]).find((t) => t.appearance === 'dark')?.id ?? DEFAULT_THEME;
export const THEME_STORAGE_KEY = 'leadforge-theme';

export function getTheme(id: string | null | undefined): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME) ?? THEMES[0];
}

/** Maps legacy / unknown stored values ('dark' | 'light' | 'system' | junk) to a valid theme id. */
export function normalizeThemeId(value: unknown): ThemeId {
  if (typeof value === 'string') {
    if (THEMES.some((t) => t.id === value)) return value;
    if (value === 'dark') return 'midnight';
    if (value === 'light') return 'light';
    if (value === 'system' && typeof window !== 'undefined') {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'midnight' : 'light';
    }
  }
  return DEFAULT_THEME;
}

/** Applies a theme to <html>: data-theme for tokens, dark/light class for existing dark: utilities. */
export function applyThemeToDocument(id: ThemeId) {
  if (typeof document === 'undefined') return;
  const t = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.classList.toggle('dark', t.appearance === 'dark');
  root.classList.toggle('light', t.appearance === 'light');
  root.style.colorScheme = t.appearance;
}

/**
 * Inline script for <head>: applies the stored theme before first paint so there
 * is no flash of the wrong theme. Kept dependency-free and defensive.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var T=${JSON.stringify(THEMES.map((t) => [t.id, t.appearance]))};
var D=${JSON.stringify(DEFAULT_THEME)};
var raw=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var v=null;try{v=JSON.parse(raw||'null');v=v&&v.state?v.state.theme:null}catch(e){}
if(v==='dark')v='midnight';
if(v==='system')v=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?'midnight':'light';
var m=null;for(var i=0;i<T.length;i++){if(T[i][0]===v)m=T[i]}
if(!m){for(var j=0;j<T.length;j++){if(T[j][0]===D)m=T[j]}}
var r=document.documentElement;r.setAttribute('data-theme',m[0]);
r.classList.add(m[1]);r.classList.remove(m[1]==='dark'?'light':'dark');r.style.colorScheme=m[1];
}catch(e){}})();`;
