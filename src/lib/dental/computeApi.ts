import type { Vec3 } from '../../types';
import { growToothFromClick } from './growTooth';
import { sharedSurfaceMm2 } from '../case/toothSelection';
import { archModelPart, meshToothPart } from '../case/toothExport';
import type { ArchModelOptions } from '../case/archModel';
import {
  canalCenterline,
  snapToCanal,
  toothCanalDistances,
  traceCanalPath,
  type CanalToothLabels,
  type CanalVolumeRead,
} from './canal';
import {
  findDarkAreas,
  toothAxes,
  type DarkArea,
  type ToothAxes,
} from './toothFocus';

/**
 * The slow dental computations, as plain-data functions. The page calls them
 * through `computeClient`, which runs them in a worker so the page stays
 * responsive; tests and workerless environments call them directly.
 */
export const computeApi = {
  /** Long axis and dark areas of one tooth. */
  toothCheck(input: {
    scan: ArrayLike<number>;
    labels: Uint16Array;
    shape: Vec3;
    spacing: Vec3;
    values: number[];
    crownDirection: 1 | -1;
  }): { axes: ToothAxes | null; areas: DarkArea[] } {
    const axes = toothAxes(
      input.labels,
      input.shape,
      input.values,
      input.spacing,
      input.crownDirection,
    );
    return {
      axes,
      areas: axes ? findDarkAreas({ ...input, axes }) : [],
    };
  },
  snapCanal(input: {
    read: CanalVolumeRead;
    point: Vec3;
    spacing: Vec3;
    radiusMm: number;
  }): Vec3 {
    return snapToCanal(input.read, input.point, input.spacing, input.radiusMm);
  },
  /** Least-cost path between two canal points, and its smooth centreline. */
  traceCanal(input: {
    read: CanalVolumeRead;
    from: Vec3;
    to: Vec3;
    spacing: Vec3;
  }): { centerline: Vec3[]; lengthMm: number } {
    const path = traceCanalPath(
      input.read,
      input.from,
      input.to,
      input.spacing,
    );
    const centerline = canalCenterline(path, input.spacing);
    let lengthMm = 0;
    for (let i = 1; i < centerline.length; i++)
      lengthMm += Math.hypot(
        ...[0, 1, 2].map(
          (k) => (centerline[i][k] - centerline[i - 1][k]) * input.spacing[k],
        ),
      );
    return { centerline, lengthMm };
  },
  canalDistances(input: {
    centerline: Vec3[];
    radiusMm: number;
    spacing: Vec3;
    teeth: CanalToothLabels[];
  }) {
    return toothCanalDistances(
      input.centerline,
      input.radiusMm,
      input.spacing,
      input.teeth,
    );
  },
  sharedSurface(input: {
    labels: Uint16Array;
    shape: Vec3;
    spacing: Vec3;
    a: number;
    b: number;
  }): number {
    return sharedSurfaceMm2(
      input.labels,
      input.shape,
      input.spacing,
      input.a,
      input.b,
    );
  },
  /** Outline a tooth the model missed, from a click. */
  growTooth: growToothFromClick,
  toothPart: meshToothPart,
  archModel: (options: ArchModelOptions & { smaller?: boolean }) =>
    archModelPart(options),
};

export type ComputeApi = typeof computeApi;
export type ComputeMethod = keyof ComputeApi;
