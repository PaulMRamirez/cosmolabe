// react-resizable-panels consumes defaultSize only at mount and renormalizes from the
// last sizes afterward, so toggling the right (Analyze) column off would keep the old
// split instead of letting the canvas reclaim the full width. The fix keys the
// PanelGroup by the right column's presence so it remounts with the correct defaults.
// We assert the key here (no DOM): a different key forces React to remount.

import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';

// Force the wide (side-by-side) layout so DockLayout returns the PanelGroup, not the
// narrow drawer.
vi.mock('./use-media-query.ts', () => ({
  NARROW_MEDIA_QUERY: '(max-width: 820px)',
  useMediaQuery: () => false,
}));

const { DockLayout } = await import('./DockLayout.tsx');

describe('DockLayout PanelGroup remount key', () => {
  it('keys the PanelGroup by the right column presence so toggling remounts it', () => {
    const withRight = DockLayout({ left: 'L', center: 'C', right: 'R' }) as ReactElement;
    const withoutRight = DockLayout({ left: 'L', center: 'C' }) as ReactElement;
    // The two configurations must carry different keys, which is what forces a remount
    // (and a re-read of defaultSize) when the right column toggles.
    expect(withRight.key).not.toBe(withoutRight.key);
    expect(withRight.key).toBeTruthy();
    expect(withoutRight.key).toBeTruthy();
  });

  it('renders the center panel at the full-width default when the right column is absent', () => {
    const withoutRight = DockLayout({ left: 'L', center: 'C' }) as ReactElement;
    const panels = (withoutRight.props as { children: unknown[] }).children;
    // Find the order-2 center panel and confirm its defaultSize is the no-right 80.
    const flat = panels.flat(Infinity).filter(Boolean) as { props?: Record<string, unknown> }[];
    const center = flat.find((c) => c?.props && c.props.order === 2);
    expect(center?.props?.defaultSize).toBe(80);

    const withRight = DockLayout({ left: 'L', center: 'C', right: 'R' }) as ReactElement;
    const panels2 = (withRight.props as { children: unknown[] }).children;
    const flat2 = panels2.flat(Infinity).filter(Boolean) as { props?: Record<string, unknown> }[];
    const center2 = flat2.find((c) => c?.props && c.props.order === 2);
    expect(center2?.props?.defaultSize).toBe(56);
  });
});
