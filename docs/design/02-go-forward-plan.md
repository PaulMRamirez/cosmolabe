# Bessel + Cosmolabe: Go-Forward Plan v0.1

Date: 2026-07-09
Author: Claude, for Paul Ramirez
Companion document: cosmolabe-analysis-surface-design-review.md (the design review requested for analysis exposure on the front end)
Supersedes nothing; sharpens bessel-cosmolabe-merge-review.md (2026-07-09) into decisions, contracts, and a schedule.

---

## 1. Purpose and scope

The merge review identified seven areas needing sharpening (3.1 through 3.7) and this plan converts each into a concrete artifact with an owner and a phase. It also resolves two questions raised since: the platform abstraction (pal and pal-*) needs rethinking because the iOS phone target could easily be too visually heavy for a phone, and the analysis engines need a defined front-end exposure model. The first is answered in Section 7 by separating three axes the tri-target framing had conflated; the second is answered by the companion design review, with its data contract defined here in Section 5. The plan closes with the updated ADR queue and a revised two-week schedule.

---

## 2. The seam, made concrete (sharpens 3.1)

The seam becomes two published contracts in the frames tier, and nothing above them may call CSPICE directly. Correction is a required field everywhere, never defaulted, because silent aberration defaults are the single most likely source of km-scale disagreement between the two cores:

```ts
type Correction = 'NONE' | 'LT' | 'LT+S' | 'CN' | 'CN+S';

interface StateQuery {
  targets: BodyId[];
  observer: BodyId;
  frame: FrameId;
  correction: Correction;          // explicit at every call site
  epochs: Et[] | { start: Et; end: Et; step: Seconds };
}

interface StateProvider {
  states(q: StateQuery): Promise<StateBatch>;                 // zero-copy batch
  orientation(body: BodyId, frame: FrameId, epochs: Et[]): Promise<QuatBatch>;
}

interface FramesService {
  toEt(utc: IsoString): Et;                                    // one conversion authority
  chain(from: FrameId, to: FrameId, epoch: Et): FrameChain;    // inspectable, loggable
  kernels(): KernelSetInfo;                                    // hashable for provenance
}
```

The differential harness runs both cores' pipelines over four golden scenarios and gates the swap. GS-1, heliocentric cruise (a Cassini interplanetary segment), stresses origin management and float precision. GS-2, planetary orbiter (Cassini at Saturn, the existing demo and catalog reference instance), stresses frame chains, CK attitude, and ring visuals. GS-3, lunar south pole surface site with terrain tiles and sun geometry, stresses topocentric frames and illumination, and doubles as the Moonfall-relevant case. GS-4, a six-plane Walker constellation in LEO, stresses many-body updates, ground tracks, and the coverage drape. Two gate modes, ratified in ADR M-0002: call-parity mode (identical CSPICE invocations through both wrappers) must agree to relative 1e-12; pipeline mode (through each core's caching and interpolation) must agree to 1 m in position and 5 arcsec in pointing. The pipeline numbers are tripwires for semantic mismatches, not physics claims; a genuine correction or frame disagreement shows up at kilometers and degrees, and the harness exists to make that loud before users do. The harness graduates into the permanent conformance suite of the published cspice-wasm package, and its scenario fixtures seed the validation report page of Section 8.

---

## 3. Spine bake-off protocol (sharpens 3.2)

The bake-off runs the four golden scenarios on both cores across three device classes (an M-series laptop as tier A, a mid-range tablet as tier B, an iPhone 13-class device as the tier C floor) and records five measurements into ADR M-0001: screen-space jitter in pixels with the camera 1,000 km from a target whose barycentric distance is 9.5 AU (the Saturn case, the classic float32 stressor); state and orientation error versus SPICE truth through each core's own pipeline; p95 frame time per scenario per device; memory high-water mark; and a purity audit, enforced as a lint rule, that the model layer imports nothing from Svelte, React, or the DOM. The decision rule is stated in advance to keep the exercise honest: cosmolabe's core wins unless it loses the jitter or purity measurements, because those are the two properties a spine cannot retrofit cheaply. Whatever the outcome, the frames tier of Section 2 owns time and frame semantics by construction.

---

## 4. Renderer tiers, plus the WebGPU decision (sharpens 3.3)

The tier policy stands: Three.js is tier 1 and required; the Cesium backend is optional and must pass a per-release earn-its-keep gate (a nonempty list of capabilities the Three path cannot yet provide, a measured bundle delta, and a passing embed smoke test; failing the gate for two consecutive releases triggers a deprecation ADR).

One material update since the review: WebGPU crossed into Baseline. Safari ships it enabled by default on iOS 26, iPadOS 26, and macOS Tahoe 26 ([implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)), joining Chrome, Edge, and Firefox, and Three.js r171+ offers `WebGPURenderer` with automatic WebGL 2 fallback as an import-level change. Recommendation for ADR M-0003: tier 1 targets `WebGPURenderer` with the automatic fallback carrying older browsers, which costs little now and opens two doors later: compute-shader implementations of the heavy visual analytics (the coverage figure-of-merit sweep is an embarrassingly parallel texture job), and materially better battery behavior on phones, where the same workload runs measurably longer on WebGPU than WebGL. This also quietly strengthens the tiering argument, since CesiumJS remains a WebGL-era engine. The one open verification: WebGPU availability inside WKWebView specifically (as opposed to Safari proper) goes on the Phase 3 device checklist rather than being assumed.

---

## 5. Compute plane and AnalysisProduct (sharpens 3.4)

Every engine sits behind one job protocol, identical across panel, app, SDK, and CLI, with streaming partials so the UI can show analysis materializing rather than a spinner:

```ts
interface JobHandle {
  progress: AsyncIterable<{ pct: number; partial?: AnalysisProduct }>;
  result: Promise<AnalysisProduct>;
  cancel(): void;
}
```

The product schema is deliberately small: four kinds, each with exactly one canonical visual form (defined in the design review), plus provenance that makes the authority question machine-readable:

```ts
type Product =
  | { kind: 'intervals'; sets: IntervalSet[] }      // access, eclipse, comm passes
  | { kind: 'series';    series: TimeSeries[] }     // link margin, beta angle
  | { kind: 'geometry';  layers: GeoLayer[] }       // footprints, swaths, LOS lines
  | { kind: 'field';     field: ScalarField };      // coverage FOM, illumination

interface Provenance {
  engine: string; version: string;
  kernels: { setHash: string; names: string[] };
  frame: FrameId; correction: Correction;
  authority: 'host' | 'exploratory';
  computedAt: IsoString; jobId: string;
}

interface AnalysisProduct { product: Product; provenance: Provenance; units: UnitMap }
```

`authority: 'host'` is set only by host data adapters (the PlanDev sim dataset, telemetry feeds); engines can only ever emit `'exploratory'`. That single field is the type-level enforcement of the source-of-truth rule, and the design review gives it a visual grammar so the enforcement is legible, not just present.

---

## 6. Kernel logistics (sharpens 3.5)

Three pack classes. `pack-min` is the offline floor: current LSK, PCK, and a DE440 excerpt trimmed to the mission-relevant century, sized in the tens of megabytes and bundled with the iOS build so the app is never useless without a network. `pack-system` adds per-system satellite ephemerides on demand. Mission packs are produced by a subsetter, and the subsetter starts life as an offline tool wrapping the standard NAIF subsetting utilities in CI (missions publish trimmed packs alongside catalogs) before anyone builds a service; the kernel proxy from the original Bessel kernel architecture decision remains the optional online path for range-request segment fetching of large SPKs. OPFS caching gets a per-profile budget with least-recently-furnished eviction: 200 MB on tier C, 1 GB on tier B, effectively unbounded with eviction on tier A. The tier C budget is validated against real WKWebView memory behavior on device in Phase 3, not estimated.

---

## 7. Platform, profile, shell: the PAL revision

The phone concern is well founded, and the root cause is architectural: "tri-target" conflated three axes that need to be separate. PAL answers *where code runs and what services exist*. It cannot and should not answer *how heavy the pixels are* or *which product surface ships*. So the model becomes three orthogonal axes:

**Platform** stays as designed: `pal` plus `pal-web`, `pal-electron`, `pal-capacitor`, `pal-node`, abstracting storage (OPFS and files), share and export, notifications, thread availability, and secure-context facts. PAL narrows to services only; nothing visual passes through it.

**Profile** is new and runtime-selected: a capability probe (GPU class, device memory signal, `hardwareConcurrency`, `crossOriginIsolated`, input modality, screen class) resolves a RenderProfile and a ComputeProfile, user-overridable. The RenderProfile ladder is where the merge pays an unexpected dividend: Aaron's comparison table listed Bessel's limb-glow atmosphere as the inferior shader next to cosmolabe's ray-marched one, but in a tiered system it is the phone tier. Nothing is wasted.

| Tier | Atmosphere | Post | Star field | DPR cap | Tile budget | Render loop |
| --- | --- | --- | --- | --- | --- | --- |
| A (desktop, M-series) | ray-marched (Rayleigh+Mie+ozone) | bloom on | full | native | high | invalidation, continuous while animating |
| B (tablet, integrated GPU) | precomputed-LUT approximation | reduced | full | 2.0 | medium, capped cache | invalidation |
| C (phone) | limb-glow shell (Bessel's shader) | off | static texture | 1.5 | hard cap | invalidation only, pause on background |

Invalidation-driven rendering (draw only when the scene or time cursor changes) is the default at every tier and mandatory at C; on a phone it is the difference between an instrument and a hand-warmer, and LithoSphere's render-only-when-open option is prior art for the same instinct. The ComputeProfile caps worker count and WASM heap per tier, and restricts tier C to interactive job classes: a quick access check runs on the phone; an all-vs-all conjunction screen or a coverage sweep is either declined with a reason or handed to a paired desktop session. Profiles live in a small `profiles` package consumed by render-*, the compute plane, and the shells.

**Shell** answers the product question directly, and the answer to the iPhone concern is: **the iPhone ships the panel, not the workbench.** The two-shell thesis already gives us exactly the right lightweight surface; the phone product is the panel wrapped in native chrome via `pal-capacitor` (call it the Companion): open a shared scene from a URL or file, scrub time, read the instrument readouts, view analysis products that arrived with the scene or were computed elsewhere, run tier-C interactive analysis, hand anything heavier off. The iPad, with M-series silicon and pointer support, ships the full workbench with touch adaptations. This collapses "the iOS app" from one impossible product into two honest ones, reuses the panel investment, and means the visual-weight problem is solved by profile selection plus shell selection rather than by maintaining a degraded fork of the workbench.

Two platform facts anchor the compute side of this, both verified. SharedArrayBuffer requires a cross-origin isolated document (COOP plus COEP), which Safari supports on iOS in the browser, but Capacitor's custom scheme handler has a long-standing limitation around setting those headers on the initial document ([capacitor#6182](https://github.com/ionic-team/capacitor/issues/6182)), so the Companion treats transferable-buffer compute as its baseline and threads as an opportunistic upgrade if the probe reports isolation. And WebGPU is present by default in WebKit as of iOS 26, which the Phase 3 device pass confirms specifically inside WKWebView before the Companion's render path relies on it. The embed mount signature carries all of this explicitly:

```ts
mount(node: HTMLElement, cfg: {
  data: HostDataAdapter;
  compute?: 'threads' | 'transfer' | 'iframe';     // probe-resolved when omitted
  profile?: Partial<RenderProfile & ComputeProfile>;
}): PanelController
```

This whole section is ADR M-0007, and it is the one ADR that changes the phase plan: Phase 3 gains a device-truth pass (oldest supported iPhone plus current, recording WKWebView SAB and WebGPU probe results, thermal behavior over a 20-minute scrub session, and OPFS budget behavior into the ADR as an addendum).

---

## 8. Isolation decision tree and validation posture (sharpens 3.6, 3.7)

Isolation resolves in order: if the host serves COOP/COEP, run threaded; else if the host accepts an iframe embed, run the panel in a credentialless-COEP iframe and get threads back; else run transferable-buffer fallback. The Companion defaults to fallback per Section 7. The `compute` field above is the whole API surface of this decision, which is the point: hosts choose a word, not an architecture.

The validation report becomes a page with a fixed skeleton, stood up in Phase 1 and grown continuously: SGP4 conformance against SGP4-VER; HPOP force-model fixtures against GMAT with per-term error tables; Horizons cross-checks on the golden scenarios; OD synthetic-truth recovery; RF closed-form checks; and a live badge from the differential harness. Public vocabulary about capability points at this page and nowhere else; "STK-class" stays internal until the page can carry the sentence.

---

## 9. Updated ADR queue and ownership

| ADR | Decision | Driver |
| --- | --- | --- |
| M-0001 | Spine ratification, with bake-off evidence attached | Aaron |
| M-0002 | Seam contracts and harness tolerance gates | Paul |
| M-0003 | Renderer tiers, WebGPU-first with WebGL 2 fallback, Cesium earn-its-keep gate | Aaron |
| M-0004 | AnalysisProduct schema, job protocol, authority field | Paul |
| M-0005 | Naming, publish scope, package plan | joint |
| M-0006 | License and governance mechanics | Paul |
| M-0007 | Platform, profile, shell; iOS target definition (iPhone = Companion, iPad = workbench) | joint |
| M-0008 | Analysis surface grammar (output of the design review) | Aaron |
| M-0009 | Kernel logistics: packs, OPFS budgets, subsetter-first | Paul |
| M-0010 | Embedding isolation strategy and mount API | joint |

---

## 10. Two-week schedule, revised

Week one: write M-0002, M-0004, M-0005, M-0006 (the ones needing no new evidence); register the npm names and scope; stand up the differential harness skeleton with GS-1 and GS-2; run the capability-probe spike on a real iPhone and record WKWebView SAB and WebGPU truth; draft the `profiles` package interface. Week two: run the full bake-off and write M-0001; complete GS-3 and GS-4; hold the design review session using the companion document's artifacts and write M-0008; draft M-0003, M-0007, M-0009, M-0010 from the evidence gathered; sync with the PlanDev-MMGIS integration effort. Exit state: ten accepted or drafted ADRs, a green two-scenario harness, device truth on file, and a ratified analysis surface grammar, which together unblock Phase 1 with no open architectural questions.
