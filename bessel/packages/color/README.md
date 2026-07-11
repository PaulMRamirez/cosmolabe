# @bessel/color

Named color strategies that map a scalar (distance, phase angle, parameter
value) to an RGB color, with a small global registry. This is the home of the
Cosmographia colorScheme / colorByDistance hook (ADR-0006). It is a core-layer
package.

## Public API

Types:

- `Rgb`: a readonly `{ r, g, b }` triple with channel values in `[0, 1]`.
- `ColorStrategy`: has a `name` and a `color(value, domain)` method, where
  `domain` is a `[lo, hi]` tuple.

Functions:

- `linearRamp(name, from, to)`: builds a two-stop linear ramp strategy, clamping
  the normalized scalar to `[0, 1]` (and returning the low stop when `hi === lo`).
- `registerStrategy(strategy)`: adds a strategy to the global registry by name.
- `getStrategy(name)`: looks one up, returning `undefined` if absent.

A `grayscale` strategy (black to white) is registered on import.

```ts
import { getStrategy, linearRamp, registerStrategy } from '@bessel/color';

registerStrategy(linearRamp('heat', { r: 0, g: 0, b: 1 }, { r: 1, g: 0, b: 0 }));
const heat = getStrategy('heat')!;
const c = heat.color(7.5e8, [5e8, 1.5e9]); // Rgb, t-clamped to [0, 1]
```

## Dependency rule

Depends on: nothing (pure). Part of the core layer; it imports no other
`@bessel` package and no concrete PAL implementation.

## Tests

No tests yet (`packages/color/src/` contains only `index.ts`). The ramp math
(linear interpolation, clamping, the `hi === lo` guard) and registry behavior
are the natural units to cover when tests are added.

## Status / limitations

Minimal: a single `grayscale` strategy and a two-stop `linearRamp`. Multi-stop
ramps, categorical schemes, and the full Cosmographia colorScheme parsing are
not yet implemented.
