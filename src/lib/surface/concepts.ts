export type SurfaceGenerationQuality = "draft" | "balanced" | "final";

export interface SurfaceGenerationOptions {
  quality: SurfaceGenerationQuality;
  extraction: "voxel" | "iso";
  fillHoles: boolean;
  keepLargestComponent: boolean;
  splitDisconnectedComponents: boolean;
  smoothIterations: number;
  decimateReduction: number;
}

export const SURFACE_GENERATION_PRESETS: Record<
  SurfaceGenerationQuality,
  SurfaceGenerationOptions
> = {
  draft: {
    quality: "draft",
    extraction: "voxel",
    fillHoles: false,
    keepLargestComponent: true,
    splitDisconnectedComponents: false,
    smoothIterations: 4,
    decimateReduction: 0.35,
  },
  balanced: {
    quality: "balanced",
    extraction: "iso",
    fillHoles: true,
    keepLargestComponent: true,
    splitDisconnectedComponents: false,
    smoothIterations: 12,
    decimateReduction: 0.2,
  },
  final: {
    quality: "final",
    extraction: "iso",
    fillHoles: true,
    keepLargestComponent: false,
    splitDisconnectedComponents: false,
    smoothIterations: 24,
    decimateReduction: 0.05,
  },
};

export function estimateVoxelSurfaceTriangleCount(
  mask: Uint8Array,
  dims: [number, number, number],
): number {
  const [depth, height, width] = dims;
  const at = (z: number, y: number, x: number) => {
    if (z < 0 || y < 0 || x < 0 || z >= depth || y >= height || x >= width) {
      return 0;
    }
    return mask[(z * height + y) * width + x];
  };
  let exposedFaces = 0;
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!at(z, y, x)) continue;
        if (!at(z, y, x - 1)) exposedFaces += 1;
        if (!at(z, y, x + 1)) exposedFaces += 1;
        if (!at(z, y - 1, x)) exposedFaces += 1;
        if (!at(z, y + 1, x)) exposedFaces += 1;
        if (!at(z - 1, y, x)) exposedFaces += 1;
        if (!at(z + 1, y, x)) exposedFaces += 1;
      }
    }
  }
  return exposedFaces * 2;
}

export function estimateVoxelSurfaceAreaMm2(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: [number, number, number],
): number {
  const [depth, height, width] = dims;
  const [sx, sy, sz] = spacing;
  const yz = sy * sz;
  const xz = sx * sz;
  const xy = sx * sy;
  const at = (z: number, y: number, x: number) => {
    if (z < 0 || y < 0 || x < 0 || z >= depth || y >= height || x >= width) {
      return 0;
    }
    return mask[(z * height + y) * width + x];
  };
  let area = 0;
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!at(z, y, x)) continue;
        if (!at(z, y, x - 1)) area += yz;
        if (!at(z, y, x + 1)) area += yz;
        if (!at(z, y - 1, x)) area += xz;
        if (!at(z, y + 1, x)) area += xz;
        if (!at(z - 1, y, x)) area += xy;
        if (!at(z + 1, y, x)) area += xy;
      }
    }
  }
  return area;
}
