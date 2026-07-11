#!/usr/bin/env bash
# Downloads Europa Clipper SPICE kernels.
#
# Most files in the Europa Clipper kernel set are small enough to commit
# directly. The reference trajectory (`ref_trj_scpse.bsp`, ~46 MB) is gitignored
# and fetched here.
#
# Usage: ./scripts/fetch-europa-clipper-kernels.sh
# Output: apps/viewer/test-catalogs/kernels/europa-clipper/

set -euo pipefail

DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels/europa-clipper"
mkdir -p "$DEST"

NAIF_CLIPPER="https://naif.jpl.nasa.gov/pub/naif/EUROPACLIPPER/kernels"

# (local_filename, remote_path) — local name kept short for the catalog reference;
# remote name encodes the launch / arrival date in NAIF's canonical scheme.
KERNELS=(
  "ref_trj_scpse.bsp|spk/ref_trj_241014_340903_21F31_MEGA_L241014_A300411_LP05_V7_scpse.bsp"
)

for pair in "${KERNELS[@]}"; do
  IFS='|' read -r local_name remote_path <<< "$pair"
  dest_file="$DEST/$local_name"
  if [ -f "$dest_file" ]; then
    echo "  [skip] $local_name (already exists)"
    continue
  fi
  echo "  [fetch] $local_name ..."
  curl -fSL --progress-bar "$NAIF_CLIPPER/$remote_path" -o "$dest_file"
done

echo ""
echo "Done! Europa Clipper kernels saved to $DEST"
du -sh "$DEST"
