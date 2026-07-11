# Cosmolabe Merge: Solo Execution Plan v0.1

Date: 2026-07-10
Author: Claude, for Paul Ramirez
Situation: Aaron has agreed to the strategy and delegated execution ("proceed, take it as far as you can") while on leave for roughly two months. This plan adapts the go-forward plan to solo execution with Claude Code as the workforce, and ships with a repo seed (CLAUDE.md, the ten ADR drafts, the design docs repositioned as repo documentation, session commands, and templates) so implementation starts tomorrow.

---

## 1. What changes with one human

Three things, and only three. Decision-making needs an authority model, because "Aaron agreed to the direction" is not the same as "Aaron reviewed this diff"; the model below keeps full speed while making his re-entry a walkthrough instead of an archaeology dig. Review needs a second reviewer, and with no second human that role is played by machinery: the differential harness, the golden-image baselines, the purity lint, and the adversarial verify-spec cross-check workflow are the reviewer of record, with Paul reviewing reports and gates rather than every line. And capacity needs honesty: agents multiply writing throughput but not review bandwidth, so the plan holds a work-in-progress limit of two concurrent workstreams (one on the seam critical path, one parallel-safe) and plans each window to roughly three-quarters capacity with named stretch items, because the day job will spike.

**Decision classes.** Class A, decide and log: anything inside the ten agreed ADR directions, and all engineering choices below ADR altitude; the ADR log and conventional commits are the record. Class B, decide provisionally and tag `review-on-return`: acceptance of the spine bake-off result (M-0001), ratification of the analysis surface grammar (M-0008), any renderer tier enforcement action, any change to cosmolabe-heritage rendering behavior beyond what the re-point mechanically requires, and the neutral-scope publish decision. Class B decisions proceed at full speed; the tag means Aaron gets a veto window in September, not that work waits. Class C, parked for Aaron: the Aerie panel adapter beyond prototype (it is his PlanDev roadmap item and his relationships), any Cesium deprecation ADR if the earn-its-keep gate fails, and public launch communications. Class C is deliberately short; "take it as far as I can" means everything else proceeds.

**The re-entry record.** Aaron has waived the formal delegation record; `docs/collab/mandate.md` holds a short working agreement instead: public repo incorporated by tagged subtree merge, his repository untouched during leave, history review and the final-destination decision on his return before the true merge. No standing communications go to Aaron during the leave. Maintain `docs/collab/RE-ENTRY-BRIEF.md` as a living document from week one rather than writing it at the end, and target a demo-ready state for his return: the grammar walkthrough happens live in the product, not in mocks.

---

## 2. Day zero: tonight and tomorrow morning, before the first session

Cosmolabe is public: clone it tonight to pin the SHA of record, and confirm a clean local build. Create the `cosmolabe` monorepo under PaulMRamirez (the exact-match GitHub handle is taken; the repo name carries the brand). Public from day one is fine since both parents are public Apache-2.0. Perform history-preserving subtree merges of both repositories and tag the pre-merge SHAs. Claim the npm names (`cosmolabe`, `cspice-wasm`) and the `@cosmolabe` scope with placeholder publishes. Capture the golden baselines from cosmolabe's current main before any other commit touches it: scripted renders of the four golden scenarios (or nearest current equivalents) stored under `tests/golden/pre-merge/`; this is the artifact that lets you prove non-regression to Aaron later, and it cannot be captured retroactively. Drop the repo seed from the zip. Port the CI pattern (pnpm workspaces, the unified `pnpm verify` gate, Pages deploy via OIDC with concurrency control) and require CI on PRs to a protected main, solo or not. Preflight the toolchain: Claude Code v2.1.154+ for dynamic workflows, `/model fable`, a settings.json allowlist that is the union of both repos' command vocabulary, and the Mac preflight script from the bessel scaffold for the Capacitor and Xcode chain you will need in window four.

---

## 3. The harness: how Claude Code runs this

The vocabulary extends the existing bessel harness rather than replacing it: `/phase`, `/verify`, `/implement`, and the `/verify-spec` dynamic workflow carry over in the subtree merge (the old phase goal files describe the pre-merge program; archive them under `docs/goals/archive/`). Four merge-specific commands ship in the seed. `/seam` runs the differential harness and summarizes deltas against the M-0002 gates. `/baseline` captures or compares golden-image renders. `/adr` drafts a new ADR from the template with the right status vocabulary. `/gate` evaluates the current window's exit criteria, writes the honest carryover list, and updates the re-entry brief.

The working rhythm per window: goal file in, `/implement` builds and self-verifies, `/verify-spec` fans out the adversarial cross-check and writes the report, Paul reads the report and the gate, merges or redirects. The seed includes the first goal file (`SESSION-1-REPO-GENESIS.goal.md`) as the pattern; each window's exit includes writing the next window's goal file, so the harness feeds itself. Two standing iron rules bind every agent session and live in CLAUDE.md: nothing above the frames tier calls CSPICE directly, and re-point diffs must be mechanically minimal, meaning any improvement to cosmolabe-heritage code beyond what the re-point requires goes in a separate PR with a baseline diff attached. The second rule exists because the single worst outcome of these two months would be Aaron returning to find his renderer "improved" in ways nobody can untangle from the migration.

---

## 4. The nine weeks: four windows and a buffer

Gates are fixed; dates move. Each window has one goal sentence, a gate, and named stretch items to cut first.

| Window | Goal | Gate (exit criteria) | Stretch |
| --- | --- | --- | --- |
| W1 (wk 1-2) | The seam is measured | Monorepo live with CI green on both imported trees; seed landed; `cspice-wasm` and `frames` extracted; harness green in call-parity on GS-1 and GS-2; baselines captured; bake-off run with evidence attached to M-0001 and M-0003 | GS-3 and GS-4 fixtures |
| W2 (wk 3-4) | One core on one SPICE layer | Re-point merged behind a green pipeline-mode harness on all four scenarios; timecraftjs retired; visual regression green against pre-merge baselines; M-0001 accepted (provisional) | `profiles` package |
| W3 (wk 5-6) | Engines through the compute plane | Job protocol and AnalysisProduct v0 live; access and coverage run end to end as jobs; grammar demo on GS-2 and GS-4 (lanes, drape, provenance chips, materialization); validation page skeleton deployed to Pages; M-0008 ratified (provisional) | Porkchop inspector |
| W4 (wk 7-8) | Delivery truth | Panel `mount()` with fallback compute; Companion prototype on a physical iPhone with WKWebView SAB and WebGPU probe results recorded as the M-0007 addendum; MMGIS embed behind a flag | CCSDS round-trip suite |
| W5 (wk 9) | Buffer and re-entry | Honest carryover written; RE-ENTRY-BRIEF current; demo script for Aaron's walkthrough rehearsed | none: buffer is buffer |

Two sequencing notes. The baseline capture and the bake-off both precede the re-point by construction, which is why W1 looks measurement-heavy: everything risky in W2 is de-risked by W1 artifacts. And the validation page deploys in W3 rather than W4 because it reuses the Pages OIDC deploy from day zero and its content is generated by the same harness runs that gate W2; publishing it early makes the claims discipline structural.

One item sits deliberately outside the nine weeks. The access and events engines are existing Bessel packages and already inside the windows (W3 runs access end to end, and the eclipse lanes in the W3 grammar demo are events-engine output); the new, named backlog item is the Besselian-elements module, classical eclipse and occultation elements with local circumstances, living inside access and events under the reserved `besselian` name. Its trigger is the validation page going live, because the module arrives with a published external oracle, canonical eclipse element tables, and so doubles as a validation showcase. Designated first fixture: the total solar eclipse of 2026-08-12, which occurs during this execution window and can be reproduced from archived kernels whenever the module is built.

---

## 5. Docs-to-repo mapping

The three documents become repo documentation, not attachments. The seed lays them in as follows:

```
cosmolabe/
  CLAUDE.md                          agent constitution (seed)
  AGENTS.md                          thin pointer to CLAUDE.md
  docs/
    README.md                        map of the documentation
    adr/M-0001 .. M-0010.md          ten drafts, statuses set per Section 6
    design/
      01-merge-review.md             the review, unchanged
      02-go-forward-plan.md          contracts, tiers, profiles, kernels
      03-analysis-surface-design-review.md
    validation/README.md             skeleton of the public report page
    collab/
      mandate.md                     the working agreement
      RE-ENTRY-BRIEF.md              living document from week one, maintained by /gate
    goals/
      SESSION-1-REPO-GENESIS.goal.md
      archive/                       bessel's pre-merge phase goals
```

ADRs are the decision record; the design docs are the rationale record; nothing is duplicated, ADRs cite design-doc sections instead of restating them.

---

## 6. ADR statuses under the delegation

Accepted outright, because Aaron agreed to them in substance: M-0002 (seam contracts and tolerance gates), M-0004 (AnalysisProduct and job protocol), M-0005 (naming and publish plan, with the neutral-scope migration flagged Class B), M-0006 (governance mechanics), M-0007 (platform, profile, shell; device-truth addendum pending), M-0009 (kernel logistics), M-0010 (embedding isolation). Proposed pending evidence: M-0001 (spine) and M-0003 (renderer tiers), which W1 converts to accepted-provisional with the bake-off tables attached. Provisional pending walkthrough: M-0008 (analysis surface grammar), which Paul ratifies in W3 and Aaron reviews live in the product on return. Every provisional ADR carries the `review-on-return` tag in its status line so the September agenda writes itself.

---

## 7. Hardening register

One, bus factor of one: mitigated by the machinery-as-reviewer model, PR discipline against a protected main, the ADR trail, and the living re-entry brief; if Paul is interrupted for two weeks, the repo state explains itself. Two, agent overreach on cosmolabe-heritage code: the mechanically-minimal re-point rule, baseline diffs required for any behavioral change, and the harness gate in CI; agents are explicitly forbidden from opportunistic refactors of the renderer. Three, baselines skipped: unrecoverable if missed, which is why capture is a day-zero item ahead of all other commits. Four, access and ownership gaps: repo access, npm claims, and the recorded mandate all land before Aaron goes dark. Five, scope creep on "as far as I can": bounded by the Class C park list and the stretch-first-to-cut discipline; the window goal sentence is the test for whether work belongs. Six, review bandwidth: the WIP limit of two, and verify-spec reports as the review surface rather than raw diffs. Seven, iOS logistics: physical device, Apple developer account state, and the Capacitor toolchain are preflighted at day zero so W4 is measurement, not setup. Eight, kernel data in CI: kernels are never committed; a fetch script with checksums populates a cached pack-min, keeping CI deterministic and the repo light. Nine, silent semantic drift after the swap: the harness stays in CI permanently and a nightly job spot-checks GS states against Horizons. Ten, re-entry shock: the living re-entry brief plus the demo-ready target; Aaron's first hour back is a walkthrough, a diff of provisional decisions, and a short veto list, not a two-month changelog. Eleven, day-job spikes: absorbed by the buffer window and the 75 percent planning load; when a window slips, the gate holds and the date moves, and the carryover is written honestly rather than rolled forward silently.

---

## 8. Tomorrow: the first three sessions

Session one, repo genesis. Launch with `/goal docs/goals/SESSION-1-REPO-GENESIS.goal.md` (in the seed): init the monorepo, subtree-merge both parents with history, land the seed, port CI, and finish with `pnpm verify` green on both imported trees and the pre-merge tags pushed. Session two, measurement rig: capture the golden baselines from cosmolabe main, wire the purity lint against both cores, build the jitter measurement scaffold, run the bake-off scenes, and write the evidence tables into M-0001 and M-0003. Session three, the seam: extract `cspice-wasm` and `frames` to the M-0002 contracts and bring the differential harness to call-parity green on GS-1 and GS-2. Each session ends by writing or updating the next goal file, running `/verify-spec`, and committing the report; that rhythm, repeated, is the whole plan.

---

## 9. Access contingency: the Bessel-first resequencing

Trigger: cosmolabe read access is not confirmed by the end of day zero. First, exhaust the cheap paths, because the plan needs read access only and write access to Aaron's repository was never required; the merge lands in the new monorepo. Check whether the repository is public, whether a collaborator invite from earlier work already exists, and whether any clone or tarball survives from the comparison exercise, since a stale clone with history is fully sufficient for a subtree merge that is trued up later. In parallel, send the one-tap ask: flip it public or send an invite, thirty seconds, the only thing needed for two months.

If none of that lands, resequence Bessel-first. Cosmolabe sits on the critical path for exactly four items: its subtree merge, the pre-repoint baselines, the bake-off, and the re-point itself. Everything else proceeds, and it includes the two riskiest workstreams, which were never cosmolabe-gated. The windows remap as follows. W1': seam extraction (cspice-wasm and frames to the M-0002 contracts) plus the harness running a truth lane, Bessel versus SPICE truth and Horizons, with the cosmolabe lane added whenever code arrives; the monorepo initializes with the bessel parent only, since a subtree merge lands identically at any later date. W2': the compute plane, AnalysisProduct v0, and engines running as jobs. W3': the grammar demo on Bessel's existing Three scene through the render-binding interface, plus the validation page deployed. W4': panel mount, Companion scaffold, and the device-truth pass. The merge block (baselines, bake-off, re-point, render consolidation) executes whenever access appears, into a conformance-hardened frames tier, possibly jointly on Aaron's return, which converts his re-entry from a walkthrough into a working merge week and is arguably the better version.

Guardrails so the gap cannot poison the merge. No reimplementation of cosmolabe's differentiators (the ray-marched atmosphere, terrain streaming, the camera system, the dual renderer) during the gap; Bessel's scene serves as demo scaffolding behind the render-binding interface and is tagged as such in every PR that touches it. M-0001 stays open with its pre-committed decision rule precisely so two months of Bessel-side momentum cannot tilt the bake-off; scene work during the gap is not spine evidence. The baseline immutability rule is preserved automatically, since capture still precedes the re-point in any ordering. The honest cost: spine ratification and visual convergence wait, and nothing else does.
