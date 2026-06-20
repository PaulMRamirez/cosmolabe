// Timeline annotations: event markers on the mission timeline. The data model and
// its pure helpers live in core (no UI import); @bessel/ui renders the markers.

export interface TimelineAnnotation {
  readonly id: string;
  /** Ephemeris time of the event. */
  readonly et: number;
  readonly label: string;
  readonly kind?: 'event' | 'maneuver' | 'observation';
}

/** Sort annotations by ascending ephemeris time (stable, non-mutating). */
export function sortByEt(annotations: readonly TimelineAnnotation[]): TimelineAnnotation[] {
  return [...annotations].sort((a, b) => a.et - b.et);
}

/** Fractional position (0..1) of an et within [min, max], clamped to the ends. */
export function markerFraction(et: number, min: number, max: number): number {
  if (max <= min) return 0;
  const f = (et - min) / (max - min);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** A trajectory arc's [start, stop] ephemeris bounds, the source of boundary markers. */
export interface ArcBounds {
  /** Arc start (ET seconds past J2000). */
  readonly start: number;
  /** Arc stop (ET seconds past J2000). */
  readonly stop: number;
}

/**
 * Annotations at the boundaries of trajectory arcs: each arc contributes a start
 * marker, and the final arc additionally contributes a stop marker, so a multi-arc
 * mission shows where its segments begin and the trajectory ends. The first start
 * is the mission start ('event'); interior arc starts are 'maneuver' (arc
 * transitions are typically burns); the final stop is the mission end ('event').
 */
export function arcBoundaryAnnotations(arcs: readonly ArcBounds[]): TimelineAnnotation[] {
  const out: TimelineAnnotation[] = [];
  arcs.forEach((arc, i) => {
    const isFirst = i === 0;
    out.push({
      id: `arc-${i}-start`,
      et: arc.start,
      label: isFirst ? 'Mission start' : `Arc ${i + 1} start`,
      kind: isFirst ? 'event' : 'maneuver',
    });
  });
  const last = arcs[arcs.length - 1];
  if (last) {
    out.push({ id: 'arc-end', et: last.stop, label: 'Mission end', kind: 'event' });
  }
  return out;
}
