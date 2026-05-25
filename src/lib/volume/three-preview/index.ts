import type { PreparedVolumeFor3D, VolumeCursor } from '../../../types';
import type {
  ThreeModule,
  ThreePreviewInstance,
  TrackballControlsModule,
  VolumeShaderModule,
  VolumeShaderUniforms,
  VolumeViewPreset,
} from '../types';
import {
  applyDistanceLimits,
  cursorToWorldTarget,
  resolveAxisScale,
} from './camera';
import { buildCursorPlanes } from './cursor-planes';
import {
  buildColormap,
  buildMaterial,
  buildTexture,
  buildVolumeMesh,
  setColormapOpacity,
} from './volume-object';

export type { ThreePreviewInstance } from '../types';

export async function createThreePreview(
  host: HTMLDivElement,
  volume: PreparedVolumeFor3D,
): Promise<ThreePreviewInstance> {
  const [three, trackballControls, volumeShader] = await Promise.all([
    import('three'),
    import('three/addons/controls/TrackballControls.js'),
    import('three/addons/shaders/VolumeShader.js'),
  ]);

  return buildPreview(three, trackballControls, volumeShader, host, volume);
}

function buildPreview(
  three: ThreeModule,
  trackballControls: TrackballControlsModule,
  volumeShader: VolumeShaderModule,
  host: HTMLDivElement,
  volume: PreparedVolumeFor3D,
): ThreePreviewInstance {
  host.replaceChildren();

  const scene = new three.Scene();
  scene.background = new three.Color(0x050b13);

  const renderer = new three.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  renderer.setSize(
    Math.max(1, host.clientWidth),
    Math.max(1, host.clientHeight),
    false,
  );
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.setClearColor(0x050b13, 1);
  host.appendChild(renderer.domElement);

  const camera = new three.PerspectiveCamera(
    12,
    Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
    0.1,
    500,
  );

  const controls = new trackballControls.TrackballControls(
    camera,
    renderer.domElement,
  );
  controls.rotateSpeed = 0.95;
  controls.zoomSpeed = 1.05;
  controls.panSpeed = 0.3;
  controls.dynamicDampingFactor = 0.18;
  controls.staticMoving = false;
  controls.noPan = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 10;

  const texture = buildTexture(three, volume);
  const colormap = buildColormap(three);
  const material = buildMaterial(
    three,
    volumeShader,
    volume,
    texture,
    colormap,
  );
  const mesh = buildVolumeMesh(three, volume, material);
  scene.add(mesh);

  const axisScale = resolveAxisScale(volume.spacing);
  mesh.scale.set(axisScale[0], axisScale[1], axisScale[2]);

  const worldSize = [
    Math.max(1, volume.dimensions[0] - 1) * axisScale[0],
    Math.max(1, volume.dimensions[1] - 1) * axisScale[1],
    Math.max(1, volume.dimensions[2] - 1) * axisScale[2],
  ] as const;
  const maxWorldEdge = Math.max(...worldSize) || 1;

  const center = new three.Vector3(
    ((volume.dimensions[0] - 1) / 2) * axisScale[0],
    ((volume.dimensions[1] - 1) / 2) * axisScale[1],
    ((volume.dimensions[2] - 1) / 2) * axisScale[2],
  );
  const cursorPlanes = buildCursorPlanes(three, worldSize, center);
  scene.add(cursorPlanes.root);
  camera.near = Math.max(0.1, maxWorldEdge / 2048);

  const initialTarget = center.clone();
  const initialOffset = new three.Vector3(
    maxWorldEdge * 0.68,
    -maxWorldEdge * 2.9,
    maxWorldEdge * 4.25,
  );
  let currentTarget = initialTarget.clone();
  camera.position.copy(initialTarget.clone().add(initialOffset));
  camera.lookAt(currentTarget);
  applyDistanceLimits(camera, controls, worldSize, currentTarget);
  controls.target.copy(currentTarget);
  cursorPlanes.update(currentTarget);
  controls.update();

  let frame = 0;
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    controls.handleResize();
  });
  resizeObserver.observe(host);
  controls.handleResize();

  const render = () => {
    frame = window.requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  };
  render();

  return {
    focusCursor(cursor: VolumeCursor | null) {
      if (!cursor) {
        currentTarget = initialTarget.clone();
        cursorPlanes.update(currentTarget);
        return;
      }

      const target = cursorToWorldTarget(three, volume, axisScale, cursor);
      currentTarget = target;
      applyDistanceLimits(camera, controls, worldSize, currentTarget);
      controls.target.copy(currentTarget);
      cursorPlanes.update(currentTarget);
      camera.lookAt(currentTarget);
      controls.update();
    },
    setPlanesVisible(visible) {
      cursorPlanes.root.visible = visible;
    },
    setRenderOptions(options) {
      const uniforms = material.uniforms as VolumeShaderUniforms;
      if (options.renderStyle !== undefined) {
        uniforms.u_renderstyle.value = options.renderStyle === 'iso' ? 1 : 0;
      }
      if (options.threshold !== undefined) {
        uniforms.u_renderthreshold.value = Math.min(
          0.98,
          Math.max(0.02, options.threshold),
        );
      }
      if (options.climLow !== undefined || options.climHigh !== undefined) {
        const low = options.climLow ?? uniforms.u_clim.value.x;
        const high = options.climHigh ?? uniforms.u_clim.value.y;
        uniforms.u_clim.value.set(Math.min(low, high), Math.max(low, high));
      }
      if (options.opacity !== undefined) {
        setColormapOpacity(colormap, options.opacity);
        material.transparent = options.opacity < 1;
        material.needsUpdate = true;
      }
    },
    setView(preset: VolumeViewPreset) {
      const distance = Math.max(controls.minDistance, maxWorldEdge * 2.6);
      const epsilon = maxWorldEdge * 0.0008;
      const offsets: Record<VolumeViewPreset, [number, number, number]> = {
        front: [epsilon, -distance, epsilon],
        back: [epsilon, distance, epsilon],
        left: [-distance, epsilon, epsilon],
        right: [distance, epsilon, epsilon],
        top: [epsilon, epsilon, distance],
        bottom: [epsilon, epsilon, -distance],
      };
      const [dx, dy, dz] = offsets[preset];
      camera.position.set(
        currentTarget.x + dx,
        currentTarget.y + dy,
        currentTarget.z + dz,
      );
      applyDistanceLimits(camera, controls, worldSize, currentTarget);
      controls.target.copy(currentTarget);
      camera.lookAt(currentTarget);
      controls.update();
    },
    resetView() {
      camera.position.copy(currentTarget.clone().add(initialOffset));
      applyDistanceLimits(camera, controls, worldSize, currentTarget);
      controls.target.copy(currentTarget);
      camera.lookAt(currentTarget);
      controls.update();
    },
    snapshot() {
      try {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    },
    dispose() {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      mesh.geometry.dispose();
      material.dispose();
      cursorPlanes.dispose();
      texture.dispose();
      colormap.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}
