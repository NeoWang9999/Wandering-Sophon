"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
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

export default function SophonScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sophonData = createSophonData();

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // --- Scene & Camera ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020510);
    scene.fog = new THREE.FogExp2(0x020510, 0.0008);

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
      size: 6,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
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
      size: 1.5,
      map: dustGlow,
      color: 0x4466aa,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dustPoints);

    // --- LOD: Instanced sphere meshes (visible when zoomed in) ---
    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 24, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x88aaee,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0x223355,
      emissiveIntensity: 0.4,
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
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    scene.add(ambient);
    const pointLight = new THREE.PointLight(0x6688cc, 2, 500);
    scene.add(pointLight);

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

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
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

    // --- Animation loop ---
    let animationId: number;
    let frameCount = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      frameCount++;

      const positions = sophonData.positions;
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

      camera.lookAt(0, 0, 0);
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
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
