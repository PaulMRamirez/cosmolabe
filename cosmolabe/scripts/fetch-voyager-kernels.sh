#!/usr/bin/env bash
# Downloads Voyager 1 + Voyager 2 SPICE kernels.
#
# Covers full launch (1977) through ~2100 trajectory plus mission-long attitude
# (super_v2 CK files) and per-encounter SPK refinements at Jupiter, Saturn,
# Uranus, Neptune. Total ~85 MB.
#
# Usage: ./scripts/fetch-voyager-kernels.sh
# Output: apps/viewer/test-catalogs/kernels/voyager/

set -euo pipefail

DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels/voyager"
mkdir -p "$DEST"

NAIF_VOYAGER="https://naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels"
NAIF_GENERIC="https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

# Jupiter (599) and Saturn (699) individual ephemerides — required because
# de440s.bsp only contains planet *barycenters* and Earth/Moon individually.
# Without these, the renderer can't place Jupiter/Saturn meshes at the
# encounter epochs and the Voyagers appear to fly past empty space.
GENERIC_DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels"
mkdir -p "$GENERIC_DEST"
for pair in "spk/satellites/jup348.bsp|jup348.bsp|Jupiter ephemeris (57 MB)" \
            "spk/satellites/sat459.bsp|sat459.bsp|Saturn ephemeris (80 MB)"; do
  IFS='|' read -r remote local label <<< "$pair"
  if [ -f "$GENERIC_DEST/$local" ]; then
    echo "  [skip] $local (already exists)"
  else
    echo "  [fetch] $local — $label ..."
    curl -fSL --progress-bar "$NAIF_GENERIC/$remote" -o "$GENERIC_DEST/$local"
  fi
done

# (subdir, filename)
KERNELS=(
  # Frames + clocks — small, always-include
  "fk|vg1_v02.tf"
  "fk|vg2_v02.tf"
  "sclk|vg100051.tsc"
  "sclk|vg200051.tsc"

  # NOTE: Voyager instrument kernels (IK) and per-encounter scan-platform
  # CK files (vg{1,2}_{jup,sat}_qmw_{na,wa}.bc) are intentionally not fetched.
  # The v02 IK files define cameras as -31101/-31102 mounted on SCAN_PLATFORM
  # (-31100), but the qmw CK files use the legacy -31001/-31002 IDs which
  # aren't connected to anything in the v02 frame model — SPICE cannot chain
  # through to compute camera pointing. The catalog therefore omits sensor
  # frustums for Voyager.

  # Merged trajectories — continuous from launch through 2031.
  # x2100 only starts after the planetary tour (1980-12 for V1, 1988-11 for V2),
  # so without these the launch-and-cruise + Jupiter and Saturn encounters
  # would have no SPK coverage and the spacecraft would freeze in place.
  "spk|Voyager_1.a54206u_V0.2_merged.bsp"
  "spk|Voyager_2.m05016u.merged.bsp"

  # Long-arc trajectories (1980→2100 for V1, 1988→2100 for V2)
  "spk|vgr1.x2100.bsp"
  "spk|vgr2.x2100.bsp"

  # Per-encounter higher-fidelity trajectory refinements
  "spk|vgr1_jup230.bsp"
  "spk|vgr1_sat337.bsp"
  "spk|vgr2_jup230.bsp"
  "spk|vgr2_sat337.bsp"
  "spk|vgr2.ura182.bsp"
  "spk|vgr2_nep097.bsp"

  # Full-mission spacecraft-bus attitude
  "ck|vgr1_super_v2.bc"
  "ck|vgr2_super_v2.bc"
)

for pair in "${KERNELS[@]}"; do
  IFS='|' read -r subdir filename <<< "$pair"
  dest_file="$DEST/$filename"
  if [ -f "$dest_file" ]; then
    echo "  [skip] $filename (already exists)"
    continue
  fi
  echo "  [fetch] $filename ..."
  curl -fSL --progress-bar "$NAIF_VOYAGER/$subdir/$filename" -o "$dest_file"
done

echo ""
echo "Done! Voyager kernels saved to $DEST"
du -sh "$DEST"
