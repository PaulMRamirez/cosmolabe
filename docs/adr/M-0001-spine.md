# M-0001: Spine ratification

Status: Proposed, pending bake-off evidence; becomes Accepted (provisional, review-on-return) when tables attach
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the spine acceptance itself, with the W1 bake-off evidence attached

## Context
Both codebases carry a scene and object model. The merge needs one spine: the object model and render architecture everything else consumes. Aaron's comparison argues for cosmolabe's core (zero-render, framework-agnostic, Aerie panel commitment); the merge review (docs/design/01, section 3.2) requires ratification by measurement, not assertion.

## Decision
Run the bake-off protocol of docs/design/02 section 3: four golden scenarios, three device classes, five measurements (screen-space jitter at 9.5 AU, state and orientation error versus SPICE truth, p95 frame time, memory high-water, purity audit). Decision rule stated in advance: cosmolabe's core wins unless it loses jitter or purity, the two properties a spine cannot retrofit cheaply. Regardless of outcome, time and frame semantics belong to the frames tier (M-0002), never to the scene.

## Consequences
Evidence tables attach here in W1. The losing core's superior pieces migrate as separate, baseline-diffed PRs.
