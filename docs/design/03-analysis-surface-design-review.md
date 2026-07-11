# Cosmolabe Analysis Surface: Design Review

Date: 2026-07-09
Author: Claude, for Paul Ramirez, as input to a design session with Aaron
Companion document: bessel-cosmolabe-go-forward-plan.md (defines the AnalysisProduct contract this review gives a visual form)
Status: Proposal; the session's job is to ratify or amend, and the outcome becomes ADR M-0008

---

## 1. The brief

The subject is a precision instrument for viewing and interrogating the solar system. The audience is mission operations engineers, flight dynamics analysts, and science planners. The single job of the interface: keep the scene primary while making validated analysis one gesture away.

Cosmolabe's clean visual style is the base design language and this review does not renegotiate it; the design problem is narrower and harder: Bessel brings eleven engines' worth of output, and the failure mode is obvious in Bessel's own scaffolding, a six-tab workbench that frames the viewport instead of serving it. Cosmographia fails in the opposite direction, visualization with the analysis a trip to another tool. The merged product wins by being the instrument that computes: the scene looks like the mission, the interface looks like a flight instrument, and analysis appears in the scene and on the timeline rather than in pages about the scene.

One structural gift makes this tractable: the AnalysisProduct schema has exactly four kinds. Four kinds means four canonical visual forms, learned once, reused by every engine, present and future. The design system's core is that grammar, not a screen inventory.

---

## 2. Principles

**Scene-first, chrome-recessive.** The 3D scene is the page. Interface elements float over it, translucent and dismissible, and the idle state is nearly pristine: time controls, a status line, and nothing else asking for attention. Bessel's tab chrome dies; its contents survive as summonable surfaces.

**Analysis is layers and lanes, not pages.** Every engine output lands either in the scene (as a layer) or on the timeline (as a lane) or in a summoned inspector, and never in a destination that hides the scene. If a result cannot be expressed in the grammar of Section 3, that is a schema conversation, not a new page.

**Provenance is visible grammar.** Authoritative and exploratory results are distinguishable at a glance, at every zoom level, without reading (Section 5). This is the design-side enforcement of the source-of-truth rule the plan enforces at the type level.

**Progressive disclosure has a fixed ladder.** Hover readout, then pinned readout chip, then lane or layer, then inspector, then the analysis composer (the one workbench-like surface, summoned as an overlay and dismissed without residue). Each rung is one gesture from its neighbors, and nothing skips rungs on its own initiative.

**The timeline is the spine.** One time cursor drives the scene, every lane, every strip chart, and the 2D inset. Scrubbing is the primary analytic gesture, and the shared-cursor discipline is what makes five simultaneous products readable instead of five widgets. (This is the same lane-and-cursor instinct the Vector Channels work formalized for telemetry; the vocabulary transfers.)

---

## 3. The grammar: four product kinds, four canonical forms

| Product kind | Canonical form | Notes |
| --- | --- | --- |
| intervals | Timeline lanes under the scrubber | Access windows, eclipses, comm passes; lane label, count badge, gap emphasis |
| series | Strip charts in the right rail, hover readouts in the scene | Link margin, beta angle; shared time axis, tabular numerals |
| geometry | In-scene drapes: footprints, swaths, ground tracks, LOS lines | Legend chip per layer; exact sensor footprints from the sincpt path |
| field | Heatmap drape with a colorbar legend | Coverage FOM, illumination; rendered through the named color strategies |

Two details in that table carry weight. Every form has a legend chip: a small, consistent affordance naming the layer, carrying its provenance state, and offering remove and inspect. And the field row finally gives the catalog schema's named color strategies (linear, log, percentile-clip, quantile, and the rest, generalized in ADR-0006) their user-facing home: the coverage heatmap's colorbar is a strategy picker, not a hardcoded ramp, which turns a schema decision from last month into a visible product capability.

---

## 4. What to pull from Bessel, specifically

**Coverage figure-of-merit drape.** Already flagged as small and portable in Aaron's comparison; it is the flagship `field` product and the demo that sells the standalone story.

**Exact sensor footprints and swaths.** Both codebases draw FOV cones; Bessel's sincpt-derived footprints are the accurate ones and become the only implementation.

**The porkchop plot.** It exists as a Bessel worker today; it surfaces as an inspector chart with pick-to-load (click a contour point, the transfer loads into the scene as an exploratory trajectory). This is the single most workbench-flavored surface being kept, and it stays inside the inspector rung of the ladder.

**Conjunction encounter inspector.** Per-event Pc, B-plane plot, and encounter geometry as an inspector view, with the screening results themselves living as an intervals lane plus scene markers.

**The 2D ground-track inset.** The map-projection engine drives a picture-in-picture inset sharing the time cursor; the "Open in MMGIS" deep link (ADR-0008's contract) lives on this inset, which gives the MMGIS handoff a natural, spatial home instead of a menu item.

**The instrument panel heritage.** The old inspector prototype's kernels inventory and performance footer, plus a status line for the SPICE error surface. Loud failures were a Bessel phase-1 principle and they need a visual home: a persistent one-line status strip and a log drawer, with copy that names the fault precisely ("CK gap 03:12 to 03:40 for -82000; pointing unavailable" rather than "attitude error"). Engineers extend trust to instruments that admit exactly what they do not know; this panel is a trust feature wearing a diagnostics costume.

What is explicitly not pulled: the six-tab shell, modal workflows that hide the scene, and any readout that duplicates what a legend chip already says.

---

## 5. Provenance grammar

Authoritative products (from the host: the PlanDev sim dataset, telemetry) render solid, in neutral ink, with a small host badge on the legend chip. Exploratory products (computed here) carry the accent color, a dashed or softened edge treatment on scene geometry, and a "Computed here" chip whose popover shows the full provenance record: engine and version, kernel set hash, frame and correction, timestamp. The rule that makes this grammar rather than decoration: the accent color appears in the interface for exactly one reason, marking computation performed by this instrument. One glance answers the only question that matters in a planning context: can I schedule against this, or is it my sketch. Copy follows the same discipline: results are never labeled "approximate" or "unofficial," they are labeled by their source, because source is a fact and confidence is a judgment the analyst gets to make.

---

## 6. Jobs, motion, and the signature element

Compute-plane jobs surface as chips in a small tray: name, progress ring, cancel. The signature element of the whole interface is what happens as they run: **analysis materializes.** Because the job protocol streams partial results, access windows draw onto their lane one by one as the sweep advances, coverage cells resolve across the globe as the field fills in, and a conjunction screen populates its lane as pairs clear. The instrument visibly thinks, and the motion is information (what is done, what remains) rather than ornament. This is the one place the design spends its motion budget; everything else is still, and the invalidation-driven render loop from the platform plan becomes a design ally, because stillness reads as precision in an instrument. Reduced-motion preference collapses materialization to batched appearance without losing the progress semantics.

---

## 7. Tokens, type, and style direction

These are candidate tokens to test against cosmolabe's existing palette in the session, not a replacement for it; the intent is to name the roles so the review can ratify values.

Palette, five roles: `space` (near-black with a cold cast, the scene's own void carried into the chrome, around #0B0E12), `ink` (high-legibility light, around #E8ECF2), `ink-dim` (secondary, around #93A0AE), `computed` (the exploratory accent; a warm annotation amber around #E0A458, grounded in the subject's own world: annotation ink on photographic plates and pen plots, HUD symbology, warm against the cold scene without reading as alarm), and `alert` (a red reserved exclusively for faults and conjunction alarms; if red appears, something is wrong, and nothing else may borrow it). Lane hues for interval types stay desaturated so the accent and alert roles keep their meaning.

Type, two roles: a quiet neutral sans for interface text, and a monospaced or tabular-numeral utility face for every readout, coordinate, and epoch, because column-stable numbers are what make a scrubbed readout legible and are half of what makes an interface feel like an instrument. Candidates to evaluate live: IBM Plex Sans with IBM Plex Mono, or Space Grotesk with JetBrains Mono. No display face in the application chrome at all; the scene is the display.

The restraint rule for everything above: the atmosphere, the rings, the star field are the beauty budget, already spent well by cosmolabe. The interface's aesthetic ambition is to disappear until summoned and to be exact when present.

---

## 8. The phone Companion, in this grammar

The Companion (the panel in native chrome, per the platform plan) uses the same grammar reduced, not redesigned: the timeline and one lane at a time, readouts as the primary surface, the rail as a bottom sheet, legend chips full-width and thumbable, heatmap drapes intact (cheap to display once computed), the composer absent, and exploratory computation limited to the interactive job class with the same provenance grammar. Nothing on the phone looks different from the desktop; there is simply less of it at once, which is the test of whether the grammar is real.

---

## 9. Session logistics and exit criteria

Format: 90 minutes, Paul and Aaron, screens over prose. Artifacts to bring: five canonical mock screens as static images (idle scene; access analysis running, mid-materialization; coverage sweep with strategy picker open; conjunction inspector with B-plane; phone Companion), the grammar table, the token sheet, and a two-image contrast strip (Cosmographia and the Bessel tab scaffold) as the reference points being deliberately departed from.

Decisions to exit with: ratify or amend the four-form grammar and the disclosure ladder (becomes ADR M-0008); ratify the provenance grammar including the accent-color rule; tier the Bessel pull list into P0 (coverage drape, footprints, status line) and P1 (porkchop, conjunction inspector, 2D inset); choose the strip-chart rendering approach (a lightweight canvas path in the uPlot class now, with a WebGPU path noted as a later option once the renderer decision lands); and confirm the standalone UI framework can remain TBD, which Aaron's document already argued and this grammar supports, since everything above is framework-agnostic by construction.

---

## 10. Acceptance heuristics

Idle chrome occupies no more than roughly a tenth of the viewport. Every analysis visual has a legend chip with a provenance state. Every surface above the first ladder rung dismisses in one action. The accent color never appears except on computation performed here, and red never appears except on faults and alarms. All numerals in readouts are tabular. Reduced motion is honored without losing progress information. The Companion holds 30 fps at tier C on the oldest supported iPhone through a full scrub session. If a proposed feature cannot satisfy these while fitting the four-form grammar, the feature is redesigned before the heuristics are relaxed.
