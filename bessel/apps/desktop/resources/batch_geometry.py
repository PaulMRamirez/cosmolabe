#!/usr/bin/env python3
"""Batch geometry product generator for the Bessel desktop Python bridge.

Reads a JSON request on stdin and writes a JSON result on stdout. Uses spiceypy
when available to compute spkpos over a time grid; this is the desktop-only batch
path described in SPEC Phase 3. Kept small and dependency-light.
"""
import json
import sys


def main() -> int:
    request = json.load(sys.stdin)
    if request.get("kind") != "spkpos-grid":
        json.dump({"rows": []}, sys.stdout)
        return 0

    try:
        import spiceypy as spice
    except ImportError:
        sys.stderr.write("spiceypy is not installed\n")
        return 2

    spice.furnsh(request["metaKernel"])
    try:
        et0 = spice.str2et(request["startUtc"])
        et1 = spice.str2et(request["stopUtc"])
        steps = int(request["steps"])
        rows = []
        for i in range(steps):
            et = et0 + (et1 - et0) * i / max(1, steps - 1)
            pos, _ = spice.spkpos(
                request["target"], et, request["frame"], "NONE", request["observer"]
            )
            rows.append({"et": et, "position": [pos[0], pos[1], pos[2]]})
        json.dump({"rows": rows}, sys.stdout)
        return 0
    finally:
        spice.kclear()


if __name__ == "__main__":
    sys.exit(main())
