import type { Vec3 } from '../../types';
import type { ToothCropReader } from '../case/toothExport';
import {
  cropVolume,
  crownDirectionFor,
  estimateGumline,
  selectionBounds,
  toothValues,
} from '../case/toothSelection';
import type { ToothInstance } from '../case/types';
import { parseMesh, type TriMesh } from './meshIo';
import {
  applyMatrix,
  cropMeshNear,
  crownSurfacePoints,
  registerRigid,
  surfaceDeviation,
} from './register';

export interface IntraoralFit {
  /** 4×4 row-major, intraoral scan → CBCT scan frame (mm). */
  matrix: Float64Array;
  rms: number;
  inlierRatio: number;
  /** The parts of the aligned scan over the chosen CBCT crowns. */
  crowns: TriMesh;
  /** CBCT crown surface → intraoral surface distances, mm. */
  deviation: { mean: number; p95: number; max: number };
  crownPoints: number;
}

/**
 * CBCT crown surface points (mm, scan frame) of the chosen teeth: the
 * target an intraoral scan is aligned to. Roots are left out because an
 * intraoral scan only sees crowns and gums.
 */
export async function crownTargetPoints(options: {
  teeth: ToothInstance[];
  allTeeth: ToothInstance[];
  dims: Vec3;
  spacing: Vec3;
  read: ToothCropReader;
  superiorSign?: 1 | -1;
}): Promise<Float32Array> {
  const { teeth, dims, spacing } = options;
  if (!teeth.length) throw new Error('Choose the teeth the scan covers.');
  const box = selectionBounds(teeth, dims, 6)!;
  const groups = [...new Set(teeth.map((t) => t.groupId))];
  const crops = new Map<
    string,
    { scan: ArrayLike<number>; labels: Uint16Array }
  >();
  for (const groupId of groups)
    crops.set(groupId, await options.read(groupId, box.start, box.shape));
  const parts: Float32Array[] = [];
  for (const tooth of teeth) {
    const crop = crops.get(tooth.groupId)!;
    const values = toothValues(tooth);
    const direction = crownDirectionFor(
      tooth,
      options.allTeeth,
      options.superiorSign ?? 1,
    );
    // Estimate the gumline in a small box around this tooth only.
    const own = selectionBounds([tooth], dims, 6)!;
    const local = own.start.map((v, k) => v - box.start[k]) as Vec3;
    const gum = estimateGumline({
      scan: cropVolume(crop.scan as Int16Array, box.shape, local, own.shape),
      labels: cropVolume(crop.labels, box.shape, local, own.shape),
      shape: own.shape,
      spacing,
      value: values,
      crownDirection: direction,
      gumOffsetMm: 1,
    });
    const gumline = gum ? gum.gumline + local[2] : null;
    parts.push(
      crownSurfacePoints(
        crop.labels,
        box.shape,
        box.start,
        spacing,
        new Set(values),
        gumline === null ? undefined : (z) => (z - gumline) * direction >= 0,
      ),
    );
  }
  const fixed = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    fixed.set(part, offset);
    offset += part.length;
  }
  if (fixed.length < 30)
    throw new Error('No crown surface found for these teeth.');
  return fixed;
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}

/**
 * Parse an intraoral scan (STL/PLY/OBJ, mm) and align it rigidly to CBCT
 * crowns, then keep only the parts over the chosen teeth. Pure, so it can
 * run in a worker.
 *
 * `archTarget` should hold the crowns of every tooth in the scanned arch: a
 * full-arch scan matched only to a few front teeth has too much unmatched
 * surface (gums, palate, other teeth) for the global start. After the first
 * fit, the scan is cut to the arch's crowns and refined on that part alone.
 */
export function alignIntraoral(
  bytes: Uint8Array,
  name: string,
  archTarget: Float32Array,
  keepTarget: Float32Array = archTarget,
  keepMm = 1,
): IntraoralFit {
  const mesh = parseMesh(bytes, name);
  const first = registerRigid(mesh.positions, archTarget);
  const moved = applyMatrix(mesh.positions, first.matrix);
  const overArch = cropMeshNear(
    { positions: moved, indices: mesh.indices },
    archTarget,
    2,
  );
  let matrix = first.matrix,
    rms = first.rms,
    inlierRatio = first.inlierRatio;
  if (overArch.positions.length >= 30) {
    const identity = new Float64Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    const refined = registerRigid(overArch.positions, archTarget, {
      initial: identity,
    });
    matrix = multiply(refined.matrix, first.matrix);
    rms = refined.rms;
    inlierRatio = refined.inlierRatio;
  }
  const aligned: TriMesh = {
    positions: applyMatrix(mesh.positions, matrix),
    indices: mesh.indices,
  };
  const crowns = cropMeshNear(aligned, keepTarget, keepMm);
  return {
    matrix,
    rms,
    inlierRatio,
    crowns,
    deviation: surfaceDeviation(keepTarget, crowns.positions),
    crownPoints: keepTarget.length / 3,
  };
}

/** `alignIntraoral` in a Web Worker, so large scans don't freeze the page. */
export function alignInWorker(
  bytes: Uint8Array,
  name: string,
  archTarget: Float32Array,
  keepTarget: Float32Array,
): Promise<IntraoralFit> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/intraoral.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.type === 'result') resolve(event.data.fit);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Alignment worker failed.'));
    };
    worker.postMessage({ bytes, name, archTarget, keepTarget }, [
      bytes.buffer,
      archTarget.buffer,
      ...(keepTarget.buffer === archTarget.buffer ? [] : [keepTarget.buffer]),
    ]);
  });
}

/**
 * Where the intraoral surface crosses a slice: vertices within half a voxel
 * of the plane, as voxel coordinates.
 */
export function meshPointsNearSlice(
  positions: Float32Array,
  spacing: Vec3,
  axis: 0 | 1 | 2,
  index: number,
  limit = 20000,
): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < positions.length && out.length < limit; i += 3) {
    const v: Vec3 = [
      positions[i] / spacing[0],
      positions[i + 1] / spacing[1],
      positions[i + 2] / spacing[2],
    ];
    if (Math.abs(v[axis] - index) <= 0.5) out.push(v);
  }
  return out;
}
