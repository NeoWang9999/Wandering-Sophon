"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import {
  SOPHON_COUNT,
  DUST_COUNT,
  SPACE_SIZE,
  createSophonData,
  createDustPositions,
  findNearestSophons,
} from "@/lib/sophonData";

function createGlowTexture(size: number, coreRatio: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(coreRatio, "rgba(180,210,255,0.6)");
  gradient.addColorStop(0.5, "rgba(100,150,255,0.15)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const LOD_SPHERE_COUNT = 40;
const LOD_SHOW_DIST = 150;
const LOD_FULL_DIST = 60;
const SPHERE_RADIUS = 3;

export interface SophonSceneHandle {
  triggerClaim: (index: number) => void;
}

interface SophonSceneProps {
  onSophonClick?: (index: number) => void;
}

const SophonScene = forwardRef<SophonSceneHandle, SophonSceneProps>(
  function SophonScene({ onSophonClick }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSophonClickRef = useRef(onSophonClick);
  onSophonClickRef.current = onSophonClick;
  const claimQueueRef = useRef<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useImperativeHandle(ref, () => ({
    triggerClaim: (index: number) => {
      claimQueueRef.current.push(index);
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sophonData = createSophonData();

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.0;
    container.appendChild(renderer.domElement);

    // --- Scene & Camera ---
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    camera.position.set(0, 0, 500);

    // --- Sophon point particles ---
    const sophonGeometry = new THREE.BufferGeometry();
    sophonGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(sophonData.positions, 3)
    );
    sophonGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(sophonData.colors, 3)
    );

    const glowTex = createGlowTexture(64, 0.15);
    const sophonMaterial = new THREE.PointsMaterial({
      size: 7,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sophonPoints = new THREE.Points(sophonGeometry, sophonMaterial);
    scene.add(sophonPoints);

    // --- Dust particles ---
    const dustPositions = createDustPositions();
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(dustPositions, 3)
    );
    const dustGlow = createGlowTexture(32, 0.3);
    const dustMaterial = new THREE.PointsMaterial({
      size: 1.8,
      map: dustGlow,
      color: 0x6688cc,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dustPoints);

    // --- Load HDR environment map ---
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    let hdrReady = false;
    new RGBELoader().load("/envmap.hdr", (hdrTexture) => {
      const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
      scene.environment = envMap;
      scene.background = envMap;
      scene.backgroundIntensity = 0.35;
      scene.backgroundBlurriness = 0;
      sphereMat.envMap = envMap;
      sphereMat.needsUpdate = true;
      hdrTexture.dispose();
      pmremGenerator.dispose();
      hdrReady = true;
      setFadeOut(true);
      setTimeout(() => setLoading(false), 1200);
    });

    // --- LOD: Instanced sphere meshes (visible when zoomed in) ---
    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 32, 24);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0xddeeff,
      metalness: 1.0,
      roughness: 0.03,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 1.0,
      envMapIntensity: 15.0,
      emissive: 0x223344,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0,
    });
    const instancedSophons = new THREE.InstancedMesh(
      sphereGeo,
      sphereMat,
      LOD_SPHERE_COUNT
    );
    instancedSophons.visible = false;
    scene.add(instancedSophons);

    const nearestIndices: number[] = [];
    const _dummy = new THREE.Object3D();

    // --- Lighting (for sphere LOD) ---
    const ambient = new THREE.AmbientLight(0x556688, 1.0);
    scene.add(ambient);
    const pointLight = new THREE.PointLight(0xaaccff, 4, 500);
    scene.add(pointLight);

    // Strong directional lights for specular highlights on spheres
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 5);
    dirLight1.position.set(1, 1, 1);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0x8899cc, 3);
    dirLight2.position.set(-1, -0.5, -1);
    scene.add(dirLight2);
    const dirLight3 = new THREE.DirectionalLight(0xffffff, 2);
    dirLight3.position.set(0, -1, 0.5);
    scene.add(dirLight3);

    // --- Mouse tracking ---
    const mouse = new THREE.Vector2(0, 0);
    const mouse3D = new THREE.Vector3(0, 0, 0);
    const raycaster = new THREE.Raycaster();

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const dir = raycaster.ray.direction.clone();
      mouse3D.copy(camera.position).add(dir.multiplyScalar(300));
    };
    window.addEventListener("mousemove", onMouseMove);

    // --- Zoom (scroll) ---
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomSpeed = 1.05;
      if (e.deltaY > 0) {
        camera.position.multiplyScalar(zoomSpeed);
      } else {
        camera.position.multiplyScalar(1 / zoomSpeed);
      }
      camera.position.clampLength(10, 3000);
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // --- Drag to rotate ---
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    const spherical = new THREE.Spherical().setFromVector3(camera.position);

    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      const moved = Math.sqrt(dx * dx + dy * dy);

      if (moved < 5) {
        // Click (not drag): find nearest sophon to click ray
        const clickMouse = new THREE.Vector2(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1
        );
        const clickRay = new THREE.Raycaster();
        clickRay.setFromCamera(clickMouse, camera);

        let bestIdx = -1;
        let bestDist = Infinity;
        const clickThreshold = 20;
        const _pos = new THREE.Vector3();

        for (let i = 0; i < SOPHON_COUNT; i++) {
          const i3 = i * 3;
          _pos.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
          const projected = _pos.clone().project(camera);
          const screenDx = projected.x - clickMouse.x;
          const screenDy = projected.y - clickMouse.y;
          const screenDist = Math.sqrt(screenDx * screenDx + screenDy * screenDy);
          const pixelDist = screenDist * window.innerWidth / 2;

          if (projected.z > 0 && projected.z < 1 && pixelDist < clickThreshold && pixelDist < bestDist) {
            bestDist = pixelDist;
            bestIdx = i;
          }
        }

        if (bestIdx >= 0) {
          // Fly camera toward clicked sophon
          const i3 = bestIdx * 3;
          flyTarget = new THREE.Vector3(
            positions[i3],
            positions[i3 + 1],
            positions[i3 + 2]
          );
          flyProgress = 0;
          flyStartPos = camera.position.clone();

          onSophonClickRef.current?.(bestIdx);
        }
      }

      isDragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      spherical.setFromVector3(camera.position);
      spherical.theta -= dx * 0.005;
      spherical.phi -= dy * 0.005;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      camera.position.setFromSpherical(spherical);
      camera.lookAt(0, 0, 0);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);

    // --- Resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // --- Fly-to animation state ---
    let flyTarget: THREE.Vector3 | null = null;
    let flyStartPos = new THREE.Vector3();
    let flyProgress = 0;
    const positions = sophonData.positions;

    // --- Claim animation state ---
    let claimAnimIdx = -1;
    let claimAnimProgress = -1;
    let claimCenter = new THREE.Vector3();

    // Light burst ring for claim animation
    const ringGeo = new THREE.RingGeometry(0.5, 1, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.visible = false;
    scene.add(ringMesh);

    // --- Animation loop ---
    let animationId: number;
    let frameCount = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!hdrReady) return;
      frameCount++;

      const camDist = camera.position.length();
      const speedFactor = THREE.MathUtils.clamp(camDist / 1500, 0.02, 1);
      const half = SPACE_SIZE / 2;

      // Update particle positions
      for (let i = 0; i < SOPHON_COUNT; i++) {
        const i3 = i * 3;
        positions[i3] += sophonData.velocities[i3] * speedFactor;
        positions[i3 + 1] += sophonData.velocities[i3 + 1] * speedFactor;
        positions[i3 + 2] += sophonData.velocities[i3 + 2] * speedFactor;

        // Mouse repulsion
        const dx = positions[i3] - mouse3D.x;
        const dy = positions[i3 + 1] - mouse3D.y;
        const dz = positions[i3 + 2] - mouse3D.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const mouseRadius = 80;
        if (distSq < mouseRadius * mouseRadius && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / mouseRadius) * 0.5;
          positions[i3] += (dx / dist) * force;
          positions[i3 + 1] += (dy / dist) * force;
          positions[i3 + 2] += (dz / dist) * force;
        }

        // Wrap
        for (let j = 0; j < 3; j++) {
          if (positions[i3 + j] > half) positions[i3 + j] -= SPACE_SIZE;
          if (positions[i3 + j] < -half) positions[i3 + j] += SPACE_SIZE;
        }
      }

      sophonGeometry.attributes.position.needsUpdate = true;

      // Dynamic point size
      sophonMaterial.size = THREE.MathUtils.clamp(6 * (500 / camDist), 2, 30);

      // --- LOD: show sphere instances when zoomed in ---
      const showSpheres = camDist < LOD_SHOW_DIST;
      instancedSophons.visible = showSpheres;

      if (showSpheres) {
        const lodAlpha = THREE.MathUtils.clamp(
          1 - (camDist - LOD_FULL_DIST) / (LOD_SHOW_DIST - LOD_FULL_DIST),
          0,
          1
        );
        sphereMat.opacity = lodAlpha;

        // Update nearest list every 10 frames (perf)
        if (frameCount % 10 === 0) {
          const nearest = findNearestSophons(
            positions,
            camera.position,
            LOD_SPHERE_COUNT
          );
          nearestIndices.length = 0;
          nearestIndices.push(...nearest);
        }

        for (let n = 0; n < LOD_SPHERE_COUNT; n++) {
          const idx = nearestIndices[n];
          if (idx === undefined) {
            _dummy.scale.set(0, 0, 0);
          } else {
            const i3 = idx * 3;
            _dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
            _dummy.scale.set(1, 1, 1);
          }
          _dummy.updateMatrix();
          instancedSophons.setMatrixAt(n, _dummy.matrix);
        }
        instancedSophons.instanceMatrix.needsUpdate = true;

        // Move point light near camera for sphere illumination
        pointLight.position.copy(camera.position);
      }

      // --- Claim animation ---
      if (claimAnimProgress < 0 && claimQueueRef.current.length > 0) {
        claimAnimIdx = claimQueueRef.current.shift()!;
        claimAnimProgress = 0;
        const ci = claimAnimIdx * 3;
        claimCenter.set(positions[ci], positions[ci + 1], positions[ci + 2]);
        ringMesh.visible = true;
        ringMesh.position.copy(claimCenter);
      }

      if (claimAnimProgress >= 0 && claimAnimProgress <= 1) {
        claimAnimProgress += 0.012;
        const p = Math.min(claimAnimProgress, 1);

        // Brighten claimed sophon color
        const ci = claimAnimIdx * 3;
        const glow = Math.min(p * 3, 1);
        sophonData.colors[ci] = 0.6 + 0.4 * glow;
        sophonData.colors[ci + 1] = 0.75 + 0.25 * glow;
        sophonData.colors[ci + 2] = 1.0;
        sophonGeometry.attributes.color.needsUpdate = true;

        // Expand light ring
        const ringScale = p * 60;
        ringMesh.scale.set(ringScale, ringScale, ringScale);
        ringMesh.lookAt(camera.position);
        ringMat.opacity = Math.max(0, 0.6 * (1 - p));

        // Converge nearby particles toward claim center
        if (p < 0.6) {
          const convergeRadius = 80;
          for (let i = 0; i < SOPHON_COUNT; i++) {
            if (i === claimAnimIdx) continue;
            const i3 = i * 3;
            const dx = claimCenter.x - positions[i3];
            const dy = claimCenter.y - positions[i3 + 1];
            const dz = claimCenter.z - positions[i3 + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < convergeRadius && dist > 1) {
              const pull = (1 - dist / convergeRadius) * 0.3 * (1 - p / 0.6);
              positions[i3] += (dx / dist) * pull;
              positions[i3 + 1] += (dy / dist) * pull;
              positions[i3 + 2] += (dz / dist) * pull;
            }
          }
        }

        if (p >= 1) {
          claimAnimProgress = -1;
          ringMesh.visible = false;
        }
      }

      // --- Fly-to animation ---
      if (flyTarget) {
        flyProgress += 0.03;
        const currentFlyTarget = flyTarget;
        if (flyProgress >= 1) {
          flyProgress = 1;
          flyTarget = null;
        }
        const t = flyProgress * flyProgress * (3 - 2 * flyProgress); // smoothstep
        const targetCamPos = currentFlyTarget.clone().add(
          new THREE.Vector3(0, 5, 25)
        );
        camera.position.lerpVectors(flyStartPos, targetCamPos, t);
        camera.lookAt(currentFlyTarget);
      } else {
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
    };

    animate();

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.dispose();
      sophonGeometry.dispose();
      sophonMaterial.dispose();
      glowTex.dispose();
      dustGeometry.dispose();
      dustMaterial.dispose();
      dustGlow.dispose();
      sphereGeo.dispose();
      sphereMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-16 left-0 right-0 z-[60] pointer-events-none text-center">
        <div className={`text-white/30 text-sm tracking-[0.3em] mb-3 transition-opacity duration-[3s] ${fadeOut ? "opacity-0" : "opacity-100"}`}>
          流浪智子
        </div>
        <div className="text-white/20 text-xs tracking-widest">
          滚轮缩放 · 拖拽旋转 · 点击探索
        </div>
      </div>
      {loading && (
        <div
          className={`absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-1000 ${
            fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
          style={{
            background:
              "radial-gradient(ellipse at center, #000e3963 0%, #080808 40%, #030303 100%)",
          }}
        >
          <div className="loading-glow w-16 h-16 rounded-full" />
        </div>
      )}
    </div>
  );
});

export default SophonScene;
