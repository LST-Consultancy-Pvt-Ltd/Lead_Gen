/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin');
const twColors = require('tailwindcss/colors');
const themeConfig = require('./src/lib/themes.json');

// ── Multi-theme tokens ───────────────────────────────────────────────────────
// Every theme lives in src/lib/themes.json. This plugin turns each entry into
// CSS custom properties under [data-theme="<id>"] (RGB channels, so Tailwind's
// /<alpha> modifiers keep working). The app's accent palettes (blue / indigo /
// violet) and neutral palette (slate) are re-pointed at those variables, so
// existing utility classes follow the active theme without per-file changes.
// Adding a theme = adding one entry to themes.json.

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const ROLES = ['primary', 'secondary', 'tertiary', 'neutral'];
const SURFACES = ['canvas', 'chrome', 'surface', 'surface-2', 'sunken', 'ink', 'ink-2', 'ink-3', 'line'];

function hexToChannels(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function themeVars(t) {
  const vars = { 'color-scheme': t.appearance };
  for (const role of ROLES) {
    const pal = twColors[t.palettes[role]];
    for (const s of SHADES) vars[`--c-${role}-${s}`] = hexToChannels(pal[s]);
  }
  for (const key of SURFACES) vars[`--${key}`] = hexToChannels(t.surfaces[key]);
  const p = twColors[t.palettes.primary];
  const s2 = twColors[t.palettes.secondary];
  const s3 = twColors[t.palettes.tertiary];
  vars['--chart-1'] = hexToChannels(p[500]);
  vars['--chart-2'] = hexToChannels(s2[500]);
  vars['--chart-3'] = hexToChannels(s3[500]);
  vars['--chart-4'] = hexToChannels(p[300]);
  vars['--chart-5'] = hexToChannels(s2[300]);
  vars['--success'] = hexToChannels(twColors.emerald[500]);
  vars['--warning'] = hexToChannels(twColors.amber[500]);
  vars['--danger'] = hexToChannels(twColors.rose[500]);
  return vars;
}

const defaultTheme = themeConfig.themes.find((t) => t.id === themeConfig.default) || themeConfig.themes[0];

const themesPlugin = plugin(({ addBase }) => {
  const base = { ':root': themeVars(defaultTheme) };
  for (const t of themeConfig.themes) base[`[data-theme="${t.id}"]`] = themeVars(t);
  addBase(base);
});

const scale = (role) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${role}-${s}) / <alpha-value>)`]));
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-sora)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Accent + neutral palettes follow the active theme
        blue: scale('primary'),
        indigo: scale('secondary'),
        violet: scale('tertiary'),
        // purple / fuchsia appear as gradient partners of violet — keep them in the same family
        purple: scale('tertiary'),
        fuchsia: scale('tertiary'),
        slate: scale('neutral'),
        primary: { DEFAULT: token('c-primary-600'), ...scale('primary') },
        // Semantic surface / text tokens
        canvas: token('canvas'),
        chrome: token('chrome'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2') },
        sunken: token('sunken'),
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        line: token('line'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        chart: {
          1: token('chart-1'), 2: token('chart-2'), 3: token('chart-3'), 4: token('chart-4'), 5: token('chart-5'),
        },
        brand: { DEFAULT: token('c-primary-600'), light: token('c-primary-400'), dark: token('c-primary-700') },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [themesPlugin],
};
