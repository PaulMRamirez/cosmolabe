# Vendored fonts

This folder holds the variable-weight `.woff2` binaries. They are intentionally **not**
committed (license hygiene + size). Populate them once:

```bash
pnpm --filter @bessel/selene-design fetch-fonts
```

That runs `scripts/fetch-fonts.mjs`, which downloads:

- `inter-tight-latin.woff2`  — Inter Tight, latin, variable weight
- `jetbrains-mono-latin.woff2` — JetBrains Mono, latin, variable weight

from the Fontsource jsDelivr CDN. Commit the results (or add a CI step) so your offline
PWA build precaches them. `tokens/fonts.css` references these exact filenames.

Both fonts are OFL-licensed; redistribution within your Apache-2.0 app is fine — keep their
OFL notices if you mirror them elsewhere.
