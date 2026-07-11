# Goal: repo genesis

Outcome: the cosmolabe monorepo exists with both parents' history, the documentation seed landed, and CI green on both imported trees.

Steps: initialize the repo (pnpm workspaces, Apache-2.0, DCO). Subtree-merge bessel and cosmolabe preserving history, never with --squash. For cosmolabe (public): add the cosmolabe-upstream remote, fetch, tag the fetched head as cosmolabe-pre-merge, then `git subtree add --prefix=cosmolabe cosmolabe-upstream main`; tag the bessel parent as bessel-pre-merge the same way. Aaron's repository is never pushed to. Restructure into packages/ in separate `git mv` commits so blame and --follow survive. Land the seed (CLAUDE.md, AGENTS.md, docs/, .claude/commands/). Archive bessel's pre-merge phase goal files to docs/goals/archive/. Port the CI pattern: unified `pnpm verify` gate, Pages deploy via OIDC with concurrency control, branch protection requiring CI on PRs to main. Add scripts/fetch-kernels with checksums and wire the pack-min cache into CI. Do not modify any cosmolabe-heritage source in this session beyond what the workspace merge mechanically requires.

Verified by: `pnpm verify` green at root; both tags pushed; docs render on GitHub; a no-op PR demonstrates branch protection; the dash sweep (grep for em and en dashes across docs and .claude) returns nothing.

Exit: run /verify-spec, commit the report, then draft the Session 2 goal file (measurement rig: baseline capture from cosmolabe pre-repoint state, purity lint, jitter scaffold, bake-off evidence for M-0001 and M-0003).
