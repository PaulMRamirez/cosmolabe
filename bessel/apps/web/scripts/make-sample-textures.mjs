// Generate the small PNG textures the Cassini sample references, so the image
// texture path (body base-map and ring band) is exercised with real files
// rather than only the procedural fallback. These are simple procedural images
// (a few KB each), not photography; replace with real maps when available.
// Run: node apps/web/scripts/make-sample-textures.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/samples/textures/', import.meta.url));
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
  // 10,11,12 = compression, filter, interlace = 0
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
      const [r, g, b, a] = fn(x / width, y / height);
      const i = (y * width + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[i + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return encodePng(width, height, rgba);
}

// Saturn: tan latitude bands (v = latitude), faint longitudinal variation.
const saturn = make(256, 128, (u, v) => {
  const band = 0.82 + 0.18 * Math.sin(v * Math.PI * 9);
  const lon = 0.95 + 0.05 * Math.sin(u * Math.PI * 6);
  const k = band * lon;
  return [214 * k, 196 * k, 150 * k, 255];
});
writeFileSync(new URL('saturn.png', `file://${OUT}`), saturn);

// Saturn rings: radial bands along u (0 inner .. 1 outer), with a darker gap
// (the Cassini division) and varying alpha so the banding reads.
const rings = make(256, 8, (u) => {
  const bands = 0.5 + 0.5 * Math.sin(u * 60) * Math.cos(u * 17);
  const gap = Math.abs(u - 0.62) < 0.03 ? 0.15 : 1; // Cassini division
  const k = (0.55 + 0.45 * bands) * gap;
  return [220 * k, 205 * k, 170 * k, 230 * gap * (0.4 + 0.6 * bands)];
});
writeFileSync(new URL('saturn-rings.png', `file://${OUT}`), rings);

console.log('wrote', OUT + 'saturn.png', saturn.length, 'bytes');
console.log('wrote', OUT + 'saturn-rings.png', rings.length, 'bytes');
