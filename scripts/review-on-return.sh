#!/usr/bin/env sh
# Emit the current review-on-return register: flagged ADRs plus commits in
# Aaron-owned paths since his pre-merge tag. /gate pastes this into
# docs/collab/RE-ENTRY-BRIEF.md.
set -e
cd "$(dirname "$0")/.."
echo "== ADRs flagged review-on-return =="
grep -H "^Review-on-return: yes" docs/adr/*.md | sed 's|docs/adr/||; s|\.md:Review-on-return: yes; | : |'
echo
echo "== Commits in Aaron-owned paths since cosmolabe-pre-merge =="
AARON_PATHS="cosmolabe packages/core packages/render-three packages/render-cesium"
if git rev-parse -q --verify cosmolabe-pre-merge >/dev/null 2>&1; then
  git log --oneline cosmolabe-pre-merge..HEAD -- $AARON_PATHS
else
  echo "(tag cosmolabe-pre-merge not found yet; run after Session 1)"
fi
