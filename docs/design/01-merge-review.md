# Bessel + Cosmolabe: Independent Review of the Combination Strategy

Date: 2026-07-09
Reviewer: Claude, for Paul Ramirez
Inputs: Aaron Plave's comparison document (bessel-comparison.md, 2026-07-09), Bessel's design history (catalog schema, parity matrix, kernel architecture decision, ADR set), and primary-source verification of the external claims (NAIF, NASA-AMMOS repositories, package registries).

---

## 1. Verdict

Aaron's core thesis survives independent scrutiny: the two projects are complementary halves of one product, the packages-first decomposition is the right delivery shape, and "one engine behind two shells" (standalone app plus framework-agnostic embed) is the correct product geometry. Every externally checkable claim in his document verified against primary sources: the Cosmographia gap, the shared 3DTilesRendererJS lineage with MMGIS, the timecraftjs precedent and its limits, and the strict-layering claim about Bessel's own package set. Of his five recommendation points, four stand as written.

Four amendments, in descending order of consequence. First, "the only real work is re-pointing cosmolabe's core at that SPICE layer" understates the project's single highest-risk seam; the re-point should be gated by a differential validation harness, not treated as a mechanical refactor. Second, the spine choice (cosmolabe's core and rendering) is plausibly right but should be ratified by a short precision and performance bake-off, and regardless of whose scene code wins, semantic authority over time and frames must move down into the SPICE layer. Third, dual Three plus Cesium rendering should be demoted from a peer commitment to tiered backends behind a renderer interface. Fourth, three workstreams are absent from the plan and will surface as schedule surprises if not named now: kernel data logistics, cross-origin isolation strategy for embedding, and a typed analysis-product schema with provenance.

On the naming question: both names survive, cleanly, because they name different layers. Cosmolabe is the instrument (the app, the panel, the visible brand); Bessel is the compute identity (the engine suite, the SDK, the CLI binary). Aaron's neutral-scope point for the published libraries is correct and fully compatible with that split. Section 6 develops this.

---

## 2. What independently checks out

**The Cosmographia gap is real.** SPICE-enhanced Cosmographia remains a desktop Qt application on the VESTA rendering library, distributed as installers in the 528 to 636 MB range, requiring local SPICE data, with release 4.2 as the current version and a cadence of roughly one release a year at its fastest (4.1 in February 2022, 4.2 in December 2022). Sources: [naif.jpl.nasa.gov/naif/cosmographia.html](https://naif.jpl.nasa.gov/naif/cosmographia.html), [cosmos.esa.int/web/spice/cosmographia](https://www.cosmos.esa.int/web/spice/cosmographia). A zero-install, browser-native tool that adds validated analysis on top of visualization is a genuinely open lane, and Bessel's parity matrix (derived from the cosmoguide.org navigation tree) already gives the merged product a checkable definition of "replacement."

**The MMGIS lineage claim is confirmed, and it matters.** [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) is NASA-AMMOS's actively maintained Three.js 3D Tiles renderer (v0.4.x releases in 2026, 2.3k stars, a growing plugin ecosystem including image overlay and WMTS plugins and adjacent atmosphere work). [LithoSphere](https://github.com/NASA-AMMOS/LithoSphere) is Three.js-based and was spun out of MMGIS itself, and MMGIS documents its 3D Tiles support via 3DTilesRendererJS. So "embed our engine inside MMGIS as its 3D view" is technically grounded, not aspirational. From the Bessel side, ADR-0008 already codifies the loose coupling mode with deep-link parameters extracted from the actual MMGIS repository, so both coupling modes Aaron names have prior work behind them. Given who funds MMGIS, the tight mode has a real decision path; Aaron's caveat to route through the existing PlanDev-MMGIS integration effort rather than forking a parallel one is the right discipline.

**CSPICE-WASM canonicalization is the correct call, with demonstrated demand.** [timecraftjs](https://github.com/NASA-AMMOS/timecraftjs) is AMMOS's own CSPICE-via-Emscripten library, but it is scoped to time conversion, its npm release is v2.0.0 from roughly four years ago, and its repository carries a still-open 2020 issue asking for spkezr, pxform, sxform and related state functions that never landed. Bessel's full-surface typed layer with worker pool and zero-copy batch is precisely the missing piece, and publishing it standalone serves an audience AMMOS itself already identified. The npm name `cspice-wasm` is unclaimed as of this review.

**The PlanDev source-of-truth layering is right.** Authoritative planning quantities come from the mission model in the sim dataset; the panel renders those and computes only interactive, exploratory quantities; consistency with Java mission models is bought with shared kernels and published validation vectors rather than cross-runtime coupling. This is the same authority discipline that already works elsewhere in the portfolio (ephemeral versus durable Grafana dashboards, MMGIS computed layers with explicit provenance), and Section 3.4 proposes making it enforceable at the type level instead of by convention.

**The package tiers and reuse matrix are sound.** They inherit Bessel's existing strict layering, and the observation that the pure zero-dependency packages (interop, rf, conjunction math, map-projection) are the cheapest community wins is correct: CCSDS parsing in particular is the kind of package aerospace developers adopt without adopting anyone's app.

---

## 3. Where the plan needs sharpening

### 3.1 The SPICE seam is the risk center, not a line item

"Re-point cosmolabe's ~50 SPICE calls" is a call-site count, not a semantics count. What actually has to reconcile when two independently evolved cores meet at one SPICE layer: time scale and epoch conventions at every boundary (ET/TDB internally, UTC at the edges, and where exactly the conversion happens); frame graph construction, chaining, and naming; aberration correction defaults, because NONE versus LT versus LT+S varies per call site and silently changes geometry by real kilometers; unit conventions (SPICE kilometers, Three.js scene units, Cesium ECEF meters); interpolation and caching policy across animation frames; kernel lifecycle (furnish and unload ordering against a worker pool's state); and error surfaces. Both cores can be individually correct and still disagree.

Prescription: define the seam as two explicit contracts before any code moves. A `StateProvider` contract, batched by design: (targets, observer, epochs, frame, correction) to states. A frames-and-time service owning the frame graph and epoch conversions. Both live in the spice/frames tier and are the only way the scene model obtains geometry. Then build a differential harness: cosmolabe's current path versus Bessel's layer, run over a golden scenario set (heliocentric cruise, planetary orbiter, a surface site, Earth LEO), asserting position and orientation deltas under tolerance in CI. The swap happens when the harness is green, converting the riskiest step of the merge from a refactor into a measured migration. The harness is not throwaway: it becomes the permanent conformance suite for the published `cspice-wasm` package.

### 3.2 Ratify the spine with a bake-off; move semantic authority regardless

Aaron's reasons for the cosmolabe spine are plausible: a genuinely zero-render core, an existing Aerie panel commitment, and best-in-class visualization. Two checks are cheap and worth running before the decision is written into an ADR. One: precision handling. Deep-space scenes at heliocentric distances stress float32; whichever core has the better camera-relative origin management, depth strategy, and jitter behavior at the four golden scenes should win, and Bessel's scene was built against SPICE truth from day one, so this is not a foregone conclusion. Two: framework independence in fact, not intent; no Svelte reactivity or lifecycle assumptions leaking into the model layer.

Independent of the outcome, one thing moves by design rather than by bake-off: the scene consumes frames, epochs, and states from the spice/frames tier and never defines its own conventions. "Spine" should mean the object model and render architecture, not ownership of time and frames. Aaron's document already concedes the SPICE layer to Bessel; the concession should explicitly include the frame graph and time service, because that is where the semantic disagreements of 3.1 get settled once instead of per call site.

### 3.3 Renderer strategy: tiers, not peers

A permanent dual Three plus Cesium commitment doubles the render maintenance surface forever, and the reasons to carry Cesium are shrinking: the 3DTilesRendererJS ecosystem is actively absorbing the terrain streaming, image overlay, and globe jobs Cesium historically owned, and the merged product's two most important hosts (the Aerie panel with its weight budget, and MMGIS with its Three.js lineage) both want the Three path. Recommendation: the renderer becomes a capability boundary behind an interface; Three is tier 1 and required; Cesium ships as an optional backend package that must earn its keep per release on bundle weight, WebGL context behavior inside embeds, and zero coupling to Cesium ion services. CZML export (already in the interop tier) covers the "we need Cesium interop" story without carrying the renderer. If the ray-marched atmosphere and terrain streaming are Three-side work, as the comparison implies, tiering costs little and buys a much smaller permanent surface.

### 3.4 A compute plane, not library calls

"Worker-backed and cancellable" should be formalized into a contract: every engine runs behind one typed job protocol (submit, progress, partial results, cancel) that is identical across the panel, the standalone app, the SDK, and the CLI. On top of it, define `AnalysisProduct` as a schema: interval sets, time series, geometry layers, and scalar fields, each carrying provenance (engine and version, kernel set hash, frame and correction conventions, computation time). Provenance is what makes Aaron's source-of-truth rule enforceable at the type level: in PlanDev, an exploratory overlay is visibly and machine-readably non-authoritative rather than politely assumed to be. It also gives the visualization a single generic path for rendering any engine's output, so a new engine needs no renderer work, and it gives the CLI and SDK their file and object formats for free. This is one schema with three consumers, and it should exist before the engines are wired into the merged app rather than after.

### 3.5 Missing workstream: kernel logistics

"Everything runs in the browser, no server" is the right default posture and the wrong complete answer. Bessel's own kernel architecture decision landed on a hybrid for good reasons: HTTP range-request segment fetching through an optional kernel proxy, client-side CSPICE, and local caching. The merged product needs that thinking carried forward: curated kernel packs with a defined offline floor (LSK, PCK, and a DE440 excerpt at minimum); an OPFS cache with eviction policy; an optional subsetting path for multi-hundred-megabyte mission SPKs; and an iOS reality check, because WKWebView memory ceilings versus large kernels is a shipping constraint for the Capacitor target, not a footnote. None of this blocks the merge; all of it blocks the tri-target claim if discovered late.

### 3.6 Missing workstream: embedding physics

Threaded WASM with a worker pool wants SharedArrayBuffer, and SharedArrayBuffer requires cross-origin isolation (COOP/COEP headers), and isolation is viral: Aerie or MMGIS as hosts either serve those headers or the embedded panel runs without shared memory. Two design consequences, both cheap now and expensive later: the compute plane must degrade gracefully to transferable-buffer mode, and the embed API should consider an iframe mode (credentialless COEP) as an isolation boundary for hosts that cannot adopt headers. This decision shapes the `mount()` signature, so it belongs before the embed API freezes, not after the first host integration fails in a security review.

### 3.7 Claims posture

"STK-class" and "Astrogator-class" should remain internal vocabulary until the validation story is public. The move consistent with ADR-0011's GMAT-oracle posture: publish a living validation report as a first-class product surface (SGP4-VER conformance, GMAT fixtures, Horizons cross-checks, OD synthetic-truth recovery, the RF closed-form checks), and let every ecosystem conversation point at that page. This also answers Aaron's open question 5 structurally: validation is not a milestone to reach before leaning on the engines, it is a surface that grows with them.

---

## 4. Target shape, consolidated

The end state is Aaron's architecture with the amendments folded in. One monorepo, strict tiering, packages published at the granularity of independent usefulness:

```
<repo>/
  packages/
    cspice-wasm      canonical CSPICE build, typed wrapper, worker pool, batch
                     (publishes standalone; carries the conformance suite from 3.1)
    frames           time service + frame graph + StateProvider contract
    catalog          Bessel schema (27 defs) + Cosmographia import and round-trip
    interop          CCSDS OEM/OMM/CDM/AEM + CZML (near-zero-dep; publishes standalone)
    core             zero-render universe model (the ratified spine, re-pointed at frames)
    render-three     tier 1: camera-relative scene, atmosphere, terrain via 3DTilesRendererJS
    render-cesium    optional backend, earns its keep per release
    engines/*        propagator, od, access, events, rf, coverage, conjunction,
                     attitude, sensors, mission, map-projection
    products         AnalysisProduct schema + provenance + generic render bindings
    pal, pal-*       web / electron / capacitor / node
    sdk              headless programmatic surface
    cli              binary name: bessel
    panel            imperative mount() + Web Component wrapper + iframe isolation mode
  apps/
    cosmolabe        the standalone workbench app (the product)
```

Alongside the packages, one small spec written early: the host-panel contract (time cursor sync, selection, camera state, data channels, deep links). It is deliberately the same contract for Aerie and for MMGIS, which is what makes "MMGIS is just another embed host" true in practice.

---

## 5. Sequencing

Phase 0 is decisions and plumbing: write the merge ADR set (spine ratification with bake-off results, SPICE and frames canonicalization, renderer tiers, AnalysisProduct schema, naming and publish scope, license and governance), and perform history-preserving subtree merges of both repositories into the monorepo so neither project's history is lost. Exit: ADRs accepted, CI green on both imported trees.

Phase 1 is the seam: extract and internally publish `cspice-wasm` and `frames`, stand up the differential harness over the golden scenarios, and re-point cosmolabe's core only when the harness is green. Exit: the core running on Bessel's layer with deltas under tolerance, timecraftjs retired.

Phase 2 is convergence: the unified core plus render-three passing a golden-image visual regression set, the engines wired through the compute plane, products schema at v0. Exit: the standalone app renders the parity scenes and runs at least access and coverage end to end as jobs.

Phase 3 is delivery: the panel embed (mount API, Web Component wrapper, degraded compute mode) plus PAL tri-target smoke tests, and an Aerie panel prototype against a real sim dataset. Exit: one host embed rendering authoritative resources with one exploratory overlay layered on top.

Phase 4 is ecosystem posture: the MMGIS embed behind a configuration flag, Cosmographia import polished against the parity matrix, a CCSDS round-trip suite, the public validation report page, and the first standalone package publishes (`cspice-wasm`, `interop`). The two shells proceed in parallel from Phase 2 onward because they share everything below the shell; Aaron's point that neither blocks the other holds and should be preserved as an explicit planning constraint.

---

## 6. Naming: keep both, split by surface

The direct answer to the naming question: yes, there is a way to preserve both, and it is better than preserving either alone, because the two names want to label different layers of the same product.

**Cosmolabe is the instrument.** The standalone app, the embeddable panel, the thing a person opens and looks through. The word is not an invention: the cosmolabe was a sixteenth-century universal instrument (Jacques Besson, Le Cosmolabe, 1567), an astrolabe generalized to take the measure of the whole cosmos. A browser-native 3D instrument for viewing and interrogating the solar system could not ask for a truer name.

**Bessel is the computation.** The engine suite, the headless SDK, and the CLI binary (`bessel` at the command line). Friedrich Bessel is the most computation-flavored name in astronomy, and the mapping to this specific engine suite is almost embarrassingly exact: Besselian elements are the machinery of eclipse and occultation prediction (the access and events engines); the Bessel ellipsoid lives in geodesy (map-projection); Kepler's equation has its classical solution as a Bessel function series (the propagator); and Bessel himself recomputed Halley's orbit at twenty and delivered the first stellar parallax (orbit determination and astrometry). The two halves of the merge were, by accident, named correctly for what each contributes.

One sentence then carries the entire brand architecture: **Cosmolabe is what you see; Bessel is what computes.** This is a well-worn and successful pattern (Chromium and V8, Firefox and Gecko, Blender and Cycles): the product name fronts, the engine name earns its own reputation among developers, and neither dilutes the other. It also has a quiet social virtue: each half of the merge keeps the name its author gave it, with the ownership split in the codebase matching the split in the brand.

**Reconciling with Aaron's neutral-scope principle.** His open question 4 argues the published libraries should not live under `@cosmolabe` or `@bessel`, so external adoption does not feel like depending on someone's app. He is right, and it is compatible with everything above: the app is Cosmolabe, the CLI and engine identity is Bessel, and the npm scope for the libraries is neutral. The strongest candidate for that neutral home is an Open Mission Foundation scope, if OMF's timeline supports it: seeding a vendor-neutral foundation with the two packages the community demonstrably wants (`cspice-wasm`, `interop`) is a better OMF launch story than any charter document, and it pre-answers the eventual "where does this live" question. If OMF is not ready when the packages are, publish under `@cosmolabe` as the pragmatic interim and record the intended migration in the ADR; scope moves are cheap early and expensive late.

**Registry facts, checked today.** npm `bessel` is taken (SheetJS's pure-JS Bessel functions package), so an unscoped bessel package was never available; this settles half the debate by force. npm `cosmolabe` is free, as is `cspice-wasm`; neither the `@cosmolabe` nor `@bessel` scope has any published packages. PyPI `cosmolabe` and `bessel` are both free, as are both names on crates.io, which matters if any engine ever grows a Rust core. GitHub usernames `bessel` and `cosmolabe` are both already registered, so the exact-match org handle is unavailable either way; the repository can live under an existing personal org now with NASA-AMMOS or OMF as the deliberate destination. One practical footnote: because SheetJS owns unscoped `bessel`, `npx bessel` will resolve to their package; the CLI should install from the scoped package and the docs should say so once.

Recommended actions this week regardless of the scope decision: register the npm names `cosmolabe` and `cspice-wasm`, and claim the `cosmolabe` scope, before any of this becomes public.

---

## 7. Governance and mechanics

License: Apache-2.0 on both sides already, keep it (and note the pleasant symmetry that core Cosmographia itself is Apache-2.0). Adopt DCO now, before external contributors arrive; a CLA can be revisited if the project moves under a foundation. CODEOWNERS mapped to prior authorship (core and rendering to Aaron; spice, frames, engines, PAL, interop to Paul) keeps review friction low and encodes the same social contract the naming split does. Continue Bessel's ADR discipline unbroken: the merge decisions become the first ADR set of the unified repository, and the existing ADRs (notably 0008 MMGIS, 0011 GMAT, 0012 MONTE) carry forward as-is since the review found nothing in them the merge invalidates. Bessel's SLIM-aligned governance files make the eventual migration to NASA-AMMOS or OMF cheap.

On who drives what (Aaron's open question 3), the ownership map suggests the split: Paul lands `cspice-wasm`, `frames`, and the differential harness, which is the Phase 0 to 1 critical path; Aaron lands the core re-point and render consolidation in Phase 2; the panel is the convergence point. This gives each author the critical path through code they wrote.

---

## 8. Risks

1. The SPICE seam produces subtle geometry disagreements that surface as visual bugs months later. Mitigation: the differential harness of 3.1, and the frames tier as the single authority.
2. The dual renderer becomes a permanent tax. Mitigation: the tiering policy of 3.3, enforced per release.
3. Embedding fails in a host security review over isolation headers. Mitigation: the degraded compute mode and iframe option of 3.6, decided before the embed API freezes.
4. iOS kernel memory ceilings undermine the tri-target claim. Mitigation: kernel packs, OPFS caching, and subsetting from 3.5, tested on device in Phase 3, not Phase 4.
5. Public "STK replacement" claims outrun the validation evidence and cost credibility with exactly the audience that matters. Mitigation: the validation report page of 3.7 as the only public vocabulary.
6. Two-author governance drift. Mitigation: ADR discipline, CODEOWNERS, and the ownership map of Section 7.
7. The Aerie panel roadmap slips and drags the merge with it. Mitigation: Aaron's own framing, worth adopting verbatim as policy: the standalone app is the product, PlanDev is a major host, and neither blocks the other.

---

## 9. First two weeks

Write the six merge ADRs. Register the npm names and scope. Stand up the differential harness skeleton and the four golden scenarios. Run the spine bake-off on those scenarios and record the numbers in the spine ADR. Draft the `StateProvider` and `AnalysisProduct` interfaces. Sync with the PlanDev-MMGIS integration effort before committing the tight-embed path. None of these depend on each other; all of them de-risk everything that follows.
