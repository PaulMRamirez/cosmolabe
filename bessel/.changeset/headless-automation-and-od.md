---
"@bessel/sdk": minor
"@bessel/pal-node": minor
"@bessel/od": minor
"@bessel/cli": minor
---

Add the headless automation surface and orbit determination, and ship the CLI as a
real runnable binary.

- `@bessel/sdk`: a programmatic automation facade plus a versioned JSON batch-job IR
  and a headless runner over the Bessel compute core.
- `@bessel/pal-node`: the Node platform IO a shell injects into the headless runner,
  a directory-backed kernel source and a confined artifact writer.
- `@bessel/od`: orbit determination, a Gauss-Newton batch least-squares estimator and
  a sequential extended Kalman filter with analytic range, range-rate, and angle
  measurement models seeded by the propagator State Transition Matrix.
- `@bessel/cli`: the `bessel` headless batch runner now builds to a single bundled
  Node binary (`dist/main.js`) via `pnpm build:cli`, with a smoke test that runs the
  built binary against a fixture job and asserts a written OEM artifact.
