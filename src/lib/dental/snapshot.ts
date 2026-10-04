import type { SliceImage } from '../../types';

/**
 * Renders MPR slices (plus overlays and saved measurements) into standalone
 * canvases for the PNG export and the printable report. It works from the
 * slice buffers rather than on-screen canvases so every plane can be
 * captured, even on phones where only one pane is visible.
 */

export interface SnapshotShape {
  kind: 'distance' | 'angle' | 'ellipse' | 'polygon';
  points: Array<{ xRatio: number; yRatio: number }>;
  label: string;
}

export interface SliceSnapshotInput {
  image: SliceImage;
  overlay?: SliceImage | null;
  shapes?: SnapshotShape[];
  invert?: boolean;
  title: string;
  color: string;
  /** In-plane mm per image pixel, used for the scale bar. */
  mmPerPixel?: { x: number; y: number };
  /** Longest output side in CSS pixels. */
  maxSide?: number;
}

function sliceToCanvas(image: SliceImage, invert: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const data = new Uint8ClampedArray(image.data);
  if (invert) {
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 255 - data[offset];
      data[offset + 1] = 255 - data[offset + 1];
      data[offset + 2] = 255 - data[offset + 2];
    }
  }
  const imageData = new ImageData(image.width, image.height);
  imageData.data.set(data);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function drawLabel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
  fontSize = 13,
) {
  context.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  context.textAlign = align;
  context.lineWidth = Math.max(3, fontSize / 4);
  context.strokeStyle = 'rgba(2, 6, 23, 0.9)';
  context.strokeText(text, x, y);
  context.fillStyle = color;
  context.fillText(text, x, y);
}

export function renderSliceSnapshot({
  image,
  overlay,
  shapes = [],
  invert = false,
  title,
  color,
  mmPerPixel,
  maxSide = 720,
}: SliceSnapshotInput): HTMLCanvasElement {
  const aspect = Math.max(0.1, image.displayAspect ?? 1);
  const displayWidth = image.width * aspect;
  const scale = maxSide / Math.max(displayWidth, image.height);
  const width = Math.max(1, Math.round(displayWidth * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  // Labels stay legible when the snapshot is shown scaled down in a report.
  const fontSize = Math.max(14, Math.round(Math.max(width, height) / 28));

  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.drawImage(sliceToCanvas(image, invert), 0, 0, width, height);
  if (overlay) {
    context.drawImage(sliceToCanvas(overlay, false), 0, 0, width, height);
  }

  const toPx = (point: { xRatio: number; yRatio: number }) => ({
    x: point.xRatio * width,
    y: point.yRatio * height,
  });
  context.lineWidth = Math.max(2, fontSize / 9);
  for (const shape of shapes) {
    const points = shape.points.map(toPx);
    if (points.length === 0) continue;
    context.strokeStyle = '#fbbf24';
    context.fillStyle = 'rgba(251, 191, 36, 0.08)';
    context.beginPath();
    if (shape.kind === 'ellipse' && points.length >= 2) {
      context.ellipse(
        (points[0].x + points[1].x) / 2,
        (points[0].y + points[1].y) / 2,
        Math.abs(points[1].x - points[0].x) / 2,
        Math.abs(points[1].y - points[0].y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else {
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      if (shape.kind === 'polygon') {
        context.closePath();
        context.fill();
      }
    }
    context.stroke();
    const anchor =
      shape.kind === 'distance' && points.length >= 2
        ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 - 8 }
        : { x: points[points.length - 1].x + 8, y: points[points.length - 1].y - 8 };
    drawLabel(
      context,
      shape.label,
      anchor.x,
      anchor.y,
      '#fbbf24',
      shape.kind === 'distance' ? 'center' : 'left',
      fontSize,
    );
  }

  drawLabel(context, title, fontSize * 0.6, fontSize * 1.4, color, 'left', fontSize);

  if (mmPerPixel && mmPerPixel.x > 0) {
    const mmPerOutputPx = (image.width * mmPerPixel.x) / width;
    const barMm = mmPerOutputPx * width > 60 ? 10 : 5;
    const barPx = barMm / mmPerOutputPx;
    const x1 = width - fontSize;
    const x0 = x1 - barPx;
    const y = height - fontSize;
    context.strokeStyle = '#f8fafc';
    context.lineWidth = Math.max(2, fontSize / 9);
    context.beginPath();
    context.moveTo(x0, y - 4);
    context.lineTo(x0, y);
    context.lineTo(x1, y);
    context.lineTo(x1, y - 4);
    context.stroke();
    drawLabel(
      context,
      `${barMm} mm`,
      (x0 + x1) / 2,
      y - fontSize * 0.5,
      '#f8fafc',
      'center',
      fontSize,
    );
  }

  return canvas;
}

/** Lay snapshots out side by side on one canvas for a single PNG download. */
export function composeSnapshots(canvases: HTMLCanvasElement[]): HTMLCanvasElement {
  const gap = 6;
  const height = Math.max(1, ...canvases.map((canvas) => canvas.height));
  const scaled = canvases.map((canvas) => ({
    canvas,
    width: Math.round(canvas.width * (height / Math.max(1, canvas.height))),
  }));
  const width =
    scaled.reduce((sum, item) => sum + item.width, 0) +
    gap * Math.max(0, scaled.length - 1);
  const output = document.createElement('canvas');
  output.width = Math.max(1, width);
  output.height = height;
  const context = output.getContext('2d');
  if (!context) return output;
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, output.width, output.height);
  let x = 0;
  for (const item of scaled) {
    context.drawImage(item.canvas, x, 0, item.width, height);
    x += item.width + gap;
  }
  return output;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, 'image/png');
}
