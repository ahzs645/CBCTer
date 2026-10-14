import { VolumeAxis, type SliceImage, type Vec3 } from '../../types';
import type { CanalSliceMark, SliceRatioPoint } from './canal';

/** Pixel size of a slice overlay for an axis (matches the label overlays). */
export function overlaySize(axis: VolumeAxis, dims: Vec3) {
  return axis === VolumeAxis.Axial
    ? { width: dims[0], height: dims[1] }
    : axis === VolumeAxis.Coronal
      ? { width: dims[0], height: dims[2] }
      : { width: dims[1], height: dims[2] };
}

function hex(color: string): [number, number, number] {
  const value = parseInt(color.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Draw markers (canal cross-sections and paths, dots) onto a copy of a slice
 * overlay, creating a transparent overlay when there is none yet.
 */
export function drawOnOverlay(
  image: SliceImage | null | undefined,
  size: { width: number; height: number },
  draw: (plot: (x: number, y: number, alpha?: number) => void) => void,
  color: string,
): SliceImage {
  const { width, height } = image ?? size;
  const data = image
    ? new Uint8ClampedArray(image.data)
    : new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = hex(color);
  const plot = (x: number, y: number, alpha = 1) => {
    const px = Math.round(x),
      py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    const a = Math.round(alpha * 235);
    const keep = 1 - a / 255;
    data[i] = r * (a / 255) + data[i] * keep;
    data[i + 1] = g * (a / 255) + data[i + 1] * keep;
    data[i + 2] = b * (a / 255) + data[i + 2] * keep;
    data[i + 3] = Math.max(data[i + 3], a);
  };
  draw(plot);
  return { ...(image ?? {}), width, height, data, pixelated: true };
}

const toPixel = (p: SliceRatioPoint, width: number, height: number) => ({
  x: p.xRatio * (width - 1),
  y: p.yRatio * (height - 1),
});

/** Rasterise canal marks: ellipse outlines where it crosses, lines along it. */
export function drawCanalMarks(
  image: SliceImage | null | undefined,
  size: { width: number; height: number },
  marks: CanalSliceMark[],
  color = '#f472b6',
): SliceImage | null | undefined {
  if (!marks.length) return image;
  return drawOnOverlay(
    image,
    size,
    (plot) => {
      for (const mark of marks) {
        if (mark.kind === 'cross') {
          const c = toPixel(mark.center, size.width, size.height);
          const rx = Math.max(1.5, mark.radiusXRatio * (size.width - 1));
          const ry = Math.max(1.5, mark.radiusYRatio * (size.height - 1));
          const steps = Math.max(24, Math.ceil(2 * Math.PI * Math.max(rx, ry)));
          for (let k = 0; k < steps; k++) {
            const t = (2 * Math.PI * k) / steps;
            plot(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t));
          }
          plot(c.x, c.y);
        } else {
          for (let k = 1; k < mark.points.length; k++) {
            const a = toPixel(mark.points[k - 1], size.width, size.height);
            const b = toPixel(mark.points[k], size.width, size.height);
            const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1;
            for (let s = 0; s <= n; s++)
              plot(
                a.x + ((b.x - a.x) * s) / n,
                a.y + ((b.y - a.y) * s) / n,
                0.8,
              );
          }
        }
      }
    },
    color,
  );
}

/** Rasterise dots (e.g. an intraoral scan surface cut by the slice). */
export function drawDots(
  image: SliceImage | null | undefined,
  size: { width: number; height: number },
  points: SliceRatioPoint[],
  color = '#22d3ee',
): SliceImage | null | undefined {
  if (!points.length) return image;
  return drawOnOverlay(
    image,
    size,
    (plot) => {
      for (const p of points) {
        const { x, y } = toPixel(p, size.width, size.height);
        plot(x, y);
      }
    },
    color,
  );
}
