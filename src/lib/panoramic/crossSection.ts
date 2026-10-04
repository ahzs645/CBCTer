import type { LoadedVolume, Vec3 } from '../../types';
import { resampleArch } from './spline';
import type { ArchCurve, PanoramicResult } from './types';
import { mapIntensityToGray } from '../volume/math';
export function toothCrossSection(
  volume: LoadedVolume,
  curve: ArchCurve,
  centre: Vec3,
  options: { widthMm: number; angleDeg: number; window: number; level: number },
): PanoramicResult {
  const [w, h, d] = volume.meta.dimensions,
    s = volume.meta.spacing;
  if (
    !Number.isFinite(options.widthMm) ||
    options.widthMm <= 0 ||
    options.widthMm > 100 ||
    !Number.isFinite(options.angleDeg) ||
    !centre.every(Number.isFinite)
  )
    throw new Error('Invalid cross-section geometry.');
  const samples = resampleArch(curve, s, 0.5).samples,
    cx = centre[0] * s[0],
    cy = centre[1] * s[1];
  const closest = samples.reduce<(typeof samples)[number] | undefined>(
    (best, p) =>
      !best ||
      (p.x - cx) ** 2 + (p.y - cy) ** 2 <
        (best.x - cx) ** 2 + (best.y - cy) ** 2
        ? p
        : best,
    undefined,
  );
  const angle = (options.angleDeg * Math.PI) / 180,
    nx = closest?.nx ?? 1,
    ny = closest?.ny ?? 0,
    dx = nx * Math.cos(angle) - ny * Math.sin(angle),
    dy = nx * Math.sin(angle) + ny * Math.cos(angle);
  const step = Math.max(0.1, Math.min(s[0], s[1])),
    width = Math.min(1024, Math.ceil(options.widthMm / step) + 1),
    height = d,
    data = new Uint8ClampedArray(width * height * 4);
  for (let z = 0; z < d; z++)
    for (let x = 0; x < width; x++) {
      const distance = (x / (width - 1) - 0.5) * options.widthMm,
        px = (cx + dx * distance) / s[0],
        py = (cy + dy * distance) / s[1];
      let value = volume.meta.scalarRange[0];
      if (px >= 0 && py >= 0 && px <= w - 1 && py <= h - 1) {
        const x0 = Math.floor(px),
          y0 = Math.floor(py),
          x1 = Math.min(w - 1, x0 + 1),
          y1 = Math.min(h - 1, y0 + 1),
          fx = px - x0,
          fy = py - y0,
          at = (a: number, b: number) => volume.voxels[(z * h + b) * w + a];
        value =
          at(x0, y0) * (1 - fx) * (1 - fy) +
          at(x1, y0) * fx * (1 - fy) +
          at(x0, y1) * (1 - fx) * fy +
          at(x1, y1) * fx * fy;
      }
      const i = ((d - 1 - z) * width + x) * 4,
        gray = mapIntensityToGray(value, options.window, options.level);
      data[i] = data[i + 1] = data[i + 2] = gray;
      data[i + 3] = 255;
    }
  return {
    width,
    height,
    data,
    mmPerPixelX: options.widthMm / (width - 1),
    mmPerPixelY: s[2],
  };
}
