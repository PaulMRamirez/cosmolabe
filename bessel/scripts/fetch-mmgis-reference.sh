#!/usr/bin/env bash
# Fetch a shallow, read-only reference copy of MMGIS beside this repository.
# Bessel integrates with MMGIS by URL contract (docs/integrations.md); this
# local copy exists so goal sessions and reviewers can inspect the MMGIS source
# of truth (notably docs/pages/Miscellaneous/Deep_Linking/Deep_Linking.md)
# without network access. The copy lives OUTSIDE this repo to keep the tree
# lean, and must never be committed here.
set -euo pipefail
DEST="${1:-../mmgis-reference}"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --depth 1 origin && git -C "$DEST" reset --hard origin/HEAD
  echo "Updated MMGIS reference at $DEST"
else
  git clone --depth 1 https://github.com/NASA-AMMOS/MMGIS "$DEST"
  echo "Cloned MMGIS reference to $DEST"
fi
git -C "$DEST" log -1 --format="MMGIS reference at commit %h (%ad)" --date=short
