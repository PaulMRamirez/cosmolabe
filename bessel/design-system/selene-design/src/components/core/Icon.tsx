import type { CSSProperties } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Circle,
  Square,
  Share2,
  Copy,
  X,
  Pin,
  Settings,
  Pencil,
  Trash2,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  Download,
  RotateCcw,
  Sun,
  Moon,
  HelpCircle,
  LineChart,
  BarChart3,
  Table,
  Camera,
  Radar,
  type LucideIcon,
} from 'lucide-react';

// The universal-action icon registry. An EXPLICIT static map (not dynamic lookup) so
// Rollup tree-shakes any unused icon out of the bundle: only the glyphs named here
// ship. These are the broadly-accepted action icons (Lucide, ISC); the bespoke domain
// concepts (FOV cone, footprint, ...) live in a separate lazy registry so they ride
// the analysis chunk, not the first-paint shell.
const ICONS = {
  play: Play,
  pause: Pause,
  'step-back': SkipBack,
  'step-forward': SkipForward,
  record: Circle,
  stop: Square,
  share: Share2,
  copy: Copy,
  close: X,
  pin: Pin,
  settings: Settings,
  edit: Pencil,
  trash: Trash2,
  search: Search,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  download: Download,
  reset: RotateCcw,
  sun: Sun,
  moon: Moon,
  help: HelpCircle,
  chart: LineChart,
  'bar-chart': BarChart3,
  table: Table,
  camera: Camera,
  radar: Radar,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

const SIZES = { sm: 16, md: 18, lg: 20 } as const;

export interface IconProps {
  /** A registered universal-action icon name. */
  name: IconName;
  /** Pixel size, or a control-grid token (sm=16, md=18, lg=20). Default md. */
  size?: number | keyof typeof SIZES;
  /** Stroke weight; matches the selene hairline default. */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Icon: an inline SVG glyph that inherits color from `currentColor` (so it themes
 * across dark and the warm-amber light theme with no color prop) and sizes to the
 * control grid. It is always decorative: aria-hidden, contributing no accessible
 * name. The name lives on the enclosing Button (its ariaLabel). No icon font, no
 * sprite, no runtime fetch: just the inline SVG path bytes.
 */
export function Icon({ name, size = 'md', strokeWidth = 1.5, className, style }: IconProps) {
  const Glyph = ICONS[name];
  const px = typeof size === 'number' ? size : SIZES[size];
  return (
    <Glyph
      size={px}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable={false}
      className={className}
      // verticalAlign keeps the glyph centered when it sits inline (a text-baseline
      // child would drop by the descender); harmless inside a flex control row.
      style={{ verticalAlign: 'middle', ...style }}
    />
  );
}
