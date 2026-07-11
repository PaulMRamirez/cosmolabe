# @bessel/state

The application view model and its lossless URL-fragment serialization (SPEC 5.5, ADR-0008), plus a small set of suite-interop adapters (MMGIS deep links, CZML export, real-time telemetry). A core package: pure functions and types over the view model and trajectory samples, with no SPICE, Three.js, or PAL dependency.

## Public API

View model and codec:

- `ViewModel`, `CameraPose`, `CameraMode` types, plus `VIEW_VERSION` and `DEFAULT_VIEW`.
- `encodeView(view)` / `decodeView(fragment)`: encode a view to a compact URL fragment (no leading `#`) and decode it back. The epoch `t` is ISO 8601 UTC; encode then decode is the identity.

Suite interop:

- `buildMmgisUrl(config, handoff)` with `MmgisMissionConfig`, `MmgisHandoff`: outbound MMGIS deep link; the `mapLon`/`mapLat`/`mapZoom` triple is always sent together, zoom derived from footprint angular size when absent.
- `exportCzml(options)` with `CzmlOptions`, `CzmlSample`: export a trajectory window as a CZML document for CesiumJS (km samples converted to metres).
- `TelemetryAdapter`, `TelemetryError`, `parseTelemetryMessage`, `residualKm`, with `SocketLike`, `TelemetrySample`, `PredictedVsActual`, `Vec3`: a transport-neutral predicted-versus-actual overlay over a WebSocket-like source.

```ts
import { DEFAULT_VIEW, encodeView, decodeView } from '@bessel/state';

const fragment = encodeView(DEFAULT_VIEW);
const view = decodeView(fragment); // round-trips losslessly
```

## Dependency rule

Depends on: nothing (pure; only a `fast-check` devDependency for property tests). Part of the core layer.

## Tests

Tests live in `packages/state/src/state.test.ts` (view round-trip including a `fast-check` property test that `decode(encode(v))` is the identity, prototype-pollution safety on hostile fragments, MMGIS URL shape, and CZML output) and `packages/state/src/telemetry.test.ts` (message parsing, residual distance, and the predicted-versus-actual pairing).

## Status / limitations

Codec is at `VIEW_VERSION = 1`; older fragments would need explicit migration. The telemetry adapter is an internal predicted-versus-actual overlay and does not transform frames or convert times itself; callers supply the predictor and consistent frames.
