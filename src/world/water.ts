import * as THREE from 'three';
import type { HeightGrid, WorldData } from './loader';
import type { Heightfield } from './heightfield';
import type { RoadIndex } from './roadIndex';

/** Water level grid: covers the land-cover square at this resolution. */
const RES = 2048;
const NO_WATER = -1000;

export type WaterKind = 'river' | 'slough' | 'canal' | 'pond';

interface Channel {
  name: string;
  kind: WaterKind;
  /** Half width (m) and depth at the centre (m). */
  hw: number;
  depth: number;
}

/** Real channel widths: the big rivers are 100-150 m across, sloughs a few metres. */
function channelFor(name: string, kind: string): Channel | null {
  const n = name.toLowerCase();
  if (n === 'sacramento river') return { name, kind: 'river', hw: 62, depth: 6.5 };
  if (n === 'feather river') return { name, kind: 'river', hw: 70, depth: 4.5 };
  if (n === 'yuba river') return { name, kind: 'river', hw: 40, depth: 3 };
  if (n.includes('dry') || n.includes('bypass')) return null;
  if (n === 'butte creek') return { name, kind: 'river', hw: 10, depth: 2.2 };
  if (n.includes('slough')) return { name, kind: 'slough', hw: 7, depth: 1.6 };
  if (kind === 'canal') return name ? { name, kind: 'canal', hw: 8, depth: 1.8 } : { name, kind: 'canal', hw: 5, depth: 1.3 };
  if (kind === 'river') return { name, kind: 'river', hw: name ? 7 : 6, depth: 1.5 };
  if (n.includes('drainage canal')) return { name, kind: 'canal', hw: 7, depth: 1.6 };
  return null;
}

export interface WaterHit {
  level: number;
  /** 0 .. 1: how surely this point is inside a channel or pond. */
  mask: number;
  depth: number;
}

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  la: number;
  lb: number;
  ch: Channel;
}

/**
 * Rivers, sloughs, canals and ponds from OpenStreetMap: works out a smooth
 * water surface along each channel from the elevation model, carves a bed
 * below it into the height grids and bakes a water-level texture that the
 * water surface, riverbed and underwater shaders all share.
 */
export class Water {
  readonly size: number;
  readonly texture: THREE.DataTexture;
  /** Named reach under each level-grid cell (for the HUD and fish). */
  private names: Uint16Array;
  private nameList: { name: string; kind: WaterKind }[] = [{ name: '', kind: 'pond' }];
  private level: Float32Array;
  private mask: Float32Array;
  readonly segments: Segment[] = [];

  constructor(world: WorldData, private hf: Heightfield, roads: RoadIndex) {
    this.size = world.meta.landcover.size;
    this.level = new Float32Array(RES * RES).fill(NO_WATER);
    this.mask = new Float32Array(RES * RES);
    this.names = new Uint16Array(RES * RES);

    const ponds = this.planPonds(world);
    this.planRivers(world);

    const nearRoad = (x: number, z: number) => {
      const r = roads.nearest(x, z, 20);
      return !!r && r.dist < r.halfWidth + 5;
    };
    const inner = world.heights.inner;
    const mid = world.heights.mid;
    for (const s of this.segments) {
      // Small channels only exist where the fine inner grid can hold them.
      const innerOnly = s.ch.hw < 25;
      if (innerOnly && !this.inside(s, inner.size * 0.47)) continue;
      this.carveSegment(inner, s, nearRoad);
      if (!innerOnly) this.carveSegment(mid, s, nearRoad);
      this.paintSegment(s);
    }
    for (const p of ponds) {
      const innerHalf = inner.size * 0.47;
      if (!p.big && Math.max(Math.abs(p.minX), Math.abs(p.maxX), Math.abs(p.minZ), Math.abs(p.maxZ)) > innerHalf) continue;
      this.carvePond(inner, p, nearRoad);
      if (p.big) this.carvePond(mid, p, nearRoad);
      this.paintPond(p);
    }
    this.dilate(8);

    const data = new Uint16Array(RES * RES * 2);
    for (let i = 0; i < RES * RES; i++) {
      data[i * 2] = THREE.DataUtils.toHalfFloat(this.level[i]);
      data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(this.mask[i]);
    }
    this.texture = new THREE.DataTexture(data, RES, RES, THREE.RGFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  private inside(s: Segment, half: number) {
    return Math.max(Math.abs(s.ax), Math.abs(s.az), Math.abs(s.bx), Math.abs(s.bz)) < half;
  }

  /** Water surface, channel mask and depth at (x, z); bilinear like the GPU. */
  sample(x: number, z: number): WaterHit {
    const fx = (x / this.size + 0.5) * RES - 0.5;
    const fz = (z / this.size + 0.5) * RES - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= RES - 1 || z0 >= RES - 1) return { level: NO_WATER, mask: 0, depth: 0 };
    const tx = fx - x0;
    const tz = fz - z0;
    const i = z0 * RES + x0;
    const bl = (a: Float32Array) => {
      const u = a[i] + (a[i + 1] - a[i]) * tx;
      const v = a[i + RES] + (a[i + RES + 1] - a[i + RES]) * tx;
      return u + (v - u) * tz;
    };
    const mask = bl(this.mask);
    if (mask < 0.01) return { level: NO_WATER, mask: 0, depth: 0 };
    const level = bl(this.level);
    return { level, mask, depth: Math.max(0, level - this.hf.height(x, z)) };
  }

  /** Depth of water over the ground at (x, z), 0 on dry land. */
  depthAt(x: number, z: number): number {
    return this.sample(x, z).depth;
  }

  /** Name and kind of the water body at (x, z), if any. */
  bodyAt(x: number, z: number): { name: string; kind: WaterKind } | null {
    const i = Math.floor((x / this.size + 0.5) * RES);
    const j = Math.floor((z / this.size + 0.5) * RES);
    if (i < 0 || j < 0 || i >= RES || j >= RES) return null;
    const k = this.names[j * RES + i];
    return k ? this.nameList[k] : null;
  }

  private nameId(name: string, kind: WaterKind) {
    let k = this.nameList.findIndex((n) => n.name === name && n.kind === kind);
    if (k < 0) {
      k = this.nameList.length;
      this.nameList.push({ name, kind });
    }
    return k;
  }

  /**
   * Water surface along each waterway: the lowest ground across the channel,
   * smoothed, then forced to run downhill in the direction of flow.
   */
  private planRivers(world: WorldData) {
    const half = this.size / 2 - 200;
    for (const w of world.osm.waterways) {
      const ch = channelFor(w.name, w.kind);
      if (!ch) continue;
      const p = w.pts;
      const xs: number[] = [];
      const zs: number[] = [];
      const step = Math.max(8, Math.min(30, ch.hw));
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
        for (let i = 0; i < n; i++) {
          xs.push(ax + ((bx - ax) * i) / n);
          zs.push(az + ((bz - az) * i) / n);
        }
      }
      xs.push(p[p.length - 2]);
      zs.push(p[p.length - 1]);
      if (xs.length < 2) continue;
      const raw = xs.map((x, i) => {
        const z = zs[i];
        const j = Math.min(i + 1, xs.length - 1), h = Math.max(i - 1, 0);
        let dx = xs[j] - xs[h], dz = zs[j] - zs[h];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        let m = Infinity;
        for (let o = -1; o <= 1; o += 0.5) m = Math.min(m, this.hf.height(x - dz * o * ch.hw, z + dx * o * ch.hw));
        return m;
      });
      // Running median knocks out bridges and tree crowns baked into the DEM.
      const win = 6;
      const med = raw.map((_, i) => {
        const a = raw.slice(Math.max(0, i - win), i + win + 1).sort((p, q) => p - q);
        return a[a.length >> 2];
      });
      if (med[0] < med[med.length - 1]) {
        med.reverse();
        xs.reverse();
        zs.reverse();
      }
      for (let i = 1; i < med.length; i++) med[i] = Math.min(med[i], med[i - 1]);
      for (let i = 0; i + 1 < xs.length; i++) {
        if (Math.max(Math.abs(xs[i]), Math.abs(zs[i])) > half) continue;
        this.segments.push({ ax: xs[i], az: zs[i], bx: xs[i + 1], bz: zs[i + 1], la: med[i] - 0.35, lb: med[i + 1] - 0.35, ch });
      }
    }
  }

  /** Compact lakes and ponds; long river polygons are left to the centrelines. */
  private planPonds(world: WorldData) {
    const out: { pts: number[]; holes?: number[][]; level: number; depth: number; name: string; big: boolean; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
    const half = this.size / 2 - 200;
    for (const a of world.osm.waterAreas) {
      const n = a.name.toLowerCase();
      if (n.includes('river') || n.includes('bypass')) continue;
      const p = a.pts;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]);
        maxX = Math.max(maxX, p[i]);
        minZ = Math.min(minZ, p[i + 1]);
        maxZ = Math.max(maxZ, p[i + 1]);
      }
      const ext = Math.max(maxX - minX, maxZ - minZ);
      if (ext > 2500 || ext < 12 || Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ)) > half) continue;
      const hs: number[] = [];
      for (let i = 0; i < p.length; i += 2) hs.push(this.hf.height(p[i], p[i + 1]));
      hs.sort((x, y) => x - y);
      const level = hs[Math.floor(hs.length * 0.2)] - 0.3;
      out.push({ pts: p, holes: a.holes, level, depth: Math.min(4, 1 + ext * 0.01), name: a.name, big: ext > 150, minX, maxX, minZ, maxZ });
    }
    return out;
  }

  private carveSegment(g: HeightGrid, s: Segment, nearRoad: (x: number, z: number) => boolean) {
    const cell = g.size / g.res;
    const hw = Math.max(s.ch.hw, cell * 0.9);
    const bank = cell * 1.5;
    const reach = hw + bank;
    const toI = (v: number) => (v / g.size + 0.5) * g.res - 0.5;
    const i0 = Math.max(0, Math.floor(toI(Math.min(s.ax, s.bx) - reach)));
    const i1 = Math.min(g.res - 1, Math.ceil(toI(Math.max(s.ax, s.bx) + reach)));
    const j0 = Math.max(0, Math.floor(toI(Math.min(s.az, s.bz) - reach)));
    const j1 = Math.min(g.res - 1, Math.ceil(toI(Math.max(s.az, s.bz) + reach)));
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const len2 = ex * ex + ez * ez || 1;
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / g.res - 0.5) * g.size;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / g.res - 0.5) * g.size;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / len2));
        const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t);
        if (d > reach) continue;
        const L = s.la + (s.lb - s.la) * t;
        const target = d < hw ? L - s.ch.depth * (1 - (d / hw) ** 2) : L + ((d - hw) / bank) * 1.2;
        const k = j * g.res + i;
        if (target < g.heights[k] && !nearRoad(x, z)) g.heights[k] = target;
      }
    }
  }

  private paintSegment(s: Segment) {
    const cell = this.size / RES;
    const reach = s.ch.hw + cell * 1.5;
    const toI = (v: number) => (v / this.size + 0.5) * RES - 0.5;
    const i0 = Math.max(0, Math.floor(toI(Math.min(s.ax, s.bx) - reach)));
    const i1 = Math.min(RES - 1, Math.ceil(toI(Math.max(s.ax, s.bx) + reach)));
    const j0 = Math.max(0, Math.floor(toI(Math.min(s.az, s.bz) - reach)));
    const j1 = Math.min(RES - 1, Math.ceil(toI(Math.max(s.az, s.bz) + reach)));
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const len2 = ex * ex + ez * ez || 1;
    const id = this.nameId(s.ch.name, s.ch.kind);
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / RES - 0.5) * this.size;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / RES - 0.5) * this.size;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / len2));
        const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t);
        if (d > reach) continue;
        const k = j * RES + i;
        const L = s.la + (s.lb - s.la) * t;
        // Where channels meet, the lower (bigger) water wins.
        if (this.mask[k] === 0 || L < this.level[k]) {
          this.level[k] = L;
          this.names[k] = id;
        }
        this.mask[k] = 1;
      }
    }
  }

  /** Signed distance into the pond (negative outside it or on one of its islands). */
  private pondDist(p: { pts: number[]; holes?: number[][] }, x: number, z: number): number {
    const ring = (a: number[]) => {
      let inside = false;
      let best = Infinity;
      for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
        const xi = a[i], zi = a[i + 1], xj = a[j], zj = a[j + 1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        const ex = xj - xi, ez = zj - zi;
        const t = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - xi - ex * t, z - zi - ez * t));
      }
      return inside ? best : -best;
    };
    let d = ring(p.pts);
    if (d <= 0 || !p.holes) return d;
    for (const h of p.holes) d = Math.min(d, -ring(h));
    return d;
  }

  private carvePond(g: HeightGrid, p: { pts: number[]; level: number; depth: number; minX: number; maxX: number; minZ: number; maxZ: number }, nearRoad: (x: number, z: number) => boolean) {
    const cell = g.size / g.res;
    const bank = cell * 1.5;
    const toI = (v: number) => (v / g.size + 0.5) * g.res - 0.5;
    const i0 = Math.max(0, Math.floor(toI(p.minX - bank)));
    const i1 = Math.min(g.res - 1, Math.ceil(toI(p.maxX + bank)));
    const j0 = Math.max(0, Math.floor(toI(p.minZ - bank)));
    const j1 = Math.min(g.res - 1, Math.ceil(toI(p.maxZ + bank)));
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / g.res - 0.5) * g.size;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / g.res - 0.5) * g.size;
        const d = this.pondDist(p, x, z);
        if (d < -bank) continue;
        const target = d > 0 ? p.level - Math.min(p.depth, 0.3 + d * 0.12) : p.level + (-d / bank) * 1.0;
        const k = j * g.res + i;
        if (target < g.heights[k] && !nearRoad(x, z)) g.heights[k] = target;
      }
    }
  }

  private paintPond(p: { pts: number[]; level: number; name: string; minX: number; maxX: number; minZ: number; maxZ: number }) {
    const cell = this.size / RES;
    const toI = (v: number) => (v / this.size + 0.5) * RES - 0.5;
    const i0 = Math.max(0, Math.floor(toI(p.minX - cell * 2)));
    const i1 = Math.min(RES - 1, Math.ceil(toI(p.maxX + cell * 2)));
    const j0 = Math.max(0, Math.floor(toI(p.minZ - cell * 2)));
    const j1 = Math.min(RES - 1, Math.ceil(toI(p.maxZ + cell * 2)));
    const id = this.nameId(p.name, 'pond');
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / RES - 0.5) * this.size;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / RES - 0.5) * this.size;
        if (this.pondDist(p, x, z) < -cell * 1.5) continue;
        const k = j * RES + i;
        if (this.mask[k] === 0 || p.level < this.level[k]) {
          this.level[k] = p.level;
          this.names[k] = id;
        }
        this.mask[k] = 1;
      }
    }
  }

  /**
   * Spreads each water level a few cells beyond its channel so the surface
   * mesh, which is sampled per vertex, never dips toward "no water".
   */
  private dilate(passes: number) {
    const L = this.level;
    for (let p = 0; p < passes; p++) {
      const next = L.slice();
      for (let j = 1; j < RES - 1; j++) {
        for (let i = 1; i < RES - 1; i++) {
          const k = j * RES + i;
          if (L[k] > NO_WATER) continue;
          let sum = 0, n = 0;
          const a = L[k - 1], b = L[k + 1], c = L[k - RES], d = L[k + RES];
          if (a > NO_WATER) (sum += a), n++;
          if (b > NO_WATER) (sum += b), n++;
          if (c > NO_WATER) (sum += c), n++;
          if (d > NO_WATER) (sum += d), n++;
          if (n) next[k] = sum / n;
        }
      }
      L.set(next);
    }
  }
}
