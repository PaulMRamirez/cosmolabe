import type { CSSProperties, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'critical';

interface VariantStyle {
  bg: string;
  fg: string;
  bd: string;
  weight: number;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: { bg: 'var(--amber)', fg: 'var(--bg-0)', bd: 'transparent', weight: 600 },
  secondary: { bg: 'var(--bg-2)', fg: 'var(--ink-1)', bd: 'var(--line)', weight: 500 },
  ghost: { bg: 'transparent', fg: 'var(--ink-1)', bd: 'transparent', weight: 500 },
  critical: { bg: 'var(--red-hot)', fg: 'var(--bg-0)', bd: 'transparent', weight: 600 },
};

export interface ButtonProps {
  children: ReactNode;
  /** primary=amber CTA, secondary=neutral, ghost=bare, critical=emergency (red). One primary per region. */
  variant?: ButtonVariant;
  /** Stretch to container width. */
  full?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  /** Forwarded to the DOM as data-testid (for host-app test hooks). */
  testId?: string;
  /** Extra class names appended to the host element (host-app styling hooks). */
  className?: string;
  /** Native title/tooltip. */
  title?: string;
  /** Accessible name. Required when children render as a glyph/icon only, so the
   *  control is not announced as just its symbol. Falls back to title when unset. */
  ariaLabel?: string;
  /** When true, a control whose only content is a glyph: square footprint, no
   *  horizontal text padding, so iconified actions sit flush in a control row. */
  iconOnly?: boolean;
  /** Reflected as aria-pressed for toggle controls (play/pause, layer toggles). */
  pressed?: boolean;
}

/**
 * Button — the system's action control. Flat, tight-radius. Amber primary,
 * neutral secondary, red critical (emergency only).
 */
export function Button({
  children,
  variant = 'secondary',
  full = false,
  onClick,
  disabled = false,
  style,
  testId,
  className,
  title,
  ariaLabel,
  iconOnly = false,
  pressed,
}: ButtonProps) {
  const v = VARIANTS[variant];
  // An icon-only control must carry an accessible name; warn loudly in development if
  // one ships without ariaLabel or title (the CI axe scan is the hard backstop).
  if (process.env.NODE_ENV !== 'production' && iconOnly && !ariaLabel && !title) {
    console.warn('selene Button: iconOnly requires an ariaLabel (or title) for an accessible name');
  }
  // One name prop yields both the accessible name and the hover/long-press tooltip:
  // default the native title to ariaLabel when a title is not given.
  const resolvedTitle = title ?? ariaLabel;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={className}
      title={resolvedTitle}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      style={{
        height: 'var(--control-lg)',
        padding: iconOnly ? '0' : '0 14px',
        width: iconOnly ? 'var(--control-lg)' : full ? '100%' : 'auto',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-sm)',
        fontWeight: v.weight,
        letterSpacing: '0.02em',
        background: v.bg,
        color: v.fg,
        border: `0.5px solid ${v.bd}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'opacity var(--dur) var(--ease), background var(--dur) var(--ease)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
