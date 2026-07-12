# Cosmolabe

[![ci](https://github.com/PaulMRamirez/cosmolabe/actions/workflows/ci.yml/badge.svg)](https://github.com/PaulMRamirez/cosmolabe/actions/workflows/ci.yml)
[![horizons-nightly](https://github.com/PaulMRamirez/cosmolabe/actions/workflows/horizons-nightly.yml/badge.svg)](https://github.com/PaulMRamirez/cosmolabe/actions/workflows/horizons-nightly.yml)

The merged [Bessel](https://github.com/PaulMRamirez/bessel) + [Cosmolabe](https://github.com/AaronPlave/cosmolabe) project, a work in progress combining Aaron Plave's Cosmolabe (visualization engine and instrument; see his [heritage demo](https://aaronplave.com/cosmolabe/)) with Bessel (browser-native astrodynamics engines, SDK, and the `bessel` CLI). Cosmolabe is the product and the visible instrument; Bessel is the compute identity.

Capability claims live on the [public validation page](https://paulmramirez.github.io/cosmolabe/), generated from committed machine-readable tables: the differential seam harness over the four golden scenarios, the measurement rig tables, and the nightly Horizons spot-check (external truth; the badge above reflects its latest run). The operating constitution for agent sessions is [CLAUDE.md](CLAUDE.md); design rationale lives in `docs/design/`, decisions in `docs/adr/`, and the living re-entry brief in `docs/collab/`.
