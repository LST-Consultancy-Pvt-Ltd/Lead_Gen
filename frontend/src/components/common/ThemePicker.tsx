'use client';
// Theme selection UI (compact for the profile menu, full cards for Settings).
// Reads the theme list from src/lib/themes.json, so new themes appear automatically.
import twColors from 'tailwindcss/colors';
import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { THEMES, type ThemeDefinition } from '../../lib/themes';
import { useThemeStore } from '../../store/themeStore';
import { cn } from '../../lib/utils';

const palette = (name: string, shade: number): string =>
  ((twColors as any)[name]?.[shade] as string) ?? '#888888';

function previewColors(t: ThemeDefinition) {
  return {
    canvas: t.surfaces.canvas,
    surface: t.surfaces.surface,
    line: t.surfaces.line,
    ink: t.surfaces.ink,
    muted: t.surfaces['ink-3'],
    primary: palette(t.palettes.primary, 600),
    secondary: palette(t.palettes.secondary, 600),
    tertiary: palette(t.palettes.tertiary, 500),
  };
}

/** Small swatch grid for menus */
export function ThemePickerCompact() {
  const { theme, setTheme } = useThemeStore();
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const c = previewColors(t);
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={t.name}
            onClick={() => setTheme(t.id)}
            className={cn(
              'group flex flex-col items-center gap-1.5 p-1.5 rounded-xl border transition-all',
              active ? 'border-blue-500 bg-blue-500/[0.08]' : 'border-transparent hover:bg-sunken',
            )}
          >
            <span
              className="relative w-full h-8 rounded-lg overflow-hidden ring-1 ring-black/10"
              style={{ background: c.canvas }}
            >
              <span className="absolute left-1.5 top-1.5 right-4 bottom-1.5 rounded-[5px]" style={{ background: c.surface }} />
              <span
                className="absolute right-1 top-1 w-3 h-3 rounded-full"
                style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})` }}
              />
              {active && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-4 h-4 rounded-full bg-white text-blue-600 flex items-center justify-center shadow">
                    <Check size={10} strokeWidth={3} />
                  </span>
                </span>
              )}
            </span>
            <span className={cn('text-[10px] font-semibold leading-none truncate max-w-full', active ? 'text-blue-600 dark:text-blue-400' : 'text-ink-3')}>
              {t.name.split(' ')[0]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Large preview cards for the Settings › Appearance tab */
export function ThemePickerCards() {
  const { theme, setTheme } = useThemeStore();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const c = previewColors(t);
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t.id)}
            className={cn(
              'relative text-left rounded-2xl border-2 p-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20',
              active
                ? 'border-blue-500 shadow-lg shadow-blue-500/15 bg-blue-500/[0.04]'
                : 'border-line bg-surface hover:-translate-y-px hover:border-slate-300 dark:hover:border-white/20 hover:shadow-md',
            )}
          >
            {/* Mini app preview */}
            <div className="rounded-xl overflow-hidden ring-1 ring-black/10" style={{ background: c.canvas }}>
              <div className="flex h-28">
                <div className="w-10 flex flex-col items-center gap-1.5 py-2.5" style={{ background: c.surface, borderRight: `1px solid ${c.line}` }}>
                  <span className="w-5 h-5 rounded-md" style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})` }} />
                  <span className="w-5 h-1.5 rounded-full opacity-60" style={{ background: c.muted }} />
                  <span className="w-5 h-1.5 rounded-full opacity-40" style={{ background: c.muted }} />
                  <span className="w-5 h-1.5 rounded-full opacity-40" style={{ background: c.muted }} />
                </div>
                <div className="flex-1 p-2.5 space-y-2">
                  <div className="h-6 rounded-md" style={{ background: `linear-gradient(110deg, ${c.primary}, ${c.secondary} 60%, ${c.tertiary})` }} />
                  <div className="grid grid-cols-2 gap-1.5">
                    {[c.primary, c.tertiary].map((col, i) => (
                      <div key={i} className="rounded-md p-1.5" style={{ background: c.surface, border: `1px solid ${c.line}` }}>
                        <span className="block w-6 h-1.5 rounded-full mb-1" style={{ background: c.muted, opacity: 0.6 }} />
                        <span className="block w-4 h-2 rounded-sm" style={{ background: col }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <span className="h-4 w-12 rounded-md" style={{ background: `linear-gradient(90deg, ${c.primary}, ${c.secondary})` }} />
                    <span className="h-4 w-10 rounded-md" style={{ background: c.surface, border: `1px solid ${c.line}` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  {t.name}
                  {t.appearance === 'dark' ? <Moon size={12} className="text-ink-3" /> : <Sun size={12} className="text-ink-3" />}
                </p>
                <p className="text-xs text-ink-3 mt-0.5">{t.description}</p>
              </div>
              {active ? (
                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-bold bg-blue-600 text-white flex-shrink-0">
                  <Check size={11} strokeWidth={3} /> Active
                </span>
              ) : null}
            </div>

            {/* Palette dots */}
            <div className="mt-2.5 flex items-center gap-1.5">
              {[c.primary, c.secondary, c.tertiary, c.surface, c.canvas].map((col, i) => (
                <span key={i} className="w-4 h-4 rounded-full ring-1 ring-black/10" style={{ background: col }} />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Rounded tile with three colour pills, used in the theme menu */
function ThemeSwatchTile({ t }: { t: ThemeDefinition }) {
  const c = previewColors(t);
  const pills = [palette(t.palettes.primary, 500), palette(t.palettes.secondary, 300), t.appearance === 'dark' ? t.surfaces.ink : t.surfaces['ink']];
  return (
    <span
      className="flex items-center justify-center gap-1 w-[72px] h-11 rounded-xl ring-1 ring-black/10 flex-shrink-0"
      style={{ background: t.appearance === 'dark' ? c.surface : '#ffffff' }}
    >
      {pills.map((col, i) => (
        <span key={i} className="w-3.5 h-7 rounded-full" style={{ background: col }} />
      ))}
    </span>
  );
}

/** Palette icon button + theme list popover (header) */
export function ThemeMenuButton() {
  const { theme, setTheme } = useThemeStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('btn-ghost w-10 h-10 p-0 justify-center', open && '!border-blue-500/50 !text-blue-600 dark:!text-blue-400')}
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 card !rounded-2xl shadow-2xl shadow-slate-900/15 dark:shadow-black/50 p-3 z-50 animate-fade-in" role="menu">
          <p className="font-display text-base font-semibold text-ink px-1 pb-2.5">Theme</p>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {THEMES.map((t) => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    'w-full flex items-center gap-3.5 p-2 pr-3 rounded-2xl border-2 text-left transition-all duration-150',
                    active
                      ? 'border-blue-500 bg-blue-500/[0.08]'
                      : 'border-transparent bg-sunken dark:bg-white/[0.04] hover:border-line hover:bg-surface-2',
                  )}
                >
                  <ThemeSwatchTile t={t} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold text-ink truncate">{t.name}</span>
                    <span className="block text-xs text-ink-3 mt-0.5 truncate">
                      {t.tagline}{t.appearance === 'dark' ? ' (dark)' : ''}
                    </span>
                  </span>
                  {active && <Check size={18} className="text-blue-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
