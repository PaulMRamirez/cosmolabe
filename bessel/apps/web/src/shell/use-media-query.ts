// Subscribes to a CSS media query via matchMedia, using the useSyncExternalStore
// contract so the dock can switch between the side-by-side and stacked layouts
// responsively without effect churn.

import { useSyncExternalStore } from 'react';

/** The viewport width below which the chrome collapses: the panel rail becomes a
 *  drawer and the top-bar menus fold behind a More overflow. One source of truth so
 *  both collapse decisions agree on what "narrow" means. */
export const NARROW_MEDIA_QUERY = '(max-width: 820px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void): (() => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
  const getSnapshot = (): boolean => window.matchMedia(query).matches;
  // Server snapshot: default to the wide layout.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
