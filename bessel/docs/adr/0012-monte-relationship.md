# ADR-0012: MONTE relationship: consume SPK and CCSDS; optional licensed ComputeProvider

Status: Accepted
Date: 2026-06-19

Same family as ADR-0008 (integrate by seam, not by embedding) and ADR-0011
(native-first analysis; an external engine only behind the PAL ComputeProvider
seam, gated). Applies that pattern to JPL MONTE.

## Context

MONTE (Mission Analysis, Operations, and Navigation Toolkit Environment) is JPL's
signature astrodynamics platform and the prime operational orbit-determination
software for JPL-navigated missions (Cassini, MSL, Juno, Dawn, GRAIL), sponsored by
the MGSS/AMMOS program office. It is a C++ core with a Python API, Linux-based,
Caltech-proprietary and licensed (ITAR-free, EAR99), and not open source. It covers
exactly the deepest capabilities Bessel lacks natively: operational orbit
determination, optimizing maneuver and trajectory design, and launch (pork-chop)
analysis. The question is how an open, Apache-2.0, web/WASM product should relate to
a proprietary, licensed, Linux-only engine in the same AMMOS ecosystem.

## Decision

1. Primary relationship: data-boundary consumer. Bessel consumes MONTE's products,
   not its software. MONTE produces SPICE SPK ephemerides and CK attitude; Bessel
   already renders SPK/CK through CSPICE-WASM. File interchange uses CCSDS: Bessel
   parses OEM/OMM/CDM and now AEM (attitude), and imports OEM to SPK. The restricted
   software is never embedded; only its releasable data products cross the seam.
   This is the niche Cosmographia (also AMMOS) occupies, so Bessel can serve as a
   modern, zero-install, multi-platform viewer and front end for MONTE workflows.
2. Optional server-side ComputeProvider, for licensed or internal deployments only.
   MONTE may back the PAL ComputeProvider seam (the same seam ADR-0011 defines for
   GMAT) to supply orbit determination, optimizing mission design, and pork-chop
   analysis that Bessel does not compute natively. This is desktop or server only,
   gated, and never part of the open PWA; adopting it is a deliberate, recorded
   decision.
3. Not bundled, not ported, not a public-CI dependency. MONTE is licensed and EAR99
   with a Linux C++/Python stack; there is no browser or WASM path, so it is never
   shipped in the open product. As a validation oracle it is licensing-constrained
   (unlike GMAT, which is Apache-2.0 and usable as committed CI fixtures).

## Consequences

- No architecture change: the data-boundary integration uses capabilities Bessel
  already ships (SPK/CK rendering, CCSDS parse/write), and the optional backend uses
  the PAL ComputeProvider seam ADR-0011 already established.
- The interop bridge is concrete: SPK consumption plus CCSDS OEM/OMM/CDM/AEM. AEM
  parsing (`@bessel/interop`) closes the attitude side of the MONTE seam.
- A live MONTE backend remains a deliberate, deployment-specific, licensed choice;
  the open product stays native-first and never depends on MONTE.
- Bessel and MONTE are complementary, not competing: MONTE is the authoritative
  navigation and design engine, Bessel is the open visualization and lightweight
  analysis front end.
