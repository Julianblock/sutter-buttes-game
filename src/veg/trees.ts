import * as THREE from 'three';
import { G } from '../render/globals';
import type { ShadowMap } from '../render/shadows';
import type { Heightfield } from '../world/heightfield';
import type { RoadIndex } from '../world/roadIndex';
import { LC } from '../world/meta';
import { buildTree } from './treeGeometry';
import { SPECIES_COUNT, treeFragment, treeVertex } from './treeShader';

export const TREE = { BLUE_OAK: 0, LIVE_OAK: 1, VALLEY_OAK: 2, COTTONWOOD: 3, SHRUB: 4, ALMOND: 5, WALNUT: 6, PRUNE: 7 } as const;

export interface PlantedTree {
  x: number;
  z: number;
  r: number;
  h: number;
  sp: number;
}

const TILE = 250;
const LOD0 = 170;
const LOD1 = 1900;
const LOD2 = 6500;
const CAP = [14000, 70000, 90000];

// Month keyframes (Jan..Dec) for leaf amount per species.
const LEAF_KF: number[][] = [
  [0.05, 0.05, 0.35, 0.9, 1, 1, 1, 1, 1, 0.92, 0.6, 0.15], // blue oak
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // live oak
  [0.02, 0.02, 0.4, 0.95, 1, 1, 1, 1, 1, 0.9, 0.5, 0.08], // valley oak
  [0.0, 0.0, 0.5, 1, 1, 1, 1, 1, 1, 0.9, 0.45, 0.02], // cottonwood
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // shrubs
  [0.04, 0.9, 0.95, 1, 1, 1, 1, 1, 1, 0.9, 0.55, 0.1], // almond (Feb = blossom)
  [0.0, 0.0, 0.05, 0.6, 1, 1, 1, 1, 1, 0.85, 0.4, 0.03], // walnut
  [0.03, 0.08, 0.9, 1, 1, 1, 1, 1, 1, 0.85, 0.45, 0.06], // prune / peach (Mar = blossom)
];

// Leaf colour keyframes: [winter, spring, summer, fall] (sRGB hex).
const LEAF_COL: string[][] = [
  ['#6a665a', '#6f8a46', '#5b6552', '#7e7046'],
  ['#2f3a26', '#3f522c', '#323e27', '#323d26'],
  ['#66625a', '#728f45', '#4f5f34', '#8a7740'],
  ['#706a5e', '#8aa84b', '#5f7a38', '#c99c34'],
  ['#3e4630', '#4a5f33', '#41492f', '#55502f'],
  ['#5e5850', '#6d8a42', '#55683a', '#8a7a3e'],
  ['#5e5850', '#7a9a48', '#58703a', '#b39a3c'],
  ['#5e5850', '#6a8640', '#4f6236', '#94703a'],
];
const BARK = ['#8a857a', '#4c4640', '#5c554c', '#8a8274', '#4a4436', '#4a4038', '#8c877c', '#3e3530'];

/** Orchard rows on the survey grid: spacing (m), crown radius, height. */
const ORCHARD: Record<number, { sp: number; spacing: number; row: number; r: number; h: number }> = {
  [LC.ALMOND]: { sp: TREE.ALMOND, spacing: 6.4, row: 7.0, r: 2.8, h: 5.4 },
  [LC.WALNUT]: { sp: TREE.WALNUT, spacing: 9.0, row: 9.0, r: 4.2, h: 9.5 },
  [LC.FRUIT]: { sp: TREE.PRUNE, spacing: 5.6, row: 6.2, r: 2.5, h: 4.4 },
};

/** Blossom colour and the month (0 = Jan 1) it peaks, per orchard species. */
const BLOOM: Record<number, { col: string; peak: number }> = {
  [TREE.ALMOND]: { col: '#e4d8d8', peak: 1.65 },
  [TREE.PRUNE]: { col: '#e8d2d8', peak: 2.4 },
};

function kf(keys: number[], m: number) {
  const i0 = ((Math.floor(m) % 12) + 12) % 12;
  const i1 = (i0 + 1) % 12;
  const t = m - Math.floor(m);
  return keys[i0] + (keys[i1] - keys[i0]) * t;
}

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Tile {
  data: Float32Array; // 8 floats per tree: x y z rot r h species seed
  count: number;
  cx: number;
  cz: number;
  minY: number;
  maxY: number;
}

/** Real oak woodland: every tree crown detected in the aerial imagery. */
export class Trees {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private tiles: Tile[] = [];
  private geos: THREE.InstancedBufferGeometry[] = [];
  private inst0: THREE.InstancedBufferAttribute[] = [];
  private inst1: THREE.InstancedBufferAttribute[] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastQuat = new THREE.Quaternion();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private box = new THREE.Box3();
  counts = [0, 0, 0];
  total = 0;
  private tileMap = new Map<number, Tile>();
  private zone = 0;

  /** Hand-placed trees on top of those detected in the imagery (cemetery oaks). */
  constructor(
    buf: ArrayBuffer,
    zone: number,
    hf: Heightfield,
    private roads?: RoadIndex,
    private planted: PlantedTree[] = [],
    private water?: { depthAt(x: number, z: number): number },
  ) {
    const leafCol = Array.from({ length: SPECIES_COUNT }, () => new THREE.Color());
    const bark = BARK.map((h) => new THREE.Color(h));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: treeVertex,
      fragmentShader: treeFragment,
      uniforms: {
        ...G,
        uLeafColor: { value: leafCol },
        uBarkColor: { value: bark },
        uLeafAmount: { value: new Array(SPECIES_COUNT).fill(1) },
        uFallTint: { value: new THREE.Color('#a0783a') },
      },
      side: THREE.DoubleSide,
    });

    for (let lod = 0; lod < 3; lod++) {
      const base = buildTree(lod as 0 | 1 | 2, 7 + lod);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
      const a0 = new THREE.InstancedBufferAttribute(new Float32Array(CAP[lod] * 4), 4);
      const a1 = new THREE.InstancedBufferAttribute(new Float32Array(CAP[lod] * 4), 4);
      a0.setUsage(THREE.DynamicDrawUsage);
      a1.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aInst0', a0);
      g.setAttribute('aInst1', a1);
      g.instanceCount = 0;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.geos.push(g);
      this.inst0.push(a0);
      this.inst1.push(a1);
    }
    this.decode(buf, zone, hf);
  }

  /**
   * Deepest trunk overlapping a circle at (x, z), as a push-out direction and
   * depth. Shrubs are ignored (the truck rolls over them).
   */
  trunkHit(x: number, z: number, radius: number): { nx: number; nz: number; depth: number } | null {
    const zone = this.zone;
    const tilesN = Math.ceil(zone / TILE);
    const reach = radius + 1;
    const i0 = Math.floor((x - reach + zone / 2) / TILE), i1 = Math.floor((x + reach + zone / 2) / TILE);
    const j0 = Math.floor((z - reach + zone / 2) / TILE), j1 = Math.floor((z + reach + zone / 2) / TILE);
    let best: { nx: number; nz: number; depth: number } | null = null;
    for (let tj = j0; tj <= j1; tj++)
      for (let ti = i0; ti <= i1; ti++) {
        if (ti < 0 || tj < 0 || ti >= tilesN || tj >= tilesN) continue;
        const t = this.tileMap.get(tj * tilesN + ti);
        if (!t) continue;
        const d = t.data;
        for (let k = 0; k < t.count; k++) {
          const o = k * 8;
          const dx = x - d[o], dz = z - d[o + 2];
          if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
          const sp = d[o + 6];
          if (sp === TREE.SHRUB) continue;
          const trunk = sp >= TREE.ALMOND ? 0.2 : Math.min(0.7, Math.max(0.25, d[o + 4] * 0.08));
          const dist = Math.hypot(dx, dz);
          const depth = radius + trunk - dist;
          if (depth > 0 && (!best || depth > best.depth)) {
            const l = dist || 1;
            best = { nx: dx / l, nz: dz / l, depth };
          }
        }
      }
    return best;
  }

  /** Registers the near tree LODs as shadow casters. */
  addShadowCasters(shadow: ShadowMap) {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: treeVertex,
      fragmentShader: treeFragment,
      uniforms: this.material.uniforms,
      defines: { SHADOW_PASS: '' },
      side: THREE.DoubleSide,
    });
    shadow.addCaster(this.geos[0], mat);
    shadow.addCaster(this.geos[1], mat);
  }

  private decode(buf: ArrayBuffer, zone: number, hf: Heightfield) {
    // Tiles cover the imagery zone, widened to take any hand-planted trees outside it.
    let grid = zone;
    for (const t of this.planted) grid = Math.max(grid, 2 * Math.max(Math.abs(t.x), Math.abs(t.z)) + 2 * TILE);
    grid = Math.ceil(grid / (2 * TILE)) * 2 * TILE;
    this.zone = grid;
    const v = new DataView(buf);
    const n = buf.byteLength / 6;
    const tilesN = Math.ceil(grid / TILE);
    const lists: number[][] = Array.from({ length: tilesN * tilesN }, () => []);
    for (let k = 0; k < n; k++) {
      const x = (v.getUint16(k * 6, true) / 65535 - 0.5) * zone;
      const z = (v.getUint16(k * 6 + 2, true) / 65535 - 0.5) * zone;
      const rImg = v.getUint8(k * 6 + 4) / 20;
      const dark = v.getUint8(k * 6 + 5) / 255;
      const y = hf.height(x, z);
      const seed = hash(k * 0.61803 + x * 0.001);
      let sp: number;
      // Imagery blobs include the crown's shadow; trim to the crown itself.
      let r = rImg * 0.82;
      let h: number;
      const lc = hf.landcover(x, z);
      if (ORCHARD[lc]) continue;
      if (this.water && this.water.depthAt(x, z) > 0.15) continue;
      if (rImg < 2.7) {
        sp = TREE.SHRUB;
        r = 1.0 + rImg * 0.35 + seed * 0.4;
        h = 1.2 + seed * 1.6;
      } else if (y > 42) {
        sp = dark > 0.52 && seed < 0.75 ? TREE.LIVE_OAK : y < 80 && seed > 0.88 ? TREE.VALLEY_OAK : TREE.BLUE_OAK;
        r = Math.max(r, 2.6) * (1.05 + seed * 0.3);
        // Oaks on the Buttes are broad, low-domed trees, about as wide as tall.
        h = sp === TREE.LIVE_OAK ? r * 1.15 + 2.2 : sp === TREE.VALLEY_OAK ? r * 1.6 + 3 : r * 1.3 + 2.4;
      } else {
        const wet = lc === LC.WETLAND || lc === LC.WATER;
        sp = wet && seed < 0.5 ? TREE.COTTONWOOD : TREE.VALLEY_OAK;
        r = Math.max(r, 3) * (1.05 + seed * 0.3);
        h = sp === TREE.COTTONWOOD ? r * 2.4 + 4 : r * 1.6 + 3.5;
      }
      // Crown blobs over a road put the trunk on the asphalt; step it onto the shoulder.
      let tx = x, tz = z;
      const road = this.roads?.nearest(x, z, 16);
      if (road) {
        const clear = road.halfWidth + 1.3 + (sp === TREE.SHRUB ? 0.3 : Math.min(r * 0.15, 0.8));
        if (road.dist < clear) {
          let nx = x - road.x, nz = z - road.z;
          const l = Math.hypot(nx, nz);
          if (l > 0.01) (nx /= l), (nz /= l);
          else (nx = -road.dz), (nz = road.dx);
          tx = road.x + nx * clear;
          tz = road.z + nz * clear;
        }
      }
      const ti = Math.floor((tx + grid / 2) / TILE);
      const tj = Math.floor((tz + grid / 2) / TILE);
      if (ti < 0 || tj < 0 || ti >= tilesN || tj >= tilesN) continue;
      lists[tj * tilesN + ti].push(tx, hf.height(tx, tz) - 0.35, tz, seed * 6.2831, r, h, sp, hash(seed * 17.3));
    }
    this.planted.forEach((t, k) => {
      const ti = Math.floor((t.x + grid / 2) / TILE);
      const tj = Math.floor((t.z + grid / 2) / TILE);
      if (ti < 0 || tj < 0 || ti >= tilesN || tj >= tilesN) return;
      const seed = hash(k * 3.17 + 0.5);
      lists[tj * tilesN + ti].push(t.x, hf.height(t.x, t.z) - 0.35, t.z, seed * 6.2831, t.r, t.h, t.sp, hash(seed * 17.3));
    });
    this.plantOrchards(zone, hf, (...vals) => {
      const ti = Math.floor((vals[0] + grid / 2) / TILE);
      const tj = Math.floor((vals[2] + grid / 2) / TILE);
      if (ti < 0 || tj < 0 || ti >= tilesN || tj >= tilesN) return;
      const road = this.roads?.nearest(vals[0], vals[2], 12);
      if (road && road.dist < road.halfWidth + 1.8) return;
      if (this.water && this.water.depthAt(vals[0], vals[2]) > 0.05) return;
      lists[tj * tilesN + ti].push(...vals);
    });
    for (let tj = 0; tj < tilesN; tj++) {
      for (let ti = 0; ti < tilesN; ti++) {
        const l = lists[tj * tilesN + ti];
        if (!l.length) continue;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < l.length; i += 8) {
          minY = Math.min(minY, l[i + 1]);
          maxY = Math.max(maxY, l[i + 1] + l[i + 5]);
        }
        const tile: Tile = {
          data: new Float32Array(l),
          count: l.length / 8,
          cx: -grid / 2 + (ti + 0.5) * TILE,
          cz: -grid / 2 + (tj + 0.5) * TILE,
          minY,
          maxY,
        };
        this.tiles.push(tile);
        this.tileMap.set(tj * tilesN + ti, tile);
        this.total += l.length / 8;
      }
    }
  }

  /** Rows of almond, walnut and prune trees filling every orchard land-cover cell. */
  private plantOrchards(zone: number, hf: Heightfield, add: (...v: number[]) => void) {
    const half = zone / 2;
    let k = 0;
    for (const key of Object.keys(ORCHARD)) {
      const o = ORCHARD[Number(key)];
      for (let z = -half + o.row / 2; z < half; z += o.row) {
        for (let x = -half + o.spacing / 2; x < half; x += o.spacing) {
          if (hf.landcover(x, z) !== Number(key)) continue;
          const seed = hash(x * 0.137 + z * 0.731);
          if (seed < 0.03) continue; // missing / replanted trees
          const y = hf.height(x, z);
          const r = o.r * (0.85 + seed * 0.3);
          const h = o.h * (0.9 + hash(seed * 7.7) * 0.2);
          add(x + (seed - 0.5) * 0.4, y - 0.3, z, seed * 6.2831, r, h, o.sp, hash(seed * 17.3));
          k++;
        }
      }
    }
    this.orchardCount = k;
  }

  orchardCount = 0;

  /** Seasonal foliage: leaf-out, colour and autumn tint for the given month (0 = Jan 1). */
  setSeason(month: number) {
    const u = this.material.uniforms;
    const amount = u.uLeafAmount.value as number[];
    const cols = u.uLeafColor.value as THREE.Color[];
    // Weights for winter / spring / summer / fall colour keys.
    const w = [
      kf([1, 0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.8], month),
      kf([0, 0.2, 0.8, 1, 0.7, 0.2, 0, 0, 0, 0, 0, 0], month),
      kf([0, 0, 0, 0, 0.3, 0.8, 1, 1, 0.7, 0.2, 0, 0], month),
      kf([0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.8, 0.8, 0.2], month),
    ];
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const c = new THREE.Color();
    for (let s = 0; s < SPECIES_COUNT; s++) {
      amount[s] = kf(LEAF_KF[s], month);
      cols[s].setRGB(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        c.set(LEAF_COL[s][k]);
        cols[s].r += (c.r * w[k]) / sum;
        cols[s].g += (c.g * w[k]) / sum;
        cols[s].b += (c.b * w[k]) / sum;
      }
      const bloom = BLOOM[s];
      if (bloom) {
        const b = Math.max(0, 1 - Math.abs(month - bloom.peak) / 0.45);
        cols[s].lerp(c.set(bloom.col), Math.min(1, b * 1.6));
      }
    }
    (u.uFallTint.value as THREE.Color).set(w[3] / sum > 0.3 ? '#b07a30' : '#5d6a3a');
  }

  update(camera: THREE.PerspectiveCamera) {
    const moved = camera.position.distanceTo(this.lastPos);
    const turned = 1 - Math.abs(camera.quaternion.dot(this.lastQuat));
    if (moved < 25 && turned < 0.002) return;
    this.lastPos.copy(camera.position);
    this.lastQuat.copy(camera.quaternion);
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const n = [0, 0, 0];
    const a0 = this.inst0.map((a) => a.array as Float32Array);
    const a1 = this.inst1.map((a) => a.array as Float32Array);
    const half = TILE / 2 + 12;
    // Visible tiles nearest-first, so instance caps only ever drop the farthest trees.
    const vis: [number, Tile][] = [];
    for (const t of this.tiles) {
      const dx = Math.max(Math.abs(t.cx - cx) - half, 0);
      const dz = Math.max(Math.abs(t.cz - cz) - half, 0);
      const dy = Math.max(t.minY - cy, cy - t.maxY, 0);
      const tileDist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (tileDist > LOD2) continue;
      this.box.min.set(t.cx - half, t.minY - 2, t.cz - half);
      this.box.max.set(t.cx + half, t.maxY + 2, t.cz + half);
      if (!this.frustum.intersectsBox(this.box)) continue;
      vis.push([tileDist, t]);
    }
    vis.sort((a, b) => a[0] - b[0]);
    for (const [, t] of vis) {
      const d = t.data;
      for (let i = 0; i < t.count; i++) {
        const o = i * 8;
        const ex = d[o] - cx;
        const ey = d[o + 1] - cy;
        const ez = d[o + 2] - cz;
        const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
        let lod = dist < LOD0 ? 0 : dist < LOD1 ? 1 : 2;
        let scale = 1;
        if (lod === 2) {
          if (dist > LOD2) continue;
          // Thin small trees with distance; survivors grow slightly to keep cover.
          const keep = d[o + 6] === TREE.SHRUB ? 0 : Math.min(1, 1.25 - dist / LOD2);
          if (d[o + 7] > keep) continue;
          scale = 1 + (1 - keep) * 0.35;
        } else if (lod === 1 && d[o + 6] === TREE.SHRUB && dist > 1100) continue;
        if (n[lod] >= CAP[lod]) {
          if (lod === 2) continue;
          lod++;
          if (n[lod] >= CAP[lod]) continue;
        }
        const k = n[lod]++ * 4;
        a0[lod][k] = d[o];
        a0[lod][k + 1] = d[o + 1];
        a0[lod][k + 2] = d[o + 2];
        a0[lod][k + 3] = d[o + 3];
        a1[lod][k] = d[o + 4] * scale;
        a1[lod][k + 1] = d[o + 5] * scale;
        a1[lod][k + 2] = d[o + 6];
        a1[lod][k + 3] = d[o + 7];
      }
    }
    for (let lod = 0; lod < 3; lod++) {
      this.geos[lod].instanceCount = n[lod];
      this.inst0[lod].clearUpdateRanges();
      this.inst0[lod].addUpdateRange(0, n[lod] * 4);
      this.inst0[lod].needsUpdate = true;
      this.inst1[lod].clearUpdateRanges();
      this.inst1[lod].addUpdateRange(0, n[lod] * 4);
      this.inst1[lod].needsUpdate = true;
    }
    this.counts = n;
  }
}
