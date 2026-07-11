// @bessel/selene-design — design tokens as typed JS, for programmatic consumers
// (e.g. wiring into @bessel/ui's theme, charts, or Three.js materials).
//
// Every value is the CSS-variable *reference* so it resolves against styles.css at
// runtime (themeable). Raw oklch source values live in `tokenValues` for cases where
// you need an actual color (canvas, WebGL, computed math) rather than a CSS var.

export const tokens = {
  surface: {
    app: 'var(--bg-0)',
    panel: 'var(--bg-1)',
    control: 'var(--bg-2)',
    hover: 'var(--bg-3)',
  },
  border: {
    default: 'var(--line)',
    hairline: 'var(--line-soft)',
  },
  text: {
    primary: 'var(--ink-0)',
    secondary: 'var(--ink-1)',
    label: 'var(--ink-2)',
    muted: 'var(--ink-3)',
  },
  accent: {
    primary: 'var(--amber)',
    data: 'var(--cyan)',
    shadow: 'var(--violet)',
  },
  status: {
    nominal: 'var(--green)',
    caution: 'var(--amber-warn)',
    fault: 'var(--red)',
    critical: 'var(--red-hot)',
  },
  asset: {
    rover: 'var(--asset-rover)',
    eva: 'var(--asset-eva)',
    hopper: 'var(--asset-hopper)',
    orbiter: 'var(--asset-orbiter)',
  },
  font: {
    ui: 'var(--font-ui)',
    mono: 'var(--font-mono)',
  },
  radius: {
    xs: 'var(--radius-xs)',
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
  },
  space: {
    2: 'var(--space-2)',
    3: 'var(--space-3)',
    5: 'var(--space-5)',
    7: 'var(--space-7)',
    10: 'var(--space-10)',
  },
} as const;

/** Raw oklch source values — use when a CSS variable can't be resolved (canvas/WebGL/math). */
export const tokenValues = {
  bg0: 'oklch(0.14 0.008 60)',
  bg1: 'oklch(0.18 0.009 60)',
  bg2: 'oklch(0.22 0.010 60)',
  bg3: 'oklch(0.27 0.011 65)',
  line: 'oklch(0.33 0.012 65)',
  lineSoft: 'oklch(0.26 0.010 65)',
  ink0: 'oklch(0.96 0.008 75)',
  ink1: 'oklch(0.78 0.010 70)',
  ink2: 'oklch(0.58 0.012 65)',
  ink3: 'oklch(0.42 0.010 65)',
  amber: 'oklch(0.80 0.15 70)',
  cyan: 'oklch(0.78 0.11 210)',
  violet: 'oklch(0.70 0.13 295)',
  green: 'oklch(0.78 0.14 145)',
  red: 'oklch(0.68 0.19 25)',
  redHot: 'oklch(0.72 0.22 22)',
} as const;

export type Tokens = typeof tokens;
export type TokenValues = typeof tokenValues;
