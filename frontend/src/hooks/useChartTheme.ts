'use client';
// Chart colours for the active theme. Recharts writes colours into SVG
// attributes, where CSS var() doesn't resolve, so we read the theme tokens
// from <html> and hand back plain hex strings. Re-reads whenever the theme changes.
import { useEffect, useState } from 'react';
import { useThemeStore } from '../store/themeStore';

export interface ChartTheme {
  /** chart-1 … chart-5, then success, warning, danger */
  series: string[];
  axis: string;
  grid: string;
  tick: { fontSize: number; fill: string };
  cursor: { fill: string };
}

function channelsToHex(value: string): string | null {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('');
}

const FALLBACK = {
  series: ['#3b82f6', '#6366f1', '#8b5cf6', '#93c5fd', '#a5b4fc', '#10b981', '#f59e0b', '#f43f5e'],
  axis: '#64748b',
  grid: '#e2e8f0',
};

function build(c: typeof FALLBACK): ChartTheme {
  return { ...c, tick: { fontSize: 11, fill: c.axis }, cursor: { fill: `${c.axis}1f` } };
}

export function useChartTheme(): ChartTheme {
  const theme = useThemeStore((s) => s.theme);
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const get = (name: string) => channelsToHex(cs.getPropertyValue(name));
      const first = get('--chart-1');
      // Stylesheets can arrive after mount (dev / slow networks): retry until tokens resolve
      if (!first) {
        if (tries++ < 60) frame = requestAnimationFrame(read);
        return;
      }
      setColors({
        series: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--success', '--warning', '--danger']
          .map((n, i) => get(n) ?? FALLBACK.series[i]),
        axis: get('--ink-3') ?? FALLBACK.axis,
        grid: get('--line') ?? FALLBACK.grid,
      });
    };
    read();
    // Also follow direct changes to <html data-theme> and late-loading CSS
    const obs = new MutationObserver(() => { tries = 0; read(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    window.addEventListener('load', read);
    return () => {
      cancelAnimationFrame(frame);
      obs.disconnect();
      window.removeEventListener('load', read);
    };
  }, [theme]);

  return build(colors);
}
