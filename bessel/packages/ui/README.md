# @bessel/ui

React components, panels, and controls for the Bessel viewer: timeline and camera
controls, object browser and inspector, settings, readouts, analysis charts,
keyboard shortcuts, and screen or video capture. This is the UI layer; it consumes
the core packages and the @bessel/pal interface and is, in turn, mounted by the
shells.

## Public API

- Playback and camera: `TimelineControls`, `ViewControls`, `IntervalTimeline`.
- Browsing and inspection: `ObjectBrowser`, `ObjectInspector`, `SearchBox`,
  `CatalogLoader`, `BookmarksPanel`.
- Panels and chrome: `AppBar`, `PanelContainer`, `SettingsPanel`, `ReadoutPanel`,
  `MeasurePanel`, `OpsPanel`, `ThemeToggle`, `Tooltip`, `KeyboardHelp`.
- Analysis displays: `TimeSeriesChart`, `GroundTrackMap`, `ReportTable`.
- Keyboard shortcuts: `useKeyboardShortcuts` plus the pure `KEYMAP`,
  `resolveAction`, and `isEditableTarget` (Cosmographia-style bindings: space to
  play or pause, arrows to scrub and change rate, `c` to center, `?` for help).
- Capture: `CaptureControls`, `captureStill` (PNG blob), `startRecording` (webm),
  `downloadBlob`, and the typed `CaptureError`.

Each component ships its props type, and accompanying value types are exported
(for example `Readouts`, `VisualizationSettings`, `CatalogEntry`,
`KeyboardAction`, `MissionOption`, `BookmarkItem`, `ThemeName`).

## Dependency rule

Depends on: @bessel/pal, @bessel/spice, @bessel/catalog, @bessel/scene,
@bessel/timeline, @bessel/state, @bessel/color, @bessel/map-projection (plus React
and react-dom as peer dependencies). Part of the UI layer: it imports from core
and the PAL interface, never from a concrete PAL implementation, and the shells
inject a PAL at startup.

## Tests

Tests live in packages/ui/src/*.test.{ts,tsx}: `keymap.test.ts` (action
resolution and editable-target guarding), `capture.test.ts` (still and recording
behavior, loud failures when unsupported), and the component suites
`ui-components.test.tsx`, `shell-components.test.tsx`, and `charts.test.tsx`.

## Status / limitations

The component set is broad but UI-only: it renders state passed in via props and
delegates all geometry, kernels, and persistence to the core packages and the PAL.
Capture relies on browser canvas APIs (toBlob, captureStream, MediaRecorder) and
fails loudly where they are absent.
