import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'public', 'e2e-sample-cbct');
const width = 32;
const height = 32;
const depth = 24;
const voxels = new Int16Array(width * height * depth);

for (let z = 0; z < depth; z += 1) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dz = z - depth / 2;
      const distance = Math.hypot(dx, dy, dz);
      const index = (z * height + y) * width + x;
      voxels[index] = distance < 8 ? 1800 : -800;
    }
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      name: 'E2E Sample CBCT',
      file: 'volume-int16.raw',
      dtype: 'int16',
      byteOrder: 'little-endian',
      dimensions: { width, height, depth },
      spacing: { x: 0.2, y: 0.2, z: 0.2 },
      modality: 'CT',
      fileCount: depth,
      totalBytes: voxels.byteLength,
      scalarRange: [-800, 1800],
      window: { center: 500, width: 2600 },
    },
    null,
    2,
  ),
);
await writeFile(join(outDir, 'volume-int16.raw'), new Uint8Array(voxels.buffer));
