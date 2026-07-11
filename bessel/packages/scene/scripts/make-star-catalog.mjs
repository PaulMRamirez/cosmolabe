// Generates a small, deterministic star catalog (RA, Dec, magnitude) committed to
// apps/web/src/assets/bright-stars.json. A real Yale Bright Star / Hipparcos subset
// can replace it; the renderer and parser are the deliverable and consume the same
// {ra, dec, mag} shape. Seeded so the output is reproducible.
//
// Run: node packages/scene/scripts/make-star-catalog.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../apps/web/src/assets/bright-stars.json');

// A handful of the actual brightest stars (RA/Dec degrees, visual magnitude), so
// the field has real anchors, plus a deterministic fill of fainter stars.
const bright = [
  { ra: 101.287, dec: -16.716, mag: -1.46 }, // Sirius
  { ra: 95.988, dec: -52.696, mag: -0.74 }, // Canopus
  { ra: 219.902, dec: -60.834, mag: -0.27 }, // Alpha Centauri
  { ra: 213.915, dec: 19.182, mag: -0.05 }, // Arcturus
  { ra: 279.234, dec: 38.784, mag: 0.03 }, // Vega
  { ra: 79.172, dec: 45.998, mag: 0.08 }, // Capella
  { ra: 78.634, dec: -8.202, mag: 0.13 }, // Rigel
  { ra: 114.825, dec: 5.225, mag: 0.34 }, // Procyon
  { ra: 24.429, dec: -57.237, mag: 0.46 }, // Achernar
  { ra: 88.793, dec: 7.407, mag: 0.5 }, // Betelgeuse
  { ra: 297.696, dec: 8.868, mag: 0.76 }, // Altair
  { ra: 201.298, dec: -11.161, mag: 0.98 }, // Spica
  { ra: 247.352, dec: -26.432, mag: 1.06 }, // Antares
  { ra: 116.329, dec: 28.026, mag: 1.14 }, // Pollux
  { ra: 51.081, dec: 49.861, mag: 1.79 }, // Mirfak
];

// Seeded LCG for a reproducible fill.
let seed = 0x1234abcd;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};

const stars = [...bright];
for (let i = 0; i < 600; i++) {
  // Uniform on the sphere: RA uniform, Dec from arcsin to avoid pole clustering.
  const ra = rng() * 360;
  const dec = (Math.asin(2 * rng() - 1) * 180) / Math.PI;
  // Fainter magnitudes (2..6), weighted toward fainter.
  const mag = 2 + Math.pow(rng(), 0.6) * 4;
  stars.push({ ra: Number(ra.toFixed(3)), dec: Number(dec.toFixed(3)), mag: Number(mag.toFixed(2)) });
}

writeFileSync(out, `${JSON.stringify(stars)}\n`);
console.log(`Wrote ${out} with ${stars.length} stars.`);
