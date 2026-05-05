#!/usr/bin/env bash
# Downloads NAIF generic SPICE kernels needed by the base catalog library.
# These are gitignored — run this script after cloning so demos work.
#
# Usage: ./scripts/fetch-kernels.sh
# Output: apps/viewer/test-catalogs/kernels/

set -euo pipefail

DEST="$(dirname "$0")/../apps/viewer/test-catalogs/kernels"
mkdir -p "$DEST"

NAIF="https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

# Core kernels (small, always useful)
KERNELS=(
  "lsk/naif0012.tls"                              # ~5 KB   - leap seconds
  "pck/pck00011.tpc"                              # ~120 KB - body constants (radii, GM, etc.)
  "spk/planets/de440s.bsp"                        # ~32 MB  - planets + Moon (1849-2150)
  "spk/asteroids/codes_300ast_20100725.bsp"       # ~62 MB  - 300 numbered main-belt asteroids
  "spk/asteroids/codes_300ast_20100725.tf"        # ~25 KB  - FK defining ECLIPJ2000_DE405 frame (companion to the SPK)
)

# Note: Satellite kernels are too large for web use:
#   sat441.bsp  = 631 MB (Saturn)
#   jup365.bsp  = 1.1 GB (Jupiter)
#   mar099s.bsp = 64 MB  (Mars)
# Instead, Cosmolabe uses analytical theories (TASS17, L1, Gust86, MarsSat)
# for satellite positions when SPICE kernels aren't available.

for kernel in "${KERNELS[@]}"; do
  filename=$(basename "$kernel")
  dest_file="$DEST/$filename"

  if [ -f "$dest_file" ]; then
    echo "  [skip] $filename (already exists)"
    continue
  fi

  echo "  [fetch] $filename ..."
  curl -fSL --progress-bar "$NAIF/$kernel" -o "$dest_file"
done

echo ""
echo "Done! Kernels saved to $DEST"
du -sh "$DEST"
