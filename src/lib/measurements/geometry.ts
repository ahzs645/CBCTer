import type { Vec3 } from "../../types";

export type Vec2 = [number, number];

export function distance2d(a: Vec2, b: Vec2, spacing: Vec2 = [1, 1]): number {
  return Math.hypot((b[0] - a[0]) * spacing[0], (b[1] - a[1]) * spacing[1]);
}

export function distance3d(a: Vec3, b: Vec3, spacing: Vec3 = [1, 1, 1]): number {
  return Math.hypot(
    (b[0] - a[0]) * spacing[0],
    (b[1] - a[1]) * spacing[1],
    (b[2] - a[2]) * spacing[2],
  );
}

export function angleDegrees(a: Vec3, vertex: Vec3, b: Vec3): number {
  const av: Vec3 = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
  const bv: Vec3 = [b[0] - vertex[0], b[1] - vertex[1], b[2] - vertex[2]];
  const al = Math.hypot(...av);
  const bl = Math.hypot(...bv);
  if (al === 0 || bl === 0) return 0;
  const cosine = (av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2]) / (al * bl);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function polygonArea(points: Vec2[], spacing: Vec2 = [1, 1]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum +=
      current[0] * spacing[0] * next[1] * spacing[1] -
      next[0] * spacing[0] * current[1] * spacing[1];
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(
  points: Vec2[],
  spacing: Vec2 = [1, 1],
): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    sum += distance2d(points[index], points[(index + 1) % points.length], spacing);
  }
  return sum;
}

export function ellipseArea(radiusX: number, radiusY: number): number {
  return Math.PI * Math.abs(radiusX) * Math.abs(radiusY);
}

export function ellipsePerimeter(radiusX: number, radiusY: number): number {
  const a = Math.abs(radiusX);
  const b = Math.abs(radiusY);
  if (a === 0 || b === 0) return 0;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function densityStats(values: Iterable<number>): {
  min: number;
  max: number;
  mean: number;
  count: number;
} {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
  }
  return {
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    mean: count > 0 ? sum / count : 0,
    count,
  };
}

