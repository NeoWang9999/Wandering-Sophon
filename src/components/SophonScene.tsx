"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three/webgpu";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - three/tsl types incomplete for r172 WebGPU TSL
import { storage, instanceIndex, Fn, float, vec3, vec4, uniform, uniformArray, hash, uint, mod, texture as tslTexture, uv, Loop, mix, smoothstep } from "three/tsl";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import {
  SOPHON_COUNT,
  DUST_COUNT,
  BOUNDARY_SPACE_SIZE,
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

    // --- Permanent ambient attractors (create fluid flow) ---
    const AMBIENT_COUNT = 3;
    const ambientPositions = uniformArray([
      new THREE.Vector3(-200, 80, -150),
      new THREE.Vector3(180, -60, 200),
      new THREE.Vector3(50, 150, -100),
    ]);
    const ambientAxes = uniformArray([
      new THREE.Vector3(0.3, 0.9, 0.1).normalize(),
      new THREE.Vector3(-0.5, 0.7, 0.4).normalize(),
      new THREE.Vector3(0.2, -0.8, 0.6).normalize(),
    ]);

    // Uniforms for compute
    const speedFactorU = uniform(1.0);
    const particleScaleU = uniform(1.0);  // camera-distance based particle scale
    const spaceSizeF = float(BOUNDARY_SPACE_SIZE);
    const mousePosU = uniform(new THREE.Vector3(0, 0, 0));
    const mouseRadiusF = float(80);

    // Shared physics params (direct force, no gravity constant)
    const ambientMassU = uniform(8e3);
    const spinStrengthU = uniform(2.5);
    const velocityDampingU = uniform(0.08);
    const maxSpeedU = uniform(35.0);
    const cameraPosU = uniform(new THREE.Vector3(0, 0, 500));
    const freezeRadiusSqU = float(200 * 200); // squared distance for freeze zone

    // Shift+click temporary attractor
    const attractorPosU = uniform(new THREE.Vector3(0, 0, 0));
    const attractorActiveU = uniform(0.0); // 0 = off, 1 = on
    const attractorModeU = uniform(0.0);   // 0 = shell, 1 = Thomas

    // Mode 0: Shell orbit params
    const shellRadius = float(5.0);
    const shellSpring = float(0.3);
    const orbitForce = float(20.0);
    const orbitDampingReduce = float(0.75);

    // Mode 1: Thomas attractor params
    const thomasB = float(0.208186);       // Thomas damping coefficient
    const thomasScale = float(30.0);       // maps attractor [-3,3] to ~180 world units
    const thomasSpeed = float(8.0);        // flow speed multiplier

    // Update compute
    const updateSophons = Fn(() => {
      const delta = float(1.0 / 60.0);
      const pos = sophonPosBuffer.element(instanceIndex);
      const vel = sophonVelBuffer.element(instanceIndex);

      const force = vec3(0.0).toVar();

      // Ambient attractors (disabled when click attractor active)
      const ambientScale = float(1.0).sub(attractorActiveU);
      Loop(AMBIENT_COUNT, ({ i }: { i: any }) => {
        const aPos = ambientPositions.element(i);
        const aAxis = ambientAxes.element(i);
        const toA = aPos.sub(pos);
        const aDist = toA.length().max(5.0);
        const aDir = toA.normalize();
        const gStr = ambientMassU.div(aDist.mul(aDist)).mul(ambientScale);
        force.addAssign(aDir.mul(gStr));
        force.addAssign(aAxis.mul(gStr).mul(spinStrengthU).cross(toA));
      });

      // --- Mode 0: Shell orbit ---
      const isShell = attractorActiveU.mul(float(1.0).sub(attractorModeU));
      const toClick = attractorPosU.sub(pos);
      const cDist = toClick.length().max(0.1);
      const cDir = toClick.normalize();
      // Soft spring toward shell (particles can drift through)
      const springStr = cDist.sub(shellRadius).mul(shellSpring).mul(isShell);
      force.addAssign(cDir.mul(springStr));
      // Per-particle random tangent for orbital motion on sphere
      const rndA = hash(instanceIndex.add(uint(123))).mul(6.28);
      const rndB = hash(instanceIndex.add(uint(456))).mul(6.28);
      const rndAxis = vec3(rndA.sin(), rndB.cos(), rndA.cos().mul(rndB.sin())).normalize();
      const tangent = rndAxis.cross(cDir).normalize();
      force.addAssign(tangent.mul(isShell).mul(orbitForce));

      // Apply force → velocity
      vel.addAssign(force.mul(delta));
      const speed = vel.length();
      vel.assign(vel.normalize().mul(speed.min(maxSpeedU)));
      // Lower damping when orbiting so orbital velocity sustains
      const effectiveDamping = velocityDampingU.mul(float(1.0).sub(isShell.mul(orbitDampingReduce)));
      vel.mulAssign(float(1.0).sub(effectiveDamping));

      // --- Mode 1: Thomas attractor (override velocity from ODE field) ---
      const isThomas = attractorActiveU.mul(attractorModeU);
      const lp = pos.sub(attractorPosU).div(thomasScale); // local position in attractor space
      const tv = vec3(
        lp.y.sin().sub(thomasB.mul(lp.x)),
        lp.z.sin().sub(thomasB.mul(lp.y)),
        lp.x.sin().sub(thomasB.mul(lp.z))
      ).mul(thomasSpeed);
      vel.assign(mix(vel, tv, isThomas));

      // Per-particle freeze near camera (GPU-side, zero CPU cost)
      const toCam = cameraPosU.sub(pos);
      const camDistSq = toCam.dot(toCam);
      const localSpeed = smoothstep(freezeRadiusSqU.mul(0.05), freezeRadiusSqU, camDistSq);
      // Apply velocity → position
      pos.addAssign(vel.mul(speedFactorU).mul(localSpeed));

      // Mouse repulsion
      const toMouse = pos.sub(mousePosU);
      const dist = toMouse.length();
      const mForce = float(1.0).sub(dist.div(mouseRadiusF)).max(0.0).mul(0.5);
      pos.addAssign(toMouse.normalize().mul(mForce));

      // Boundary wrap
      const halfSpace = spaceSizeF.div(2.0);
      pos.assign(mod(pos.add(halfSpace), spaceSizeF).sub(halfSpace));
    });
    const updateCompute = updateSophons().compute(SOPHON_COUNT);

    // Sophon sprite material
    const glowTex = createGlowTexture(64, 0.15);
    const particleScale = uniform(1.0);
    const sophonMaterial = new (THREE as any).SpriteNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    sophonMaterial.positionNode = sophonPosBuffer.toAttribute();
    sophonMaterial.colorNode = Fn(() => {
      const glow = tslTexture(glowTex, uv());
      const brightness = hash(instanceIndex.add(uint(42))).mul(0.3).add(0.7);
      return vec4(vec3(brightness).mul(glow.rgb), glow.a);
    })();
    sophonMaterial.scaleNode = particleScale.mul(particleScaleU);
    const sophonGeo = new THREE.PlaneGeometry(2, 2);
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
      mouse3D.copy(camera.position).add(dir.multiplyScalar(1000));
    };
    window.addEventListener("mousemove", onMouseMove);

    // --- Zoom (scroll with inertia) ---
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomVelocity += Math.sign(e.deltaY) * 0.04;
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // --- Drag to rotate ---
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    const spherical = new THREE.Spherical().setFromVector3(camera.position);

    let pointerDownPos = { x: 0, y: 0 };
    let shiftAttractorActive = false;

    const onPointerDown = (e: PointerEvent) => {
      // Shift + left click = attractor mode
      if (e.shiftKey && e.button === 0) {
        shiftAttractorActive = true;
        attractorPosU.value.copy(mouse3D);
        attractorActiveU.value = 1.0;
        return; // don't start drag
      }
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (shiftAttractorActive) {
        shiftAttractorActive = false;
        attractorActiveU.value = 0.0;
        isDragging = false;
        return;
      }
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
          flyTargetIdx = bestIdx;
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

    // --- Debug: attractor visualizers ---
    const ATTRACTOR_COLORS = [0xff4444, 0x44ff44, 0x4488ff];
    const attractorPosData = [
      new THREE.Vector3(-200, 80, -150),
      new THREE.Vector3(180, -60, 200),
      new THREE.Vector3(50, 150, -100),
    ];
    const attractorAxisData = [
      new THREE.Vector3(0.3, 0.9, 0.1).normalize(),
      new THREE.Vector3(-0.5, 0.7, 0.4).normalize(),
      new THREE.Vector3(0.2, -0.8, 0.6).normalize(),
    ];
    // Debug group: not added to scene until toggled on (WebGPU compat)
    const debugGroup = new THREE.Group();
    let debugInScene = false;

    // Trail data (recorded even when hidden, drawn when visible)
    const TRAIL_LENGTH = 600;
    const FUTURE_POINTS = 1200;
    const trailPositions: Float32Array[] = [];
    const trailHeads: number[] = [0, 0, 0];
    const trailFilled: boolean[] = [false, false, false];
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      trailPositions.push(new Float32Array(TRAIL_LENGTH * 3));
    }

    let debugVisible = false;

    // Attractor auto-drift: each attractor orbits its origin via Lissajous curves
    const driftRadius = 150;   // max drift distance from origin
    const driftSpeed = 0.15;   // base angular speed (radians/sec)
    // Per-attractor frequency ratios for organic, non-repeating paths
    const driftFreqs = [
      { fx: 1.0, fy: 0.7, fz: 0.4 },
      { fx: 0.6, fy: 1.0, fz: 0.8 },
      { fx: 0.8, fy: 0.5, fz: 1.0 },
    ];
    // Phase offsets so they don't start in sync
    const driftPhase = [0, 2.1, 4.2];

    const buildDebugObjects = (currentTime: number) => {
      // Clear previous
      while (debugGroup.children.length) debugGroup.remove(debugGroup.children[0]);

      for (let i = 0; i < AMBIENT_COUNT; i++) {
        const color = ATTRACTOR_COLORS[i];
        const origin = attractorPosData[i];
        const f = driftFreqs[i];

        // Current position marker (sphere)
        const sGeo = new THREE.SphereGeometry(8, 12, 8);
        const sMat = new THREE.MeshBasicMaterial({ color, wireframe: true });
        const sphere = new THREE.Mesh(sGeo, sMat);
        const curPos = (ambientPositions.array as THREE.Vector3[])[i];
        sphere.position.copy(curPos);
        debugGroup.add(sphere);

        // Past trail
        const pastCount = trailFilled[i] ? TRAIL_LENGTH : trailHeads[i];
        if (pastCount > 1) {
          const pastGeo = new THREE.BufferGeometry();
          pastGeo.setAttribute("position", new THREE.BufferAttribute(trailPositions[i].slice(0, pastCount * 3), 3));
          const pastMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false });
          debugGroup.add(new THREE.Line(pastGeo, pastMat));
        }

        // Future trajectory
        const futArr = new Float32Array(FUTURE_POINTS * 3);
        for (let p = 0; p < FUTURE_POINTS; p++) {
          const ft = (currentTime + p / 60) * driftSpeed + driftPhase[i];
          futArr[p * 3]     = origin.x + Math.sin(ft * f.fx) * driftRadius;
          futArr[p * 3 + 1] = origin.y + Math.sin(ft * f.fy + 1.3) * driftRadius;
          futArr[p * 3 + 2] = origin.z + Math.sin(ft * f.fz + 2.7) * driftRadius;
        }
        const futGeo = new THREE.BufferGeometry();
        futGeo.setAttribute("position", new THREE.BufferAttribute(futArr, 3));
        const futMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false });
        debugGroup.add(new THREE.Line(futGeo, futMat));
      }
    };

    const updateAttractorDrift = (time: number) => {
      for (let i = 0; i < AMBIENT_COUNT; i++) {
        const origin = attractorPosData[i];
        const f = driftFreqs[i];
        const t = time * driftSpeed + driftPhase[i];
        const dx = Math.sin(t * f.fx) * driftRadius;
        const dy = Math.sin(t * f.fy + 1.3) * driftRadius;
        const dz = Math.sin(t * f.fz + 2.7) * driftRadius;
        const pos = (ambientPositions.array as THREE.Vector3[])[i];
        pos.set(origin.x + dx, origin.y + dy, origin.z + dz);
        // Slowly rotate axis too
        const ax = attractorAxisData[i];
        const rt = t * 0.3;
        const rxd = Math.sin(rt * f.fy) * 0.3;
        const ryd = Math.cos(rt * f.fz) * 0.3;
        const rzd = Math.sin(rt * f.fx + 1.0) * 0.3;
        (ambientAxes.array as THREE.Vector3[])[i].set(
          ax.x + rxd, ax.y + ryd, ax.z + rzd
        ).normalize();
        // Record trail point
        const head = trailHeads[i];
        const arr = trailPositions[i];
        arr[head * 3] = pos.x;
        arr[head * 3 + 1] = pos.y;
        arr[head * 3 + 2] = pos.z;
        trailHeads[i] = (head + 1) % TRAIL_LENGTH;
        if (!trailFilled[i] && trailHeads[i] === 0) trailFilled[i] = true;
      }
      // Rebuild debug visuals periodically when visible
      if (debugVisible && frameCount % 30 === 0) {
        buildDebugObjects(time);
      }
    };

    // --- Tab to switch attractor mode ---
    const MODE_NAMES = ["Shell Orbit", "Thomas Attractor"];
    let currentMode = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        currentMode = (currentMode + 1) % MODE_NAMES.length;
        attractorModeU.value = currentMode;
        console.log(`Attractor mode: ${MODE_NAMES[currentMode]}`);
        return;
      }
      if (e.key === "`") {
        debugVisible = !debugVisible;
        if (debugVisible) {
          buildDebugObjects(frameCount / 60);
          if (!debugInScene) { scene.add(debugGroup); debugInScene = true; }
        } else {
          if (debugInScene) { scene.remove(debugGroup); debugInScene = false; }
        }
        console.log(debugVisible ? "Attractor debug ON" : "Attractor debug OFF");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // --- Resize ---
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // --- Fly-to animation state ---
    let flyTarget: THREE.Vector3 | null = null;
    let flyTargetIdx = -1; // tracked particle index
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
    let gpuReadPending = false;
    let gpuSynced = false; // true after first successful readback
    let zoomVelocity = 0; // for smooth zoom deceleration

    const animate = () => {
      if (!hdrReady) return;
      frameCount++;

      // Apply zoom velocity with damping (smooth deceleration)
      if (Math.abs(zoomVelocity) > 0.0005) {
        camera.position.multiplyScalar(1 + zoomVelocity);
        camera.position.clampLength(10, 2000);
        zoomVelocity *= 0.88; // damping factor
      } else {
        zoomVelocity = 0;
      }

      const camDist = camera.position.length();

      // Drift ambient attractors along Lissajous paths
      updateAttractorDrift(frameCount / 60);

      // Update GPU compute uniforms
      speedFactorU.value = THREE.MathUtils.clamp(camDist / 1500, 0.01, 1);
      cameraPosU.value.copy(camera.position);
      // Scale particles with camera distance: bigger when far away
      particleScaleU.value = Math.max(1.0, camDist / 500);
      mousePosU.value.copy(mouse3D);
      if (shiftAttractorActive) attractorPosU.value.copy(mouse3D);

      // GPU particle compute
      renderer.compute(updateCompute);

      // GPU→CPU position readback (always, for accurate LOD + click detection)
      // Every frame when close, every 15 frames when far
      const readInterval = camDist < LOD_SHOW_DIST * 2 ? 1 : 15;
      if (!gpuReadPending && frameCount % readInterval === 0) {
        gpuReadPending = true;
        renderer.getArrayBufferAsync(posAttr).then((buf: ArrayBuffer) => {
          const gpu = new Float32Array(buf);
          // GPU buffer may have vec4 padding (4 floats per vertex instead of 3)
          const stride = gpu.length / SOPHON_COUNT;
          if (stride === 3) {
            positions.set(gpu);
          } else {
            // Extract xyz from padded vec4 data
            for (let i = 0; i < SOPHON_COUNT; i++) {
              positions[i * 3]     = gpu[i * stride];
              positions[i * 3 + 1] = gpu[i * stride + 1];
              positions[i * 3 + 2] = gpu[i * stride + 2];
            }
          }
          gpuReadPending = false;
          gpuSynced = true;
        }).catch((err: unknown) => { gpuReadPending = false; console.warn("GPU readback failed:", err); });
      }

      // Dynamic sprite scale
      particleScale.value = THREE.MathUtils.clamp(4 * (500 / camDist), 1, 20);

      // --- LOD: show sphere instances when zoomed in (only after GPU sync) ---
      const showSpheres = camDist < LOD_SHOW_DIST && gpuSynced;
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
      if (flyTarget && flyTargetIdx >= 0) {
        // Slow down all particles during flight so target doesn't drift away
        speedFactorU.value *= 0.3;

        // Track real particle position each frame
        const ti3 = flyTargetIdx * 3;
        flyTarget.set(positions[ti3], positions[ti3 + 1], positions[ti3 + 2]);

        flyProgress += 0.02;
        const currentFlyTarget = flyTarget;
        if (flyProgress >= 1) {
          flyProgress = 1;
          flyTarget = null;
          flyTargetIdx = -1;
        }
        const t = flyProgress * flyProgress * (3 - 2 * flyProgress); // smoothstep
        const targetCamPos = currentFlyTarget.clone().add(
          camera.position.clone().sub(currentFlyTarget).normalize().multiplyScalar(20)
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
      window.removeEventListener("keydown", onKeyDown);
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
