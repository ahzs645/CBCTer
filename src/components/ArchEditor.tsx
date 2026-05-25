import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedVolume } from '../types';
import { buildAxialMip } from '../lib/panoramic/archFit';
import type { ArchCurve, ArchPoint } from '../lib/panoramic/types';
import { resampleArch } from '../lib/panoramic/spline';

interface ArchEditorProps {
  volume: LoadedVolume;
  zMin: number;
  zMax: number;
  window: number;
  level: number;
  curve: ArchCurve;
  onChange: (curve: ArchCurve) => void;
}

function pointToSegmentDistance(
  p: ArchPoint,
  a: ArchPoint,
  b: ArchPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Editable dental-arch overlay on an axial MIP. The same control-point list
 * feeds auto-fit (seeded by the parent), free dragging, and from-scratch
 * placement — clicking empty space inserts a point into the nearest segment,
 * alt/right-click removes one.
 */
export function ArchEditor({
  volume,
  zMin,
  zMax,
  window,
  level,
  curve,
  onChange,
}: ArchEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const [width, height] = volume.meta.dimensions;
  const [sx, sy] = volume.meta.spacing;

  const mip = useMemo(
    () => buildAxialMip(volume.voxels, volume.meta.dimensions, zMin, zMax),
    [volume, zMin, zMax],
  );

  // Paint the MIP into the canvas with the active window/level.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = mip.width;
    canvas.height = mip.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const low = level - window / 2;
    const w = Math.max(1, window);
    const img = ctx.createImageData(mip.width, mip.height);
    const out = img.data;
    for (let i = 0, j = 0; i < mip.data.length; i += 1, j += 4) {
      const g = Math.round(
        Math.min(1, Math.max(0, (mip.data[i] - low) / w)) * 255,
      );
      out[j] = g;
      out[j + 1] = g;
      out[j + 2] = g;
      out[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [mip, window, level]);

  const polyline = useMemo(() => {
    const arch = resampleArch(curve, volume.meta.spacing, 1);
    return arch.samples.map((s) => `${s.x / sx},${s.y / sy}`).join(' ');
  }, [curve, volume.meta.spacing, sx, sy]);

  const toVoxel = (event: PointerEvent): ArchPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const handleBackgroundDown = (event: PointerEvent) => {
    if (dragIndex !== null) return;
    const p = toVoxel(event);
    if (!p) return;
    const points = curve.controlPoints;
    if (points.length < 2) {
      onChange({ controlPoints: [...points, p] });
      return;
    }
    // Insert into the nearest segment (or extend the closest end).
    let bestSeg = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      const d = pointToSegmentDistance(p, points[i], points[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        bestSeg = i;
      }
    }
    const distStart = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    const distEnd = Math.hypot(
      p.x - points[points.length - 1].x,
      p.y - points[points.length - 1].y,
    );
    const next = [...points];
    if (distStart < bestDist && distStart <= distEnd) {
      next.unshift(p);
    } else if (distEnd < bestDist) {
      next.push(p);
    } else {
      next.splice(bestSeg + 1, 0, p);
    }
    onChange({ controlPoints: next });
  };

  const handleHandleDown = (index: number) => (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button === 2 || event.altKey) {
      if (curve.controlPoints.length > 2) {
        const next = curve.controlPoints.filter((_, i) => i !== index);
        onChange({ controlPoints: next });
      }
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    setDragIndex(index);
  };

  const handleMove = (event: PointerEvent) => {
    if (dragIndex === null) return;
    const p = toVoxel(event);
    if (!p) return;
    const next = [...curve.controlPoints];
    next[dragIndex] = {
      x: Math.max(0, Math.min(width - 1, p.x)),
      y: Math.max(0, Math.min(height - 1, p.y)),
    };
    onChange({ controlPoints: next });
  };

  const handleUp = (event: PointerEvent) => {
    if (dragIndex !== null) {
      const target = event.target as Element;
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      setDragIndex(null);
    }
  };

  const handleRadius = Math.max(3, width * 0.012);

  return (
    <div
      className="relative mx-auto"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: '100%' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full bg-black"
        style={{ imageRendering: 'auto' }}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={handleBackgroundDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {polyline ? (
          <polyline
            points={polyline}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={Math.max(1, width * 0.004)}
            strokeOpacity={0.9}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {curve.controlPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={handleRadius}
            fill={dragIndex === i ? '#f59e0b' : '#0ea5e9'}
            stroke="#0b1220"
            strokeWidth={Math.max(0.5, width * 0.0015)}
            className="cursor-grab"
            onPointerDown={handleHandleDown(i)}
          />
        ))}
      </svg>
    </div>
  );
}
