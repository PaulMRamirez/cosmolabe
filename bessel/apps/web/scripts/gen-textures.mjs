// Generate the small procedural PNG textures the parity fixtures reference so the
// IMAGE texture path (body base-map and the radial ring strip) is exercised with
// real files, not only the in-engine procedural fallback. Output goes to the
// gitignored apps/web/public/textures/ dir and is served as separate static
// assets (NOT bundled into the JS shell), so it never counts against the JS size
// budget. Each PNG is a few KB. These are procedural images, not photography;
// run `pnpm fetch:textures` (documented, opt-in) to drop real NASA basemaps into
// the same dir. Run: node apps/web/scripts/gen-textures.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/textures/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Encode an RGBA pixel buffer (width*height*4) as an 8-bit PNG.
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function make(width, height, fn) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x / Math.max(1, width - 1), height === 1 ? 0 : y / (height - 1));
      const i = (y * width + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[i + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return encodePng(width, height, rgba);
}

function write(name, png) {
  writeFileSync(new URL(name, `file://${OUT}`), png);
  console.log('wrote', OUT + name, png.length, 'bytes');
}

// Saturn body: tan latitude bands (v = latitude), faint longitudinal variation.
// 256x128 keeps the PNG well under the 30 KB per-asset cap while reading as a
// surface; bump to 512x256 only if a real basemap is dropped in via fetch:textures.
write(
  'saturn.png',
  make(256, 128, (u, v) => {
    const band = 0.82 + 0.18 * Math.sin(v * Math.PI * 10);
    const lon = 0.95 + 0.05 * Math.sin(u * Math.PI * 6);
    const k = band * lon;
    return [214 * k, 196 * k, 150 * k, 255];
  }),
);

// Saturn rings: a horizontal radial strip (u = radius, inner -> outer), height 1,
// with a true Cassini-Division alpha gap at ~0.62 of the radial span. The ring
// geometry samples only the v=0 row, so height 1 is correct and minimal.
const CASSINI = 0.62;
write(
  'saturn-rings.png',
  make(512, 1, (u) => {
    const ringlet = 0.7 + 0.3 * Math.sin(u * 90);
    const inGap = Math.abs(u - CASSINI) < 0.025;
    const k = 0.55 + 0.45 * ringlet;
    return [
      220 * k,
      205 * k,
      170 * k,
      inGap ? 0 : 230 * (0.4 + 0.6 * ringlet),
    ];
  }),
);
