import type {
  BoxGeometry,
  Data3DTexture,
  DataTexture,
  Material,
  Mesh,
  ShaderMaterial,
  Texture,
} from 'three';
import type { PreparedVolumeFor3D } from '../../../types';
import type {
  ThreeModule,
  VolumeShaderModule,
  VolumeShaderUniforms,
} from '../types';

export function buildTexture(
  three: ThreeModule,
  volume: PreparedVolumeFor3D,
): Data3DTexture {
  const texture = new three.Data3DTexture(
    volume.voxels,
    volume.dimensions[0],
    volume.dimensions[1],
    volume.dimensions[2],
  );
  texture.format = three.RedFormat;
  texture.type = three.UnsignedByteType;
  texture.minFilter = three.LinearFilter;
  texture.magFilter = three.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

import type { VolumeColormap } from '../types';

// Each colormap is a set of [stop, r, g, b] control points (0..255) that are
// linearly interpolated across the 256-entry transfer function.
const COLORMAP_STOPS: Record<VolumeColormap, [number, number, number, number][]> =
  {
    grayscale: [
      [0, 18, 18, 18],
      [1, 255, 255, 255],
    ],
    bone: [
      [0, 6, 8, 16],
      [0.5, 92, 104, 124],
      [1, 236, 244, 255],
    ],
    hot: [
      [0, 8, 0, 0],
      [0.4, 184, 28, 0],
      [0.72, 255, 162, 28],
      [1, 255, 255, 224],
    ],
    viridis: [
      [0, 68, 1, 84],
      [0.33, 59, 82, 139],
      [0.66, 33, 145, 140],
      [1, 253, 231, 37],
    ],
  };

function sampleColormap(
  stops: [number, number, number, number][],
  t: number,
): [number, number, number] {
  for (let i = 1; i < stops.length; i += 1) {
    const [s1, r1, g1, b1] = stops[i];
    if (t <= s1 || i === stops.length - 1) {
      const [s0, r0, g0, b0] = stops[i - 1];
      const span = s1 - s0 || 1;
      const f = Math.min(1, Math.max(0, (t - s0) / span));
      return [
        Math.round(r0 + (r1 - r0) * f),
        Math.round(g0 + (g1 - g0) * f),
        Math.round(b0 + (b1 - b0) * f),
      ];
    }
  }
  const [, r, g, b] = stops[stops.length - 1];
  return [r, g, b];
}

export function buildColormap(three: ThreeModule): DataTexture {
  const data = new Uint8Array(256 * 4);
  const texture = new three.DataTexture(data, 256, 1, three.RGBAFormat);
  texture.minFilter = three.LinearFilter;
  texture.magFilter = three.LinearFilter;
  applyColormap(texture, 'grayscale', 1);
  return texture;
}

/** Rewrite the transfer-function texture with `style` and an alpha ramp scaled
 * by `opacity` (0..1). */
export function applyColormap(
  texture: DataTexture,
  style: VolumeColormap,
  opacity: number,
): void {
  const data = texture.image.data as Uint8Array;
  const scale = Math.min(1, Math.max(0, opacity));
  const stops = COLORMAP_STOPS[style] ?? COLORMAP_STOPS.grayscale;
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const [r, g, b] = sampleColormap(stops, t);
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = Math.round((10 + t * 245) * scale);
  }
  texture.needsUpdate = true;
}

export function buildMaterial(
  three: ThreeModule,
  volumeShader: VolumeShaderModule,
  volume: PreparedVolumeFor3D,
  texture: Data3DTexture,
  colormap: Texture,
): ShaderMaterial {
  const shader = volumeShader.VolumeRenderShader1;
  const uniforms = three.UniformsUtils.clone(
    shader.uniforms,
  ) as VolumeShaderUniforms;
  const scalarRange = Math.max(
    1,
    volume.scalarRange[1] - volume.scalarRange[0],
  );
  const normalizedThreshold = three.MathUtils.clamp(
    (volume.threshold - volume.scalarRange[0]) / scalarRange,
    0.02,
    0.98,
  );

  uniforms.u_data.value = texture;
  uniforms.u_size.value.set(
    volume.dimensions[0],
    volume.dimensions[1],
    volume.dimensions[2],
  );
  uniforms.u_clim.value.set(0, 1);
  uniforms.u_renderstyle.value = 0;
  uniforms.u_renderthreshold.value = normalizedThreshold;
  uniforms.u_cmdata.value = colormap;

  return new three.ShaderMaterial({
    uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    side: three.BackSide,
    transparent: false,
  });
}

export function buildVolumeMesh(
  three: ThreeModule,
  volume: PreparedVolumeFor3D,
  material: Material,
): Mesh<BoxGeometry, Material> {
  const geometry: BoxGeometry = new three.BoxGeometry(
    Math.max(1, volume.dimensions[0] - 1),
    Math.max(1, volume.dimensions[1] - 1),
    Math.max(1, volume.dimensions[2] - 1),
  );
  geometry.translate(
    (volume.dimensions[0] - 1) / 2,
    (volume.dimensions[1] - 1) / 2,
    (volume.dimensions[2] - 1) / 2,
  );

  return new three.Mesh(geometry, material);
}
