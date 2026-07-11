# Budget-change log

One line per move of an existing cap in `bessel/.size-limit.json`: date, budget, old to new, cause, session. Additions of new budgets arrive with their justifying commit and are not moves; every change to an existing cap lands here. `/gate` reads this log alongside the scaffolding duty: every cap change since the last gate must have a line with its cause, and the gate summary reports the window's cumulative drift per budget, so growth is reviewed deliberately rather than accreted silently.

- 2026-07-11, lazy analysis bundle, 101 to 104 KB: the seventh analyze tab (the M-0008 grammar demo chunk) (Session 6).
- 2026-07-11, lazy analysis bundle, 104 to 107 KB: shared UI chunks (GroundTrackMap, ProgressRing) hoisted out of single-consumer lazy panels by the second vite entry (Session 7).
- 2026-07-11, lazy analysis bundle, 107 to 109 KB: platform gzip variance (the CI runner measured the identical build at 107.02 KB against 106.69 locally, a 20 byte failure) plus headroom so the cap binds on real growth, not on which machine compressed the bytes (Session 8).
