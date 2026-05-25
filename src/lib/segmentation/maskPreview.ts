/**
 * Render a small thumbnail for a separated tooth fully in the browser, so the
 * generated library has the same preview images the Python pipeline produced
 * offline. We project the instance submask (coronal max-intensity along Y) and
 * tint it, giving a recognizable crown-to-root profile for the list/overlay.
 */

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/**
 * @param sub  binary submask in [D, H, W] order (the tooth's bbox crop)
 * @param dims [depth, height, width] of the submask
 * @param color tooth tint as 0xRRGGBB
 * @returns a PNG data URL (transparent background, tinted foreground)
 */
export function maskProjectionDataUrl(
  sub: Uint8Array,
  dims: [number, number, number],
  color: number,
): string {
  const [depth, height, width] = dims;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, depth);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const image = ctx.createImageData(canvas.width, canvas.height);
  const [r, g, b] = hexToRgb(color);

  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      // Count foreground along the Y (coronal) axis for a depth cue.
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        if (sub[(z * height + y) * width + x] !== 0) count += 1;
      }
      const out = (z * canvas.width + x) * 4;
      if (count === 0) {
        image.data[out + 3] = 0;
        continue;
      }
      // Brighter where the tooth is thicker through the projection axis.
      const intensity = 0.45 + 0.55 * Math.min(1, count / Math.max(1, height * 0.5));
      image.data[out] = Math.round(r * intensity);
      image.data[out + 1] = Math.round(g * intensity);
      image.data[out + 2] = Math.round(b * intensity);
      image.data[out + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
