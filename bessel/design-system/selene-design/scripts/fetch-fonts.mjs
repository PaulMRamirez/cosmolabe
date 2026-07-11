// Downloads the variable woff2 binaries for Inter Tight + JetBrains Mono into
// src/tokens/fonts/. Node 22+ (global fetch). Run: `pnpm fetch-fonts`.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'tokens', 'fonts');

// Fontsource static CDN — variable ("vf"), latin subset, weight axis, normal style.
const FONTS = [
  {
    file: 'inter-tight-latin.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter-tight:vf@latest/latin-wght-normal.woff2',
  },
  {
    file: 'jetbrains-mono-latin.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2',
  },
];

await mkdir(out, { recursive: true });

for (const { file, url } of FONTS) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} — ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(out, file), buf);
  console.log(`\u2713 ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
}

console.log('Fonts vendored to src/tokens/fonts/. Commit them for offline PWA precaching.');
