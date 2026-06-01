import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type ToothArchItem = {
  label: number;
  stl: string;
  /** FDI tooth number, shown as a floating label when present. */
  fdi?: number;
};

/** A small round billboard showing the FDI number above a tooth. */
function makeLabelSprite(text: string): THREE.Sprite {
  const px = 128;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(2, 6, 10, 0.72)';
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 58px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px / 2, px / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4, 4, 1);
  return sprite;
}

function disposeSprite(sprite: THREE.Sprite): void {
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.dispose();
}

type ToothArchViewportProps = {
  items: ToothArchItem[];
  selectedLabel: number | null;
  assetRoot: string;
  onSelect: (label: number) => void;
};

const COLORS = [
  0xe95d5d, 0x54b6e8, 0x70d878, 0xf0c64d, 0xa879f2, 0xea76bd, 0x5bc8bd,
  0xf28a4d, 0x9bd45f, 0xf2f2f2,
];

export function ToothArchViewport({
  items,
  selectedLabel,
  assetRoot,
  onSelect,
}: ToothArchViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    animationFrame: number;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.position.set(28, 26, 38);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(24, 34, 30);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x77ccff, 0.45);
    fill.position.set(-22, 8, -18);
    scene.add(fill);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const label = hit?.object.userData.label;
      if (typeof label === "number") {
        onSelect(label);
      }
    };
    renderer.domElement.addEventListener("click", handleClick);

    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      const current = sceneRef.current;
      if (current) {
        current.animationFrame = window.requestAnimationFrame(animate);
      }
    };
    const animationFrame = window.requestAnimationFrame(animate);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      group,
      raycaster,
      pointer,
      animationFrame,
    };

    return () => {
      sceneRef.current = null;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("click", handleClick);
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material.dispose();
          }
        } else if (object instanceof THREE.Sprite) {
          disposeSprite(object);
        }
      });
    };
  }, [onSelect]);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;

    current.group.children.forEach((object) => {
      if (object instanceof THREE.Sprite) disposeSprite(object);
    });
    current.group.clear();
    if (!items.length) return;

    let cancelled = false;
    const loader = new STLLoader();
    Promise.all(
      items.map(
        (item, index) =>
          new Promise<THREE.Mesh>((resolve, reject) => {
            loader.load(
              `${assetRoot}${item.stl}`,
              (geometry) => {
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                  color: COLORS[index % COLORS.length],
                  roughness: 0.5,
                  metalness: 0.02,
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.label = item.label;
                mesh.userData.fdi = item.fdi;
                mesh.rotation.x = -Math.PI / 2;
                resolve(mesh);
              },
              undefined,
              reject,
            );
          }),
      ),
    ).then((meshes) => {
      const active = sceneRef.current;
      if (!active || cancelled) {
        meshes.forEach((mesh) => {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
        return;
      }

      const box = new THREE.Box3();
      meshes.forEach((mesh) => box.expandByObject(mesh));
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const maxAxis = Math.max(size.x, size.y, size.z, 1);

      meshes.forEach((mesh) => {
        mesh.position.sub(center);
        mesh.scale.setScalar(24 / maxAxis);
        active.group.add(mesh);
        const fdi = mesh.userData.fdi;
        if (typeof fdi === 'number') {
          const toothBox = new THREE.Box3().setFromObject(mesh);
          const sprite = makeLabelSprite(String(fdi));
          sprite.position.set(
            (toothBox.min.x + toothBox.max.x) / 2,
            toothBox.max.y + 2,
            (toothBox.min.z + toothBox.max.z) / 2,
          );
          active.group.add(sprite);
        }
      });
      active.controls.target.set(0, 0, 0);
      active.camera.position.set(28, 26, 38);
    });

    return () => {
      cancelled = true;
    };
  }, [assetRoot, items]);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    current.group.children.forEach((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      material.emissive.set(object.userData.label === selectedLabel ? 0x334422 : 0x000000);
      material.emissiveIntensity = object.userData.label === selectedLabel ? 0.45 : 0;
    });
  }, [selectedLabel]);

  return (
    <div className="relative h-full w-full overflow-hidden" ref={hostRef}>
      {!items.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          No separated tooth meshes
        </div>
      ) : null}
    </div>
  );
}
