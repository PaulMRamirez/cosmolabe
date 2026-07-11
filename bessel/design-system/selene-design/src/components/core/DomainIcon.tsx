import type { CSSProperties, ReactElement } from 'react';

// The bespoke mission-analysis domain icons, original work for Bessel (no third-party
// rights). Each is inline SVG on a 24x24 grid, stroke=currentColor (so it themes with
// the host), drawn to read at 16 to 20px. Separate from the universal Icon (Lucide) so
// the two sets stay independent. Recognizability was validated by a persona blind read
// and a human visual review (FOV reads as a sensor cone, eclipse as a shadowed body,
// conjunction as two converging tracks, walker as orbital rings, not a beaker/eye/x/gear).

const BODIES = {
  'sensor-fov': (
    <>
      <circle cx="12" cy="4" r="1.4" fill="currentColor" stroke="none"/><path d="M12 4 L5.5 16"/><path d="M12 4 L18.5 16"/><path d="M5.5 16 Q12 20 18.5 16"/>
    </>
  ),
  'sensor-footprint': (
    <>
      <path d="M3 8.5 H21"/><ellipse cx="12" cy="15" rx="7" ry="3.4"/><path d="M12 11.6 V18.4 M5 15 H19"/>
    </>
  ),
  'propagate': (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M6.2 8.4 A 8 4.6 0 1 1 5.6 14.6"/><path d="M5.6 14.6 l 2.5 -0.7 M5.6 14.6 l 0.2 -2.6"/>
    </>
  ),
  'eclipse': (
    <>
      <circle cx="10.5" cy="13" r="6"/><path d="M10.5 7 A 6 6 0 0 1 10.5 19 A 3.6 6 0 0 0 10.5 7 Z" fill="currentColor" stroke="none" opacity="0.3"/><circle cx="20" cy="6" r="1.6"/><path d="M20 2.8 V1.6 M23.1 6 H24.3 M22.3 3.7 l 0.8 -0.8"/>
    </>
  ),
  'conjunction': (
    <>
      <path d="M3 6 Q12 13 21 6"/><path d="M3 18 Q12 11 21 18"/><circle cx="12" cy="12" r="2.4"/>
    </>
  ),
  'walker-constellation': (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-35 12 12)"/><circle cx="18.4" cy="8.3" r="1" fill="currentColor" stroke="none"/><circle cx="5.6" cy="8.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="3.2" r="1" fill="currentColor" stroke="none"/>
    </>
  ),
  'ground-track': (
    <>
      <rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M4 13 Q8 8.5 12 12 T20 11"/><circle cx="15.5" cy="11.2" r="1.3" fill="currentColor" stroke="none"/>
    </>
  ),
  'beta-angle': (
    <>
      <line x1="4" y1="18" x2="20" y2="18"/><line x1="4" y1="18" x2="17" y2="7"/><path d="M11 18 A7 7 0 0 0 9.3 13.5"/><circle cx="18.5" cy="5.5" r="2"/>
    </>
  ),
  'coverage-grid': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3 H20 M4 14.6 H20 M9.3 4 V20 M14.6 4 V20" opacity="0.5"/><path d="M9.3 9.3 H14.6 V14.6 H9.3 Z"/>
    </>
  ),
  'porkchop': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5"/><ellipse cx="12" cy="12" rx="6" ry="5" transform="rotate(-25 12 12)"/><ellipse cx="12" cy="12" rx="2.6" ry="2.2" transform="rotate(-25 12 12)"/>
    </>
  ),
  'b-plane': (
    <>
      <ellipse cx="12" cy="12" rx="8" ry="4" transform="rotate(-20 12 12)"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="12" y1="12" x2="17" y2="9"/><path d="M9 2 L12 12 L13 22" stroke-dasharray="2 2"/>
    </>
  ),
} satisfies Record<string, ReactElement>;

export type DomainIconName = 'sensor-fov' | 'sensor-footprint' | 'propagate' | 'eclipse' | 'conjunction' | 'walker-constellation' | 'ground-track' | 'beta-angle' | 'coverage-grid' | 'porkchop' | 'b-plane';

const SIZES = { sm: 16, md: 18, lg: 20 } as const;

export interface DomainIconProps {
  name: DomainIconName;
  size?: number | keyof typeof SIZES;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

/** A bespoke domain-concept icon (FOV cone, footprint, ...). Decorative: aria-hidden,
 *  inheriting color from currentColor; the accessible name lives on the enclosing Button. */
export function DomainIcon({ name, size = 'md', strokeWidth = 1.5, className, style }: DomainIconProps) {
  const px = typeof size === 'number' ? size : SIZES[size];
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ verticalAlign: 'middle', ...style }}
    >
      {BODIES[name]}
    </svg>
  );
}
