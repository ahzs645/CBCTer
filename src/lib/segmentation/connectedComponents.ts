/**
 * 3D connected-component labeling for binary tooth masks, used to separate a
 * single foreground mask (everything the UNet called "tooth") into individual
 * tooth instances fully in the browser. This replaces the offline numpy/scipy
 * separation step of the Python pipeline.
 */

export interface MaskComponent {
  /** Label id written into the returned `labels` array (1-based). */
  id: number;
  /** Number of foreground voxels in the component. */
  voxels: number;
  /** Inclusive-min / exclusive-max bbox as [z0, y0, x0, z1, y1, x1] in crop coords. */
  bbox: [number, number, number, number, number, number];
  /** Centroid in crop coords as [z, y, x] (voxel units). */
  centroid: [number, number, number];
}

export interface ConnectedComponentsResult {
  /** Per-voxel component id in [D, H, W] order (0 = background). */
  labels: Int32Array;
  components: MaskComponent[];
}

function neighborOffsets(connectivity: 6 | 26): Array<[number, number, number]> {
  const offsets: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dz === 0 && dy === 0 && dx === 0) continue;
        const manhattan = Math.abs(dz) + Math.abs(dy) + Math.abs(dx);
        if (connectivity === 6 && manhattan !== 1) continue;
        offsets.push([dz, dy, dx]);
      }
    }
  }
  return offsets;
}

/**
 * Label connected foreground voxels with an iterative flood fill (explicit
 * stack, so it scales to multi-million-voxel crops without blowing the call
 * stack). Returns the label volume plus per-component bbox/centroid/size.
 */
export function labelComponents(
  mask: Uint8Array,
  dims: [number, number, number],
  connectivity: 6 | 26 = 26,
): ConnectedComponentsResult {
  const [depth, height, width] = dims;
  const labels = new Int32Array(mask.length);
  const offsets = neighborOffsets(connectivity);
  const stack = new Int32Array(mask.length);
  const components: MaskComponent[] = [];
  let nextId = 0;

  const indexOf = (z: number, y: number, x: number) =>
    (z * height + y) * width + x;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || labels[start] !== 0) continue;

    nextId += 1;
    let stackTop = 0;
    stack[stackTop++] = start;
    labels[start] = nextId;

    let voxels = 0;
    let z0 = depth;
    let y0 = height;
    let x0 = width;
    let z1 = 0;
    let y1 = 0;
    let x1 = 0;
    let sumZ = 0;
    let sumY = 0;
    let sumX = 0;

    while (stackTop > 0) {
      const index = stack[--stackTop];
      const z = Math.floor(index / (height * width));
      const rem = index - z * height * width;
      const y = Math.floor(rem / width);
      const x = rem - y * width;

      voxels += 1;
      sumZ += z;
      sumY += y;
      sumX += x;
      if (z < z0) z0 = z;
      if (y < y0) y0 = y;
      if (x < x0) x0 = x;
      if (z >= z1) z1 = z + 1;
      if (y >= y1) y1 = y + 1;
      if (x >= x1) x1 = x + 1;

      for (const [dz, dy, dx] of offsets) {
        const nz = z + dz;
        const ny = y + dy;
        const nx = x + dx;
        if (nz < 0 || ny < 0 || nx < 0) continue;
        if (nz >= depth || ny >= height || nx >= width) continue;
        const nIndex = indexOf(nz, ny, nx);
        if (mask[nIndex] === 0 || labels[nIndex] !== 0) continue;
        labels[nIndex] = nextId;
        stack[stackTop++] = nIndex;
      }
    }

    components.push({
      id: nextId,
      voxels,
      bbox: [z0, y0, x0, z1, y1, x1],
      centroid: [sumZ / voxels, sumY / voxels, sumX / voxels],
    });
  }

  return { labels, components };
}
