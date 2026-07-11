// Generates a tiny self-contained glTF 2.0 spacecraft model (a box bus plus a
// dish) with an embedded base64 buffer, committed under apps/web/src/assets. This
// avoids any external binary tooling and keeps the asset small and reviewable.
//
// Run: node packages/scene/scripts/make-spacecraft-gltf.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../apps/web/src/assets/cassini.gltf');

// Box bus [-0.5,0.5]^3 plus a small high-gain-dish disc cap. Keep it tiny.
const positions = [
  // box bus
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  // dish ring (a flat octagon at +Y to suggest the high-gain antenna)
  0.0, 1.2, 0.0,
  0.7, 1.0, 0.0, 0.5, 1.0, 0.5, 0.0, 1.0, 0.7, -0.5, 1.0, 0.5,
  -0.7, 1.0, 0.0, -0.5, 1.0, -0.5, 0.0, 1.0, -0.7, 0.5, 1.0, -0.5,
];
const indices = [
  // box faces (12 triangles)
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
  1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  // dish fan (apex 8, ring 9..16)
  8, 9, 10, 8, 10, 11, 8, 11, 12, 8, 12, 13, 8, 13, 14, 8, 14, 15, 8, 15, 16, 8, 16, 9,
];

const posBytes = new Float32Array(positions);
const idxBytes = new Uint16Array(indices);
// Pad index byte length to a 4-byte boundary for the next view if any.
const posBuf = Buffer.from(posBytes.buffer);
const idxBuf = Buffer.from(idxBytes.buffer);
const buffer = Buffer.concat([posBuf, idxBuf]);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], positions[i + k]);
    max[k] = Math.max(max[k], positions[i + k]);
  }
}

const gltf = {
  asset: { version: '2.0', generator: 'bessel make-spacecraft-gltf' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Cassini', mesh: 0 }],
  meshes: [{ name: 'Cassini', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length, target: 34963 },
  ],
  buffers: [
    {
      byteLength: buffer.length,
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
    },
  ],
};

writeFileSync(out, `${JSON.stringify(gltf, null, 2)}\n`);
console.log(`Wrote ${out} (${JSON.stringify(gltf).length} bytes JSON, ${buffer.length} byte buffer)`);
