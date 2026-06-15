# AGENTS.md

This project keeps its canonical agent context in CLAUDE.md, which is the file
Claude Code reads at session start. This AGENTS.md exists only so non-Claude agent
harnesses that look for AGENTS.md are pointed to the right place. If you do not use
other harnesses, you can delete this file.

See: ./CLAUDE.md (authoritative in-session operating manual)
Requirements: ./SPEC.md
Implemented status: ./docs/PARITY_MATRIX.md
Binding decisions: ./docs/adr/

One hard rule worth repeating because it is easy to violate: do not use em dashes
anywhere (code, comments, docs, commits, UI copy). Use commas, colons, parentheses,
or semicolons.
