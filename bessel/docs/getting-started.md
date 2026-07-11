# Getting Started: Load, Explore, Analyze, Export

This is the task-oriented on-ramp: from a fresh checkout to a real analysis
result and an exported file. It assumes only Node.js 22 LTS and pnpm 9+. For the
toolchain-heavy steps (rebuilding CSPICE-WASM, regenerating kernel fixtures) see
docs/build-from-source.md. For the full reference on each analysis tool see
docs/analysis-tools.md.

## 1. Install and run

```
pnpm install
pnpm --filter @bessel/web dev
```

Open the printed local URL. The app boots into a neutral inner-solar-system
scene: the Sun and planets from the bundled demo ephemeris, no mission baked in.
The boot is offline-capable; CSPICE runs as WebAssembly in a Web Worker, so
kernel loading and geometry never block the UI.

## 2. The layout

The shell has four regions:

- Left: the Objects panel, a filter box, the view-preset and camera-mode
  controls, and the object browser (select, toggle visibility, center).
- Center: the 3D viewport, a status line, instrument/track/share controls, a
  Layers popover and a `?` help button (top-right), and, when something is
  selected, an inspector card (identity, readouts, measurement).
- Top bar: the Mission, Plugins, Capture, Script, and Views menus, the **Analyze**
  toggle (which opens the right-side analysis dock), and the theme toggle.
- Bottom: the timeline (play/pause, rate, scrub, event annotations).

Press `?` (or the help button) for the keyboard-shortcut overlay.

## 3. Load a mission

Open the Mission menu. There are three ways in:

- One-click sample: "Load Cassini at Saturn" loads
  `apps/web/public/samples/cassini-saturn.json`, a native catalog that drives the
  full Cassini-at-Saturn scene (Saturn globe with rings and an atmosphere, the
  Cassini trajectory and glTF model, and the ISS wide-angle field-of-view cone and
  footprint) entirely from catalog data.
- Load catalog: pick a Cosmographia or native Bessel catalog JSON file.
- Drag and drop a catalog JSON onto the window.

A loaded native catalog rebuilds the rendered scene generically. Missing kernels,
unresolved bodies, and bad catalog references fail loudly with a located error;
the kernels a mission needs must be furnished (the bundled demo kernels cover the
inner system, Saturn, and Cassini). See docs/catalog-schema.md to author your own.

## 4. Explore

- Navigate: drag to orbit, right-drag or shift-drag to pan, wheel to dolly toward
  the cursor, pinch on touch. In free-fly mode use `W A S D` to translate and
  `Q E` to move up/down; `,` and `.` roll; `-` and `=` change the field of view.
- Camera modes (left panel): orbit, sync-orbit (locks to a body-fixed frame), and
  free-fly. Track follows the spacecraft. View presets: top-down, from the Sun,
  along the velocity vector.
- Select: click a body or spacecraft to select and center it; the inspector card
  shows its identity and readouts (range, altitude, phase/incidence/emission).
- Drive time: play/pause, change the rate, and scrub on the timeline; event
  annotations (e.g. Saturn orbit insertion) are clickable.
- Layers: the top-right Layers popover toggles trajectories, orbits, labels, the
  field-of-view cone, the footprint, axes, the star field, the atmosphere, and
  shadows.
- Measure: select two objects to read their distance, relative speed, and angular
  separation in the measure panel.

## 5. Run your first analysis

All analysis lives in one dock. Click the **Analyze** toggle in the top bar to open
the right-side Analyze workbench. It is pinnable and tabbed (it does not auto-dismiss,
so results survive canvas clicks and timeline scrubbing). It has six domain tabs,
**Orbit & Maneuver**, **Lighting & Geometry**, **Access & Comms**, **Conjunction**,
**Coverage & Constellation**, and **Report & Compare**, and every analysis follows the
same flow: set the Scenario context once, pick a tab, expand a TaskCard, configure,
run, and interpret the inline result.

1. **Set the Scenario context.** The context bar at the top of the dock drives every
   tab: it shows the live timeline epoch (toggle UTC vs TDB), the analysis Span (days)
   and Step (s), the default Target and Observer (from the loaded objects), the SPICE
   Frame, and a ground-station registry (add a station by name, lon, lat, alt, and
   min-elevation mask, then select the active one). Set these once; the tasks read
   them by role.
2. **First analysis, eclipse.** Open the **Lighting & Geometry** tab and expand the
   "Eclipse phases" TaskCard. Run it: Bessel computes the umbra / penumbra / annular /
   sunlit windows over the span and shows them as a timeline with per-day duration.
   Use "Show in scene" or scrub to an event boundary to see it on the globe.
3. **Or propagate.** Open the **Orbit & Maneuver** tab and expand "Propagate orbit
   (SGP4 / HPOP)". On the spacecraft-source control either paste your own two-line
   element set (it is parsed and validated on apply; a bad TLE surfaces a located
   error, this replaces the former hardcoded sample TLE) or pick a loaded scene
   object. Run "Propagate (SGP4)" and "Propagate numerically (HPOP)" with a force-model
   selector (point-mass / J2 / NxN gravity / drag / SRP); the two altitude series
   overlay so you can read the divergence, alongside the ground track and orbit period.
4. **Keep, compare, export.** Each result block has a Keep control (it lands in the
   compare tray on the Report & Compare tab) and a CSV export; the trajectory exports
   to a CCSDS OEM and a screened conjunction event exports a CDM.

For depth, the **Report & Compare** tab's Data-provider report card is the
parameterized path: pick a provider (range, range rate, speed, position, velocity,
sub point), an observer/target pair, a frame, and a time grid, then run one job to get
a unit-tagged report table and a CSV. For the full per-card walkthroughs see
docs/analysis-workbench.md (structure and shared controls) and
docs/analysis-personas.md (per-perspective use cases).

## 6. Save and share

- Views menu: save the current camera/epoch/selection as a bookmark.
- Share view: writes the full view state into the URL fragment and copies the
  link; anyone who opens it sees the exact moment and viewpoint (the same `v=1`
  contract MMGIS links to; see docs/integrations.md).
- Capture menu: save a PNG still or record a WebM of the viewport.

## 7. Next steps

- docs/analysis-tools.md: what each tool computes, its inputs, validation, and
  limits (and the honest-limits note on the fixed-parameter demo buttons).
- docs/architecture.md: how the 24-package monorepo fits together.
- docs/catalog-schema.md: authoring your own missions.
- docs/build-from-source.md: building all three targets and relinking CSPICE-WASM.
