import type { PreparedVolumeFor3D, VolumeCursor } from '../../../types';
import type { CropBounds } from '../../../domain/types';
import type {
  ThreeModule,
  ThreePreviewInstance,
  TrackballControlsModule,
  SurfaceMeshPreview,
  ObjMeshPreview,
  ThreePreviewOptions,
  VolumeColormap,
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
  applyColormap,
  buildColormap,
  buildMaterial,
  buildTexture,
  buildVolumeMesh,
} from './volume-object';

export type {
  SurfaceMeshPreview,
  ObjMeshPreview,
  ThreePreviewInstance,
  ThreePreviewOptions,
  VolumeColormap,
  VolumeRenderOptions,
  VolumeRenderStyle,
  VolumeViewPreset,
} from '../types';

export async function createThreePreview(
  host: HTMLDivElement,
  volume: PreparedVolumeFor3D,
  options: ThreePreviewOptions = {},
): Promise<ThreePreviewInstance> {
  const [three, trackballControls, volumeShader] = await Promise.all([
    import('three'),
    import('three/addons/controls/TrackballControls.js'),
    import('three/addons/shaders/VolumeShader.js'),
  ]);

  return buildPreview(
    three,
    trackballControls,
    volumeShader,
    host,
    volume,
    options,
  );
}

function buildPreview(
  three: ThreeModule,
  trackballControls: TrackballControlsModule,
  volumeShader: VolumeShaderModule,
  host: HTMLDivElement,
  volume: PreparedVolumeFor3D,
  options: ThreePreviewOptions,
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
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x050b13, 1);
  host.appendChild(renderer.domElement);
  options.onContextStatusChange?.('ok');

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    options.onContextStatusChange?.('lost');
  };
  const handleContextRestored = () => {
    options.onContextStatusChange?.('restored');
    requestRender();
    window.setTimeout(() => options.onContextStatusChange?.('ok'), 1800);
  };
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    handleContextRestored,
  );

  const camera = new three.PerspectiveCamera(
    12,
    Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
    0.1,
    500,
  );

  // Lights for surface meshes (e.g. the 3-D face): MeshStandardMaterial renders
  // black with no light source. The volume shader and the MeshBasic cursor planes
  // don't need these. A hemisphere fill plus a camera-mounted key light keep a
  // generated surface evenly lit from whatever angle it's orbited to.
  scene.add(new three.HemisphereLight(0xffffff, 0x2a3340, 2.2));
  const keyLight = new three.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(0.5, 0.8, 1);
  camera.add(keyLight);
  scene.add(camera);

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

  const applyCropBounds = (bounds: CropBounds | null | undefined) => {
    if (!bounds?.enabled) {
      material.clippingPlanes = [];
      for (const child of surfaceRoot.children) {
        const surfaceMaterial = (child as { material?: unknown }).material;
        if (surfaceMaterial && !Array.isArray(surfaceMaterial)) {
          (surfaceMaterial as { clippingPlanes?: unknown[] }).clippingPlanes = [];
        }
      }
      material.needsUpdate = true;
      return;
    }
    const min = [
      bounds.min[0] * axisScale[0],
      bounds.min[1] * axisScale[1],
      bounds.min[2] * axisScale[2],
    ];
    const max = [
      bounds.max[0] * axisScale[0],
      bounds.max[1] * axisScale[1],
      bounds.max[2] * axisScale[2],
    ];
    const planes = [
      new three.Plane(new three.Vector3(1, 0, 0), -min[0]),
      new three.Plane(new three.Vector3(-1, 0, 0), max[0]),
      new three.Plane(new three.Vector3(0, 1, 0), -min[1]),
      new three.Plane(new three.Vector3(0, -1, 0), max[1]),
      new three.Plane(new three.Vector3(0, 0, 1), -min[2]),
      new three.Plane(new three.Vector3(0, 0, -1), max[2]),
    ];
    material.clippingPlanes = planes;
    material.needsUpdate = true;
    for (const child of surfaceRoot.children) {
      const surfaceMaterial = (child as { material?: unknown }).material;
      if (surfaceMaterial && !Array.isArray(surfaceMaterial)) {
        (surfaceMaterial as { clippingPlanes?: typeof planes; needsUpdate?: boolean }).clippingPlanes = planes;
        (surfaceMaterial as { needsUpdate?: boolean }).needsUpdate = true;
      }
    }
  };

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

  const surfaceRoot = new three.Group();
  // Surfaces are emitted in mm (vertex = voxel × spacing), but the volume mesh,
  // cursor planes, and crop planes all live in the scene's world units, which are
  // voxel × axisScale (axisScale = spacing / minSpacing). Dividing mm by minSpacing
  // maps a surface into that world space: it stays origin-anchored and its extents
  // match the volume exactly, for any mask resolution. Without this a surface
  // renders minSpacing× too small (~5-7×) and floats in a corner of the volume.
  const positiveSpacing = volume.spacing.filter((value) => value > 0);
  const surfaceMinSpacing =
    positiveSpacing.length > 0 ? Math.min(...positiveSpacing) : 1;
  surfaceRoot.scale.setScalar(1 / surfaceMinSpacing);
  scene.add(surfaceRoot);
  let surfaceDisposers: Array<() => void> = [];

  const objRoot = new three.Group();
  objRoot.name = 'ImportedObjMeshes';
  scene.add(objRoot);
  let objDisposers: Array<() => void> = [];

  // Optional reference floor grid (off by default).
  const grid = new three.GridHelper(
    maxWorldEdge * 1.8,
    18,
    0x3b5b7a,
    0x24384d,
  );
  grid.position.set(center.x, 0, center.z);
  grid.visible = false;
  scene.add(grid);

  // Track colormap style + opacity so either can be changed independently.
  let colormapStyle: VolumeColormap = 'grayscale';
  let colormapOpacity = 1;

  camera.near = Math.max(0.1, maxWorldEdge / 2048);

  const initialTarget = center.clone();
  const initialDirection = new three.Vector3(0.16, -0.68, 1).normalize();
  let currentTarget = initialTarget.clone();

  const fitCameraToTarget = (
    target: import('three').Vector3,
    direction = initialDirection,
    padding = 1.08,
  ) => {
    const corners = [
      new three.Vector3(0, 0, 0),
      new three.Vector3(worldSize[0], 0, 0),
      new three.Vector3(0, worldSize[1], 0),
      new three.Vector3(0, 0, worldSize[2]),
      new three.Vector3(worldSize[0], worldSize[1], 0),
      new three.Vector3(worldSize[0], 0, worldSize[2]),
      new three.Vector3(0, worldSize[1], worldSize[2]),
      new three.Vector3(worldSize[0], worldSize[1], worldSize[2]),
    ];
    let radius = 1;
    for (const corner of corners) {
      radius = Math.max(radius, corner.distanceTo(target));
    }
    const vFov = (camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(vFov / 2)) * padding;
    camera.position.copy(target.clone().add(direction.clone().multiplyScalar(distance)));
    camera.near = Math.max(0.01, distance / 2000);
    applyDistanceLimits(camera, controls, worldSize, target);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  };

  fitCameraToTarget(currentTarget);
  cursorPlanes.update(currentTarget);

  let frame = 0;
  let interactionActive = false;
  let settleFrames = 0;
  let fpsFrames = 0;
  let fpsStartedAt = performance.now();
  const requestRender = () => {
    if (frame !== 0) return;

    frame = window.requestAnimationFrame(() => {
      frame = 0;
      controls.update();
      renderer.render(scene, camera);
      fpsFrames += 1;
      const now = performance.now();
      if (now - fpsStartedAt >= 500) {
        options.onFpsChange?.(
          interactionActive || settleFrames > 0
            ? Math.round((fpsFrames * 1000) / (now - fpsStartedAt))
            : null,
        );
        fpsFrames = 0;
        fpsStartedAt = now;
      }
      if (interactionActive || settleFrames > 0) {
        settleFrames = interactionActive ? 6 : settleFrames - 1;
        requestRender();
      }
    });
  };
  const startInteractionRender = () => {
    interactionActive = true;
    settleFrames = 6;
    requestRender();
  };
  const stopInteractionRender = () => {
    interactionActive = false;
    settleFrames = 6;
    requestRender();
  };
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', startInteractionRender);
  controls.addEventListener('end', stopInteractionRender);

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    controls.handleResize();
    requestRender();
  });
  resizeObserver.observe(host);
  controls.handleResize();
  requestRender();

  // Fit the camera to the loaded surface meshes (used to feature a generated
  // surface such as the 3-D face). Returns false if no surface is loaded yet.
  let pendingFrame = false;
  const fitToSurfaces = (): boolean => {
    const box = new three.Box3().setFromObject(surfaceRoot);
    if (box.isEmpty()) return false;
    const c = box.getCenter(new three.Vector3());
    const size = box.getSize(new three.Vector3());
    // Bounding-sphere radius, and a distance that actually fits it in this
    // camera's narrow (12°) FOV — radius / sin(fov/2). A fixed multiple would
    // frame for ~60° and leave the surface overflowing the telephoto frame.
    const radius = Math.max(size.length() * 0.5, 1);
    const vFov = (camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(vFov / 2)) * 1.1;
    currentTarget = c.clone();
    // Front-ish 3/4 angle (world: x=L/R, −y=anterior, z=sup/inf).
    const dir = new three.Vector3(0.45, -1, 0.5).normalize();
    camera.position.copy(c.clone().add(dir.multiplyScalar(distance)));
    controls.minDistance = distance * 0.15;
    controls.maxDistance = distance * 8;
    camera.near = Math.max(0.01, distance / 1000);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();
    controls.target.copy(c);
    camera.lookAt(c);
    cursorPlanes.update(currentTarget);
    controls.update();
    requestRender();
    return true;
  };

  return {
    frameSurfaces() {
      if (!fitToSurfaces()) pendingFrame = true;
    },
    focusCursor(cursor: VolumeCursor | null) {
      if (!cursor) {
        currentTarget = initialTarget.clone();
        cursorPlanes.update(currentTarget);
        requestRender();
        return;
      }

      const target = cursorToWorldTarget(three, volume, axisScale, cursor);
      currentTarget = target;
      applyDistanceLimits(camera, controls, worldSize, currentTarget);
      controls.target.copy(currentTarget);
      cursorPlanes.update(currentTarget);
      camera.lookAt(currentTarget);
      controls.update();
      requestRender();
    },
    setPlanesVisible(visible) {
      cursorPlanes.root.visible = visible;
      requestRender();
    },
    setGridVisible(visible) {
      grid.visible = visible;
      requestRender();
    },
    setSurfaceMeshes(surfaces: SurfaceMeshPreview[]) {
      for (const dispose of surfaceDisposers) dispose();
      surfaceDisposers = [];
      surfaceRoot.clear();
      requestRender();
      if (surfaces.length === 0) return;

      void import('three/addons/loaders/STLLoader.js')
        .then(({ STLLoader }) => {
          const loader = new STLLoader();
          for (const surface of surfaces) {
            if (!surface.visible) continue;
            const geometry = loader.parse(surface.stl.slice(0));
            geometry.computeVertexNormals();
            const material = new three.MeshStandardMaterial({
              color: new three.Color(surface.color),
              opacity: surface.opacity,
              transparent: surface.opacity < 1,
              roughness: 0.68,
              metalness: 0.02,
              side: three.DoubleSide,
            });
            material.clippingPlanes =
              Array.isArray((mesh.material as { clippingPlanes?: unknown }).clippingPlanes)
                ? (mesh.material as { clippingPlanes: typeof material.clippingPlanes }).clippingPlanes
                : [];
            const surfaceMesh = new three.Mesh(geometry, material);
            surfaceMesh.name = `surface-${surface.id}`;
            surfaceRoot.add(surfaceMesh);
            surfaceDisposers.push(() => {
              geometry.dispose();
              material.dispose();
            });
          }
          if (pendingFrame) {
            pendingFrame = false;
            fitToSurfaces();
          }
          requestRender();
        })
        .catch(() => {
          // Surface preview is secondary; downloads remain available.
        });
    },
    setObjMeshes(meshes: ObjMeshPreview[]) {
      for (const dispose of objDisposers) dispose();
      objDisposers = [];
      objRoot.clear();
      requestRender();
      if (meshes.length === 0) return;

      void import('three/addons/loaders/OBJLoader.js')
        .then(({ OBJLoader }) => {
          const loader = new OBJLoader();
          for (const preview of meshes) {
            if (!preview.visible) continue;
            const object = loader.parse(preview.obj);
            object.name = `obj-${preview.id}`;
            const material = new three.MeshStandardMaterial({
              color: new three.Color(preview.color),
              roughness: 0.42,
              metalness: 0.18,
              side: three.DoubleSide,
              depthTest: false,
              depthWrite: false,
            });
            object.traverse((child) => {
              const meshChild = child as {
                isMesh?: boolean;
                material?: typeof material;
                renderOrder?: number;
              };
              if (!meshChild.isMesh) return;
              meshChild.material = material;
              meshChild.renderOrder = 999;
            });
            const box = new three.Box3().setFromObject(object);
            if (!box.isEmpty()) {
              const objCenter = box.getCenter(new three.Vector3());
              const size = box.getSize(new three.Vector3());
              const longest = Math.max(size.x, size.y, size.z, 1);
              const targetSize = maxWorldEdge * 0.28;
              const scale = targetSize / longest;
              object.scale.setScalar(scale);
              object.position.copy(center.clone().sub(objCenter.multiplyScalar(scale)));
            }
            objRoot.add(object);
            objDisposers.push(() => {
              object.traverse((child) => {
                const meshChild = child as {
                  isMesh?: boolean;
                  geometry?: { dispose: () => void };
                };
                if (meshChild.isMesh) meshChild.geometry?.dispose();
              });
              material.dispose();
            });
          }
          requestRender();
        })
        .catch(() => {
          // Imported OBJ overlays are optional and should not break the volume.
        });
    },
    setCropBounds(bounds) {
      applyCropBounds(bounds);
      requestRender();
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
      if (options.colormap !== undefined || options.opacity !== undefined) {
        if (options.colormap !== undefined) colormapStyle = options.colormap;
        if (options.opacity !== undefined) colormapOpacity = options.opacity;
        applyColormap(colormap, colormapStyle, colormapOpacity);
        material.transparent = colormapOpacity < 1;
        material.needsUpdate = true;
      }
      requestRender();
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
      requestRender();
    },
    resetView() {
      fitCameraToTarget(currentTarget);
      requestRender();
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
      controls.removeEventListener('change', requestRender);
      controls.removeEventListener('start', startInteractionRender);
      controls.removeEventListener('end', stopInteractionRender);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored,
      );
      mesh.geometry.dispose();
      material.dispose();
      cursorPlanes.dispose();
      for (const dispose of surfaceDisposers) dispose();
      for (const dispose of objDisposers) dispose();
      surfaceRoot.clear();
      objRoot.clear();
      grid.geometry.dispose();
      const gridMaterial = grid.material;
      if (Array.isArray(gridMaterial)) {
        for (const entry of gridMaterial) entry.dispose();
      } else {
        gridMaterial.dispose();
      }
      texture.dispose();
      colormap.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}
