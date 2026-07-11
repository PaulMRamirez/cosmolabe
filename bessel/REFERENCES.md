# Bessel References

Status: v1.1 (adds the mission-analysis algorithm provenance)
Date: 2026-06-19

Curated sources for the program, grouped by area. Homepages are given where the
canonical URL is stable; otherwise the package or project identifier is given so
it can be resolved on npm, PyPI, or GitHub. Verify versions at build time.

---

## SPICE and NAIF (the geometry source of truth)

- NAIF SPICE tutorials: https://naif.jpl.nasa.gov/naif/tutorials.html
- NAIF Cosmographia page: https://naif.jpl.nasa.gov/naif/cosmographia.html
- SpiceyPy documentation (reference for the Python binding semantics):
  https://spiceypy.readthedocs.io
- CSPICE toolkit: distributed by NAIF; track the current toolkit version when
  updating the WASM fork.

## CSPICE in WebAssembly (the enabling prior art)

- arturania/cspice (CSPICE compiled to WASM via Emscripten, React + Web Worker
  pattern): https://github.com/arturania/cspice

## Mission analysis algorithms (the analysis-engine provenance)

Each analysis engine is validated against an independent reference; the sources
those references come from are grouped here. See docs/STK_PARITY_SPEC.md for the
per-domain validation notes and docs/analysis-tools.md for the per-tool summary.

Astrodynamics and orbit propagation:

- Vallado, "Fundamentals of Astrodynamics and Applications" (two-body, Lambert
  universal-variable, J2 secular theory, time and coordinate systems).
- Vallado et al., "Revisiting Spacetrack Report #3" (AIAA 2006-6753) and Hoots &
  Roehrich, Spacetrack Report No. 3: the SGP4 algorithm and the SGP4-VER
  numerical reference vectors used in the propagator tests.
- Hairer, Norsett & Wanner, "Solving Ordinary Differential Equations I" (the
  Dormand-Prince 5(4) / DOPRI5 tableau and adaptive step control used by the
  Cowell integrator).
- Montenbruck & Gill, "Satellite Orbits: Models, Methods and Applications"
  (Cowell special perturbations, zonal J2/J3/J4, third-body, drag, SRP).

Communications and RF link budgets:

- ITU-R Recommendations P.618 (rain attenuation), P.676 (gaseous attenuation),
  and P.838 (specific-attenuation k/alpha coefficients).
- DSN Telecommunications Link Design Handbook (JPL 810-005) for the link-budget
  conventions and representative DSN station parameters.

Conjunction assessment and SSA:

- Foster & Estes, the 2D probability-of-collision method in the encounter plane.
- NASA CARA (Conjunction Assessment Risk Analysis) Pc methodology notes.

Coverage, maneuvers, and projections:

- Walker, J.G., "Satellite constellations" (Walker Delta/Star geometry).
- Snyder, "Map Projections: A Working Manual" (USGS Professional Paper 1395) for
  the equirectangular, Web Mercator, and polar-stereographic projections.

Interoperability standards (CCSDS):

- CCSDS 502.0-B, Orbit Data Messages (the OEM and OMM message formats).
- CCSDS 504.0-B, Attitude Data Messages (the AEM Attitude Ephemeris Message).
- CCSDS 508.0-B, Conjunction Data Message (CDM).

## Cosmographia (the incumbent and the compatibility target)

- Cosmographia source: https://github.com/claurel/cosmographia
- Cosmographia User's Guide: https://cosmoguide.org
- Cosmographia catalog demos: https://github.com/NablaZeroLabs/cosmo-demos

## Rendering (Three.js and ecosystem)

- Three.js: https://threejs.org
- Babylon.js (evaluated alternative, see ADR-0003): https://babylonjs.com
- awesome-space (index of space-visualization projects and prior art):
  https://github.com/orbitalindex/awesome-space
- CosmoScout VR (DLR), C++ prior art for solar-system rendering:
  https://github.com/cosmoscout/cosmoscout-vr
- spacekit.js, OpenSpace, Celestia, and the NASA PSG Orbits viewer are referenced
  in the gap analysis as prior art; locate via awesome-space above.

## Tri-target delivery (PWA, Capacitor, Electron)

- Capacitor (Ionic): https://capacitorjs.com
- Electron: https://electronjs.org
- electron-vite (recommended desktop toolchain; npm: electron-vite)
- Electron Forge with the Vite plugin (first-party alternative;
  npm: @electron-forge/plugin-vite)
- @capacitor-community/electron (Capacitor-native Electron target, evaluated and
  not selected; npm: @capacitor-community/electron)
- vite-plugin-pwa (service worker and manifest; npm: vite-plugin-pwa)
- Workbox (service-worker library underlying the PWA layer)

## Web platform capabilities (the PAL web implementation)

- Origin Private File System (OPFS) and the File System Access API: see MDN web
  docs for showOpenFilePicker, FileSystemHandle, and navigator.storage.getDirectory.
- HTTP range requests (RFC 7233) for partial kernel loading.

## Interop and adjacent systems

- CesiumJS: https://github.com/CesiumGS/cesium
- CZML: the Cesium interchange format; see the CesiumJS docs for the schema.
- Yamcs (mission control framework): https://yamcs.org
- OpenMCT (NASA): https://github.com/nasa/openmct
- MMGIS (NASA-AMMOS): https://github.com/NASA-AMMOS/MMGIS. The deep-linking
  contract Bessel consumes is docs/pages/Miscellaneous/Deep_Linking/Deep_Linking.md
  in that repository; scripts/fetch-mmgis-reference.sh keeps a local copy.

## Production engineering

- size-limit (bundle budgets; npm: size-limit)
- Lighthouse CI (npm: @lhci/cli)
- changesets (monorepo versioning and changelogs; npm: @changesets/cli)
- axe-core Playwright integration (npm: @axe-core/playwright)
- Developer Certificate of Origin: https://developercertificate.org

## Claude Code and the /goal workflow

- Claude Code overview: https://docs.claude.com/en/docs/claude-code/overview
- Claude Code /goal command (official): https://code.claude.com/docs/en/goal
- Minimum version for /goal: Claude Code v2.1.139 (released May 2026).

## Additional prior art and context

- STK (Ansys), commercial mission analysis reference:
  https://www.agi.com/products/stk
- MIT OPTASAT thesis (referenced in prior Bessel work):
  https://dspace.mit.edu/handle/1721.1/158868

## Prior Bessel design conversations (internal)

- Catalog schema design (this repo): docs/catalog-schema.md and the schema at
  packages/catalog/schema/bessel-catalog.schema.json, with the Cassini-style
  reference instance under examples/.
- Cosmographia for space mission visualization (feasibility and architecture):
  https://claude.ai/chat/dc710066-6c79-4b06-901f-36e46a99c45d
- Cosmographia capabilities and configuration (catalog schema design):
  https://claude.ai/chat/ad11b9b7-2a48-492f-a23f-7631af80a59f
