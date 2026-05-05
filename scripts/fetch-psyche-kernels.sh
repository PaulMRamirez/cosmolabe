#!/usr/bin/env bash
# Downloads Psyche mission SPICE kernels.
#
# Includes the full reconstructed trajectory from launch (2023-10-13) through
# the most recent NAIF publication (~2026-02), plus the latest reference
# trajectory extending to Psyche arrival (2029-06-26). Total ~125 MB.
#
# Attitude (CK) is intentionally omitted — Psyche's per-week CK files are
# 150 MB each, which is impractical to ship. The catalog uses an analytical
# Sun-pointing rotation model instead.
#
# Usage: ./scripts/fetch-psyche-kernels.sh
# Output: apps/viewer/test-catalogs/kernels/psyche/

set -euo pipefail

DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels/psyche"
mkdir -p "$DEST"

NAIF_PSYCHE="https://naif.jpl.nasa.gov/pub/naif/PSYCHE/kernels"
NAIF_GENERIC="https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

# Mars satellite ephemeris — needed because de440s.bsp omits body 499 (Mars
# itself, as opposed to Mars Barycenter). Without this, geometry queries
# targeting Mars during the flyby return "insufficient ephemeris data" and
# the viewer silently falls back to a coarse barycenter approximation.
GENERIC_DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels"
mkdir -p "$GENERIC_DEST"
if [ ! -f "$GENERIC_DEST/mar099s.bsp" ]; then
  echo "  [fetch] mar099s.bsp (Mars + Phobos + Deimos, 64 MB) ..."
  curl -fSL --progress-bar "$NAIF_GENERIC/spk/satellites/mar099s.bsp" -o "$GENERIC_DEST/mar099s.bsp"
else
  echo "  [skip] mar099s.bsp (already exists)"
fi

# (subdir, filename)
KERNELS=(
  # Frame, clock, instruments — small, always-include
  "fk|psyche_fk_v10.tf"
  "sclk|PSYC_255_SCLKSCET.00121.tsc"
  "ik|psyche_imager_v05.ti"
  "ik|psyche_grns_v04.ti"
  "ik|psyche_mag_v04.ti"
  "ik|psyche_struct_v03.ti"

  # NOTE: Spacecraft attitude (CK) is intentionally omitted. NAIF publishes
  # weekly CK files for Psyche; once mission ramped up they're ~150 MB each
  # (many GB total). Catalog uses an analytical Nadir-to-Sun rotation model
  # — visually approximate during cruise but consistent across the entire
  # 2023→2031 timeline rather than only inside a partial CK window.

  # Original launch-time merged design — covers full mission 2023-10-13 → 2031-11-01,
  # including the science-phase orbits A→D at asteroid (16) Psyche. Lowest fidelity
  # but the only public source for the post-arrival orbital phase. Superseded by
  # ref_260223 / sc-eph / rec where they overlap.
  "spk|psyche_ref_231013-311101_231016_v1_merged.bsp"

  # Long-arc reference — covers Mars flyby through Psyche arrival
  # (low fidelity; superseded by sc-eph and rec where they overlap)
  "spk|psyche_ref_260223-290626_260217_v1.bsp"

  # Operational spacecraft ephemeris — Oct 2025 → Aug 2026, includes the
  # actual planned Mars flyby (2026-05-23). Higher fidelity than ref_.
  "spk|psyche_sc-eph_251014-260801_260331_v1.bsp"

  # Reconstructed trajectory — launch (2023-10-13) through 2026-02-23.
  # Segments overlap slightly at week boundaries; SPICE handles this.
  # Listed last so reconstructed data wins over predicted where they overlap.
  "spk|psyche_rec_231013-231018_v1.bsp"
  "spk|psyche_rec_231016-231210_231220_v1.bsp"
  "spk|psyche_rec_231207-240304_240321_v1.bsp"
  "spk|psyche_rec_240301-240514_240530_v1.bsp"
  "spk|psyche_rec_240512-240806_240826_v1.bsp"
  "spk|psyche_rec_240805-241203_241210_v1.bsp"
  "spk|psyche_rec_241125-250225_250319_v2.bsp"
  "spk|psyche_rec_250225-250617_250624_v1.bsp"
  "spk|psyche_rec_250616-250812_250909_v1.bsp"
  "spk|psyche_rec_250812-251006_251119_v1.bsp"
  "spk|psyche_rec_251005-260223_260309_v1.bsp"
)

for pair in "${KERNELS[@]}"; do
  IFS='|' read -r subdir filename <<< "$pair"
  dest_file="$DEST/$filename"
  if [ -f "$dest_file" ]; then
    echo "  [skip] $filename (already exists)"
    continue
  fi
  echo "  [fetch] $filename ..."
  curl -fSL --progress-bar "$NAIF_PSYCHE/$subdir/$filename" -o "$dest_file"
done

echo ""
echo "Done! Psyche kernels saved to $DEST"
du -sh "$DEST"
