"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three/webgpu";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - three/tsl types incomplete for r172 WebGPU TSL
import { storage, instanceIndex, Fn, float, vec3, vec4, uniform, hash, uint, mod, texture as tslTexture, uv } from "three/tsl";
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

    let disposed = false;
    let cleanupFn: (() => void) | null = null;

    const setup = async () => {
    const sophonData = createSophonData();

    // --- Renderer ---
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.0;

    // --- Scene & Camera ---
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    camera.position.set(0, 0, 500);

    // --- GPU Sophon particle system (pre-filled from CPU data) ---
    const SBA = (THREE as any).StorageInstancedBufferAttribute;
    const posAttr = new SBA(SOPHON_COUNT, 3);
    (posAttr.array as Float32Array).set(sophonData.positions);
    const velAttr = new SBA(SOPHON_COUNT, 3);
    (velAttr.array as Float32Array).set(sophonData.velocities);
    const sophonPosBuffer = storage(posAttr, "vec3", SOPHON_COUNT);
    const sophonVelBuffer = storage(velAttr, "vec3", SOPHON_COUNT);

    // Uniforms for compute
    const speedFactorU = uniform(1.0);
    const spaceSizeF = float(SPACE_SIZE);
    const mousePosU = uniform(new THREE.Vector3(0, 0, 0));
    const mouseRadiusF = float(80);

    // Update compute: apply velocity + mouse repulsion + boundary wrap
    const updateSophons = Fn(() => {
      const pos = sophonPosBuffer.element(instanceIndex);
      const vel = sophonVelBuffer.element(instanceIndex);

      // Apply velocity
      pos.addAssign(vel.mul(speedFactorU));

      // Mouse repulsion
      const toMouse = pos.sub(mousePosU);
      const dist = toMouse.length();
      const force = float(1.0).sub(dist.div(mouseRadiusF)).max(0.0).mul(0.5);
      pos.addAssign(toMouse.normalize().mul(force));

      // Boundary wrap
      const halfSpace = spaceSizeF.div(2.0);
      pos.assign(mod(pos.add(halfSpace), spaceSizeF).sub(halfSpace));
    });
    const updateCompute = updateSophons().compute(SOPHON_COUNT);

    // Sophon sprite material
    const glowTex = createGlowTexture(64, 0.15);
    const particleScale = uniform(4.0);
    const sophonMaterial = new (THREE as any).SpriteNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    sophonMaterial.positionNode = sophonPosBuffer.toAttribute();
    sophonMaterial.colorNode = Fn(() => {
      const glow = tslTexture(glowTex, uv());
      const brightness = hash(instanceIndex.add(uint(42))).mul(0.5).add(0.5);
      const col = vec3(float(0.6).mul(brightness), float(0.75).mul(brightness), brightness);
      return vec4(col.mul(glow.rgb), glow.a);
    })();
    sophonMaterial.scaleNode = particleScale;
    const sophonGeo = new THREE.PlaneGeometry(1, 1);
    const sophonMesh = new THREE.InstancedMesh(sophonGeo, sophonMaterial, SOPHON_COUNT);
    scene.add(sophonMesh);

    // --- Dust particle system (static, pre-filled) ---
    const dustPositions = createDustPositions();
    const dustPosAttr = new SBA(DUST_COUNT, 3);
    (dustPosAttr.array as Float32Array).set(dustPositions);
    const dustPosBuffer = storage(dustPosAttr, "vec3", DUST_COUNT);

    const dustGlow = createGlowTexture(32, 0.3);
    const dustMaterial = new (THREE as any).SpriteNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    dustMaterial.positionNode = dustPosBuffer.toAttribute();
    dustMaterial.colorNode = Fn(() => {
      const glow = tslTexture(dustGlow, uv());
      return vec4(vec3(0.4, 0.53, 0.8).mul(glow.rgb), glow.a.mul(0.5));
    })();
    dustMaterial.scaleNode = float(1.5);
    const dustGeo = new THREE.PlaneGeometry(1, 1);
    const dustMesh = new THREE.InstancedMesh(dustGeo, dustMaterial, DUST_COUNT);
    scene.add(dustMesh);

    // --- Load HDR environment map ---
    const pmremGenerator = new THREE.PMREMGenerator(renderer);

    let hdrReady = false;
    new RGBELoader().load("/envmap.hdr", (hdrTexture) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const envMap = (pmremGenerator as any).fromEquirectangular(hdrTexture).texture;
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
    let frameCount = 0;

    const animate = () => {
      if (!hdrReady) return;
      frameCount++;

      const camDist = camera.position.length();

      // Update GPU compute uniforms
      speedFactorU.value = THREE.MathUtils.clamp(camDist / 1500, 0.02, 1);
      mousePosU.value.copy(mouse3D);

      // GPU particle compute
      renderer.compute(updateCompute);

      // CPU shadow position update (for click detection & LOD)
      const sf = speedFactorU.value;
      const half = SPACE_SIZE / 2;
      for (let i = 0; i < SOPHON_COUNT; i++) {
        const i3 = i * 3;
        positions[i3] += sophonData.velocities[i3] * sf;
        positions[i3 + 1] += sophonData.velocities[i3 + 1] * sf;
        positions[i3 + 2] += sophonData.velocities[i3 + 2] * sf;
        for (let j = 0; j < 3; j++) {
          if (positions[i3 + j] > half) positions[i3 + j] -= SPACE_SIZE;
          if (positions[i3 + j] < -half) positions[i3 + j] += SPACE_SIZE;
        }
      }

      // Dynamic sprite scale
      particleScale.value = THREE.MathUtils.clamp(4 * (500 / camDist), 1, 20);

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

        // Expand light ring
        const ringScale = p * 60;
        ringMesh.scale.set(ringScale, ringScale, ringScale);
        ringMesh.lookAt(camera.position);
        ringMat.opacity = Math.max(0, 0.6 * (1 - p));

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

    // --- Start ---
    await renderer.init();
    if (disposed) { renderer.dispose(); return; }
    container.appendChild(renderer.domElement);
    renderer.setAnimationLoop(animate);

    cleanupFn = () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.dispose();
      sophonGeo.dispose();
      sophonMaterial.dispose();
      glowTex.dispose();
      dustGeo.dispose();
      dustMaterial.dispose();
      dustGlow.dispose();
      sphereGeo.dispose();
      sphereMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      container.removeChild(renderer.domElement);
    };
    }; // end setup

    setup();

    return () => {
      disposed = true;
      cleanupFn?.();
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
