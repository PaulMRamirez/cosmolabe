# @bessel/timeline

Time model and playback for Bessel: a subscribable playback clock, a NAIF-style
interval-window algebra, a scalar geometry finder, and timeline annotations. All
time is internally ephemeris time (ET, seconds past J2000); display formatting as
UTC is left to @bessel/spice. This is a core package.

## Public API

Clock and time type:

- `EphemerisTime` (alias for `number`), `ClockState`, `ClockListener`.
- `Clock`: a playback clock the scene subscribes to. `setEpoch`, `setRate`,
  `play`, `pause`, `tick(deltaSeconds)` (advances `et` by `delta * rate` when
  playing), and `subscribe(listener)` returning an unsubscribe function.

Window algebra (mirrors NAIF SpiceCell `wn*` semantics; a `Window` is a sorted,
disjoint, non-abutting list of closed `Interval` `[start, stop]` pairs):

- `EMPTY_WINDOW`, `windowFromIntervals`, `windowInsert`, `windowMeasure`,
  `windowCard`, `windowContains`, `windowUnion`, `windowUnionAll`,
  `windowIntersect`, `windowIntersectAll`, `windowDifference`,
  `windowComplement`, `windowContract`; types `Interval`, `Window`.

Geometry finder and annotations:

- `findConstraintWindow(g, span, step)` with `ConstraintFn`: scans a uniform grid
  for sign changes of `g(et) >= 0` and refines each crossing by bisection into a
  `Window`.
- `sortByEt`, `markerFraction`, type `TimelineAnnotation`.

```ts
const clock = new Clock(0, 60); // epoch ET 0, 60x rate
const stop = clock.subscribe((et) => render(et));
clock.play();
clock.tick(1); // advances ET by 60s, notifies listeners
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer; it imports no other @bessel
package and no concrete PAL implementation, and is the shared time and window
substrate for access, lighting, coverage, conjunction, attitude, and sensor
analyses.

## Tests

Tests live in `packages/timeline/src/*.test.ts`: `window.test.ts` validates the
interval-window operations against hand-computed sets (matching NAIF `wn*`
results), and `annotations.test.ts` covers the annotation helpers.

## Status / limitations

The window algebra is pure and headless and is intended to be cross-checked
against CSPICE `wn*` windows once the GF routines are exported. `Clock.setRate`
notifies listeners only on the next `tick` or `setEpoch`, not immediately.
