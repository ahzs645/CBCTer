import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type ToothMeshViewportProps = {
  src: string | null;
};

export function ToothMeshViewport({ src }: ToothMeshViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh | null;
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

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
    camera.position.set(18, 16, 28);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(24, 32, 28);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x77ccff, 0.55);
    fill.position.set(-18, 8, -16);
    scene.add(fill);

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
      mesh: null,
      animationFrame,
    };

    return () => {
      sceneRef.current = null;
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material.dispose();
          }
        }
      });
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current || !src) return;

    if (current.mesh) {
      current.scene.remove(current.mesh);
      current.mesh.geometry.dispose();
      const material = current.mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
      current.mesh = null;
    }

    const loader = new STLLoader();
    let cancelled = false;
    loader.load(src, (geometry) => {
      if (cancelled || !sceneRef.current) {
        geometry.dispose();
        return;
      }

      geometry.computeVertexNormals();
      geometry.center();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new THREE.Box3();
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxAxis = Math.max(size.x, size.y, size.z, 1);
      geometry.scale(18 / maxAxis, 18 / maxAxis, 18 / maxAxis);

      const material = new THREE.MeshStandardMaterial({
        color: 0xf5f1e7,
        roughness: 0.48,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      sceneRef.current.scene.add(mesh);
      sceneRef.current.mesh = mesh;
      sceneRef.current.controls.target.set(0, 0, 0);
      sceneRef.current.camera.position.set(18, 16, 28);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden" ref={hostRef}>
      {!src ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-xs text-slate-500">
          Select a separated tooth label
        </div>
      ) : null}
    </div>
  );
}
