import * as THREE from "three";

export const SOPHON_COUNT = 5000;
export const DUST_COUNT = 100000;
export const INIT_SPACE_SIZE = 2000;      // particle initial spawn range
export const BOUNDARY_SPACE_SIZE = 3000;  // wrap-around boundary size

export interface SophonState {
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  claimed: boolean[];
  nicknames: string[];
}

export function createSophonData(): SophonState {
  const positions = new Float32Array(SOPHON_COUNT * 3);
  const velocities = new Float32Array(SOPHON_COUNT * 3);
  const colors = new Float32Array(SOPHON_COUNT * 3);
  const claimed: boolean[] = [];
  const nicknames: string[] = [];

  for (let i = 0; i < SOPHON_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * INIT_SPACE_SIZE;
    positions[i3 + 1] = (Math.random() - 0.5) * INIT_SPACE_SIZE;
    positions[i3 + 2] = (Math.random() - 0.5) * INIT_SPACE_SIZE;

    velocities[i3] = (Math.random() - 0.5) * 0.3;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.3;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.3;

    const brightness = 0.5 + Math.random() * 0.5;
    colors[i3] = 0.6 * brightness;
    colors[i3 + 1] = 0.75 * brightness;
    colors[i3 + 2] = 1.0 * brightness;

    // Demo: mark a few as claimed
    const isClaimed = i < 5;
    claimed.push(isClaimed);
    nicknames.push(isClaimed ? `旅行者${i + 1}` : "");
  }

  return { positions, velocities, colors, claimed, nicknames };
}

export function createDustPositions(): Float32Array {
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * INIT_SPACE_SIZE * 2;
    positions[i3 + 1] = (Math.random() - 0.5) * INIT_SPACE_SIZE * 2;
    positions[i3 + 2] = (Math.random() - 0.5) * INIT_SPACE_SIZE * 2;
  }
  return positions;
}

const _tmpVec = new THREE.Vector3();

export function findNearestSophons(
  positions: Float32Array,
  cameraPos: THREE.Vector3,
  count: number
): number[] {
  const dists: { idx: number; dist: number }[] = [];
  for (let i = 0; i < SOPHON_COUNT; i++) {
    const i3 = i * 3;
    _tmpVec.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    dists.push({ idx: i, dist: _tmpVec.distanceToSquared(cameraPos) });
  }
  dists.sort((a, b) => a.dist - b.dist);
  return dists.slice(0, count).map((d) => d.idx);
}
