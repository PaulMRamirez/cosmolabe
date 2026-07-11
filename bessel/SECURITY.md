# Security Policy

## Reporting a vulnerability

Please do not open a public issue for suspected vulnerabilities. Use GitHub's
private vulnerability reporting (Security tab, "Report a vulnerability") on this
repository. You will receive an acknowledgment within five business days.

## Scope notes

- Bessel renders mission geometry from SPICE kernels and catalogs. Kernel and
  catalog files are untrusted input: parsers must fail loudly and must not
  execute embedded content.
- The optional kernel proxy (ADR-0005) is read-only and CORS-scoped; report any
  behavior beyond that as a vulnerability.
- Dependencies are audited in CI (pnpm audit, production, high and critical).

## Supported versions

Pre-1.0: only the latest minor release receives fixes. Post-1.0: the latest
minor of the current major.
