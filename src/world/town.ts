import * as THREE from 'three';
import { G } from '../render/globals';
import type { ShadowMap } from '../render/shadows';
import { TREE, type PlantedTree } from '../veg/trees';
import { STYLE, townFragment, townVertex } from '../render/shaders/townShader';
import { Decks } from './decks';
import type { Heightfield } from './heightfield';
import type { OsmData, TownBridge, TownBuilding, TownData } from './meta';
import { roadSpec } from './roads';
import type { Water } from './water';

type RGB = [number, number, number];
type V3 = [number, number, number];

const TILE = 600;

function hash(n: number) {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
}

const col = new THREE.Color();
const rgb = (hex: string): RGB => {
  col.set(hex);
  return [col.r, col.g, col.b];
};
const pick = (list: string[], s: number) => rgb(list[Math.floor(s * list.length) % list.length]);

// Paint and materials seen around town: Victorian and bungalow paint, Gold Rush
// brick (some painted over), stucco on the 1920s–60s blocks.
// Painted Victorian siding: whites, creams and pastels.
const HOUSE = ['#f4f1e8', '#cfe0ea', '#d8e8cf', '#f2e3a6', '#efd3cc', '#c9d8bd', '#e6d4b2', '#bccddb', '#f3e8cf', '#ddcbe0', '#acc9b8', '#f6f4ee'];
const BRICK = ['#8a4b38', '#7c4332', '#94553d', '#6f3d2e', '#9b5e45'];
const PAINTED = ['#d8cdb8', '#c9c1a8', '#b3c1b0', '#e2d6c0', '#cdb79a'];
const MODERN = ['#d6cfc2', '#c8c4bc', '#b8b4ac', '#e0dcd2', '#a8a49c', '#cbbfa8'];
const STUCCO = ['#e3d9c6', '#d5cbb8', '#cfc6b8', '#e8e0cf', '#c4b9a6'];
const SHINGLE = ['#4a4744', '#5a4e44', '#3b3a3a', '#6b5a4a', '#55524d', '#6e4535'];
const FLAT = ['#5a5856', '#6b6862', '#7a776f', '#4a4846', '#c9c7c0'];

const K = { HOUSE: 0, COMMERCIAL: 1, RETAIL: 2, APARTMENTS: 3, CIVIC: 4, INDUSTRIAL: 5, SHED: 6, CANOPY: 7, CHURCH: 8, TEMPLE: 9, HOTEL: 10 };
const ROOF = { FLAT: 0, GABLE: 1, HIP: 2 };

/** Collects non-indexed triangles with the town shader's attributes. */
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  fac: number[] = [];

  vert(p: V3, n: V3, c: RGB, style: number, f: [number, number, number, number]) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2], style);
    this.fac.push(f[0], f[1], f[2], f[3]);
  }

  /** Triangle with a flat normal; facade coords per vertex. */
  tri(a: V3, b: V3, c: V3, color: RGB, style: number, fa: number[], fb: number[], fc: number[], n?: V3) {
    const nn = n ?? faceNormal(a, b, c);
    this.vert(a, nn, color, style, fa as [number, number, number, number]);
    this.vert(b, nn, color, style, fb as [number, number, number, number]);
    this.vert(c, nn, color, style, fc as [number, number, number, number]);
  }

  quad(a: V3, b: V3, c: V3, d: V3, color: RGB, style: number, fa: number[], fb: number[], fc: number[], fd: number[], n?: V3) {
    const nn = n ?? faceNormal(a, b, c);
    this.tri(a, b, c, color, style, fa, fb, fc, nn);
    this.tri(a, c, d, color, style, fa, fc, fd, nn);
  }

  /** Square-section beam between two points. */
  beam(a: V3, b: V3, w: number, h: number, color: RGB, style: number) {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    if (len < 1e-3) return;
    const f: V3 = [d[0] / len, d[1] / len, d[2] / len];
    const ref: V3 = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const s = norm(cross(f, ref));
    const u = cross(s, f);
    const corner = (p: V3, i: number): V3 => {
      const cs = i === 0 || i === 3 ? -1 : 1;
      const cu = i < 2 ? -1 : 1;
      return [p[0] + s[0] * cs * w * 0.5 + u[0] * cu * h * 0.5, p[1] + s[1] * cs * w * 0.5 + u[1] * cu * h * 0.5, p[2] + s[2] * cs * w * 0.5 + u[2] * cu * h * 0.5];
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const f0 = [0, 0, 0, 0];
      const f1 = [len, 0, 0, 0];
      this.quad(corner(a, i), corner(b, i), corner(b, j), corner(a, j), color, style, f0, f1, f1, f0);
    }
  }

  /** Yaw-rotated box resting on y0. */
  box(cx: number, cz: number, y0: number, w: number, d: number, h: number, ang: number, color: RGB, style: number, top = true, faceStyle?: number, storey = 0) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (u: number, v: number): [number, number] => [cx + u * c - v * s, cz + u * s + v * c];
    const pts = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    let u0 = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n: V3 = [(b[1] - a[1]) / l, 0, -(b[0] - a[0]) / l];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + h, b[1]], [a[0], y0 + h, a[1]], color, faceStyle ?? style, [u0, 0, storey, 9], [u0 + l, 0, storey, 9], [u0 + l, h, storey, 9], [u0, h, storey, 9], n);
      u0 += l;
    }
    if (top) {
      const y = y0 + h;
      const f = [0, h, 0, 0];
      this.quad([pts[0][0], y, pts[0][1]], [pts[3][0], y, pts[3][1]], [pts[2][0], y, pts[2][1]], [pts[1][0], y, pts[1][1]], color, style, f, f, f, f, [0, 1, 0]);
    }
  }

  /** Vertical prism (cylinder or n-gon), optionally tapering to a point. */
  prism(cx: number, cz: number, y0: number, r0: number, r1: number, h: number, sides: number, color: RGB, style: number, rot = 0) {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2;
      const a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      const p0: V3 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const p1: V3 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const q0: V3 = [cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1];
      const q1: V3 = [cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1];
      const am = (a0 + a1) / 2;
      const slope = (r0 - r1) / h;
      const n = norm([Math.cos(am), slope, Math.sin(am)]);
      const u0 = (i / sides) * Math.PI * 2 * r0;
      const u1 = ((i + 1) / sides) * Math.PI * 2 * r0;
      if (r1 < 1e-3) this.tri(p0, p1, [cx, y0 + h, cz], color, style, [u0, 0, 0, 0], [u1, 0, 0, 0], [u0, h, 0, 0], n);
      else this.quad(p0, p1, q1, q0, color, style, [u0, 0, 0, 0], [u1, 0, 0, 0], [u1, h, 0, 0], [u0, h, 0, 0], n);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 4));
    g.computeBoundingSphere();
    return g;
  }
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function faceNormal(a: V3, b: V3, c: V3): V3 {
  return norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
}

function area(ring: [number, number][]) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

function ringOf(b: TownBuilding): [number, number][] {
  const r: [number, number][] = [];
  for (let i = 0; i < b.p.length; i += 2) r.push([b.p[i], b.p[i + 1]]);
  return r;
}

export function insidePoly(pts: [number, number][], x: number, z: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Oriented box around a footprint, long axis first. */
function obb(ring: [number, number][]) {
  let best = 0;
  let ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const l = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (l > best) {
      best = l;
      ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of ring) {
    const u = x * c + z * s;
    const v = -x * s + z * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  let w = u1 - u0, d = v1 - v0;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cx = uc * c - vc * s, cz = uc * s + vc * c;
  if (d > w) {
    [w, d] = [d, w];
    ang += Math.PI / 2;
  }
  return { cx, cz, w, d, ang };
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
}

interface Chunk {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  center: THREE.Vector3;
  radius: number;
  caster?: THREE.Mesh;
}

/**
 * Marysville from OpenStreetMap: every mapped building extruded from its real
 * footprint, the landmarks built by hand from surveys and photos, and the
 * Feather and Yuba river bridges on their piers.
 */
export class Town {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly shadowMaterial: THREE.ShaderMaterial;
  readonly lights: number[] = [];
  readonly decks: Decks;
  readonly landmarks: Landmark[] = [];
  readonly name: string;
  readonly cx: number;
  readonly cz: number;
  readonly half: number;
  readonly core: [number, number][];
  /** Building walls for sidewalk placement: x0, z0, x1, z1 per edge, gridded. */
  private edges = new Map<number, number[]>();
  private chunks: Chunk[] = [];
  private builders = new Map<number, Builder>();

  constructor(
    readonly data: TownData,
    private hf: Heightfield,
    private water: Water,
    private osm: OsmData,
    /** The primary town also bridges every river crossing in the valley; others share its decks. */
    primary = true,
  ) {
    this.name = data.name;
    this.decks = (!primary && hf.decks) || new Decks();
    [this.cx, this.cz] = data.center;
    this.half = data.size / 2;
    this.core = data.core;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: townVertex,
      fragmentShader: townFragment,
      uniforms: { ...G },
      side: THREE.DoubleSide,
    });
    this.shadowMaterial = this.material.clone();
    this.shadowMaterial.uniforms = this.material.uniforms;
    this.shadowMaterial.defines = { SHADOW_PASS: '' };

    for (const b of data.buildings) this.addBuilding(b);
    for (const br of joinBridges(data.bridges)) this.addBridge(br);
    if (primary) for (const br of this.crossings()) this.addBridge(br, true);

    for (const [, bld] of this.builders) {
      if (!bld.pos.length) continue;
      const geo = bld.build();
      const mesh = new THREE.Mesh(geo, this.material);
      this.group.add(mesh);
      this.chunks.push({ mesh, geo, center: geo.boundingSphere!.center, radius: geo.boundingSphere!.radius });
    }
    hf.decks = this.decks;
  }

  /** Inside the zone the town draws itself (generic props stand down). */
  covers(x: number, z: number) {
    return Math.abs(x - this.cx) < this.half - 30 && Math.abs(z - this.cz) < this.half - 30;
  }

  inCore(x: number, z: number) {
    return insidePoly(this.core, x, z);
  }

  private builder(x: number, z: number) {
    const k = Math.floor(x / TILE) * 1000 + Math.floor(z / TILE);
    let b = this.builders.get(k);
    if (!b) this.builders.set(k, (b = new Builder()));
    return b;
  }

  /** Distance (m) from (x, z) along (nx, nz) to the nearest building wall, up to `max`. */
  frontage(x: number, z: number, nx: number, nz: number, max: number): number {
    let best = max;
    const steps = Math.ceil(max / 20);
    const seen = new Set<number[]>();
    for (let k = 0; k <= steps; k++) {
      const px = x + nx * k * 20, pz = z + nz * k * 20;
      const l = this.edges.get(Math.floor(px / 20) * 100003 + Math.floor(pz / 20));
      if (!l || seen.has(l)) continue;
      seen.add(l);
      for (let i = 0; i < l.length; i += 4) {
        // Ray (x,z)+t*(nx,nz) against segment.
        const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az;
        const den = nx * ez - nz * ex;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((ax - x) * ez - (az - z) * ex) / den;
        const s = ((ax - x) * nz - (az - z) * nx) / den;
        if (t > 0 && t < best && s >= 0 && s <= 1) best = t;
      }
    }
    return best;
  }

  /** Is there a building wall within `r` of (x, z)? */
  nearWall(x: number, z: number, r: number) {
    const l = this.edges.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (!l) return false;
    for (let i = 0; i < l.length; i += 4) {
      const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < r) return true;
    }
    return false;
  }

  /** Is the straight line between two points free of walls? */
  clearLine(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 0.5) return true;
    return this.frontage(ax, az, (bx - ax) / d, (bz - az) / d, d) >= d - 0.05;
  }

  /** Pushes a circle of radius `r` at (x, z) out of any building wall it overlaps. */
  push(p: { x: number; z: number }, r: number) {
    const seen = new Set<number[]>();
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const l = this.edges.get((Math.floor(p.x / 20) + di) * 100003 + Math.floor(p.z / 20) + dj);
        if (!l || seen.has(l)) continue;
        seen.add(l);
        for (let i = 0; i < l.length; i += 4) {
          const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az;
          const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / (ex * ex + ez * ez || 1)));
          const dx = p.x - (ax + ex * t), dz = p.z - (az + ez * t);
          const d = Math.hypot(dx, dz);
          if (d >= r || d < 1e-6) continue;
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        }
      }
  }

  private addEdge(ax: number, az: number, bx: number, bz: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
    const keys = new Set<number>();
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      keys.add(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    }
    for (const k of keys) {
      let l = this.edges.get(k);
      if (!l) this.edges.set(k, (l = []));
      l.push(ax, az, bx, bz);
    }
  }

  // ---------------------------------------------------------------- buildings

  private addBuilding(b: TownBuilding) {
    const ring = ringOf(b);
    let cx = 0, cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;
    if (!this.covers(cx, cz)) return;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      this.addEdge(a[0], a[1], c[0], c[1]);
    }
    if (b.n && b.id) this.landmarks.push({ id: b.id, name: b.n, x: cx, z: cz });
    if (b.id === 'stjoseph') return this.stJoseph(ring, cx, cz);
    if (b.k === K.TEMPLE || b.id === 'bokkai') return this.bokKai(ring, cx, cz);

    const out = this.builder(cx, cz);
    const s = hash(cx * 0.37 + cz * 1.31);
    const yG = this.hf.height(cx, cz);
    let base = yG;
    for (const [x, z] of ring) base = Math.min(base, this.hf.height(x, z));
    base -= 0.4;

    let wall: RGB, style: number, roofCol: RGB, roofStyle: number, storey = 3.0, parapet = 0;
    switch (b.k) {
      case K.COMMERCIAL: {
        const painted = s < 0.3;
        wall = painted ? pick(PAINTED, s * 3.3) : pick(BRICK, s);
        style = STYLE.BRICK;
        roofCol = pick(FLAT, s * 7);
        roofStyle = STYLE.ROOF_FLAT;
        storey = 4.0;
        parapet = 0;
        break;
      }
      case K.HOTEL:
        wall = b.id === 'hotel' ? rgb('#e2d3b5') : pick(STUCCO, s);
        style = b.l >= 3 ? STYLE.HOTEL : STYLE.STUCCO;
        roofCol = pick(FLAT, s * 5);
        roofStyle = STYLE.ROOF_FLAT;
        storey = b.l >= 3 ? b.h / b.l : 3.0;
        parapet = 0.8;
        break;
      case K.RETAIL:
      case K.CIVIC:
        wall = pick(MODERN, s);
        style = STYLE.MODERN;
        roofCol = pick(FLAT, s * 5);
        roofStyle = STYLE.ROOF_FLAT;
        storey = 3.6;
        parapet = 0.7;
        break;
      case K.INDUSTRIAL:
        wall = pick(['#b8bcc0', '#a9aeb2', '#c4c6c4', '#9ea3a8'], s);
        style = STYLE.STUCCO;
        roofCol = rgb('#a8abae');
        roofStyle = STYLE.ROOF_METAL;
        storey = 0;
        break;
      case K.APARTMENTS:
        wall = pick(STUCCO, s);
        style = STYLE.STUCCO;
        roofCol = b.r === ROOF.FLAT ? pick(FLAT, s * 5) : pick(SHINGLE, s * 3);
        roofStyle = b.r === ROOF.FLAT ? STYLE.ROOF_FLAT : STYLE.ROOF_SHINGLE;
        storey = 3.0;
        parapet = b.r === ROOF.FLAT ? 0.5 : 0;
        break;
      case K.SHED:
        wall = pick(['#b7b4ab', '#c9c6be', '#8a7e6e', '#d8d2c4'], s);
        style = STYLE.SIDING;
        roofCol = rgb(s < 0.5 ? '#9ea3a8' : '#5a4e44');
        roofStyle = s < 0.5 ? STYLE.ROOF_METAL : STYLE.ROOF_SHINGLE;
        storey = 0;
        break;
      case K.CHURCH:
        wall = rgb(s < 0.6 ? '#ece8de' : '#c9b49a');
        style = STYLE.STUCCO;
        roofCol = pick(SHINGLE, s * 3);
        roofStyle = b.r === ROOF.FLAT ? STYLE.ROOF_FLAT : STYLE.ROOF_SHINGLE;
        storey = 0;
        break;
      default:
        wall = pick(HOUSE, s);
        style = s < 0.6 ? STYLE.SIDING : STYLE.STUCCO;
        roofCol = pick(SHINGLE, s * 3);
        roofStyle = STYLE.ROOF_SHINGLE;
        storey = 3.0;
    }
    if (b.c) wall = rgb(b.c);
    // Marysville High: red brick halls under red clay tile.
    let h = b.h;
    let roofForm = b.r;
    if (b.cp === 'mhs') {
      wall = pick(['#b06650', '#b86e56', '#a55f4a'], s);
      style = STYLE.SCHOOL;
      storey = 4.0;
      parapet = 0;
      h = Math.max(1, b.l) * 4.0 + 0.8;
      const o = obb(ring);
      if (o.w * o.d > 350 && area(ring) > o.w * o.d * 0.85) {
        roofForm = ROOF.HIP;
        roofCol = rgb('#a6472c');
        roofStyle = STYLE.ROOF_TILE;
      } else {
        roofCol = pick(FLAT, s * 5);
        roofStyle = STYLE.ROOF_FLAT;
      }
    }

    if (b.k === K.CANOPY) {
      const o = obb(ring);
      const top = yG + b.h;
      out.box(o.cx, o.cz, top - 0.45, o.w, o.d, 0.45, o.ang, rgb('#d8d8d4'), STYLE.MODERN);
      const c = Math.cos(o.ang), sn = Math.sin(o.ang);
      for (const [pu, pv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const u = pu * (o.w / 2 - 0.6), v = pv * (o.d / 2 - 0.6);
        const px = o.cx + u * c - v * sn, pz = o.cz + u * sn + v * c;
        out.box(px, pz, this.hf.height(px, pz) - 0.2, 0.3, 0.3, top - this.hf.height(px, pz), o.ang, rgb('#9a9c9e'), STYLE.STEEL, false);
      }
      return;
    }

    const levels = Math.max(1, b.l);
    const top = yG + h;
    this.walls(out, ring, base, top + parapet, yG, wall, style, storey, levels);
    if (roofForm === ROOF.FLAT || b.k === K.COMMERCIAL) {
      this.flatRoof(out, ring, top, roofCol, roofStyle);
    } else {
      const o = obb(ring);
      this.pitchedRoof(out, o, top, roofForm === ROOF.HIP, roofCol, roofStyle, wall, style, yG, 0.45, b.cp ? 24 : b.k === K.HOUSE ? 42 : 32);
    }

    if (b.id === 'state') this.marquee(out, ring, yG);
    if (b.id === 'hotel') this.hotelTower(out, ring, yG, wall);
    if (b.k === K.HOUSE && area(ring) < 350 && hash(s * 91.7) < 0.8) this.porch(out, ring, yG, roofCol);
    if (b.k === K.COMMERCIAL && b.d && s > 0.55) this.awning(out, ring, yG, s);
  }

  private walls(out: Builder, ring: [number, number][], base: number, top: number, yG: number, wall: RGB, style: number, storey: number, levels: number) {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n: V3 = [(c[1] - a[1]) / l, 0, -(c[0] - a[0]) / l];
      const vb = base - yG, vt = top - yG;
      out.quad([a[0], base, a[1]], [c[0], base, c[1]], [c[0], top, c[1]], [a[0], top, a[1]], wall, style, [u, vb, storey, levels], [u + l, vb, storey, levels], [u + l, vt, storey, levels], [u, vt, storey, levels], n);
      u += l;
    }
  }

  private flatRoof(out: Builder, ring: [number, number][], y: number, color: RGB, style: number) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      return;
    }
    for (const [i, j, k] of tris) {
      const f = [ring[i][0], 0, 0, 0];
      out.tri([ring[i][0], y, ring[i][1]], [ring[k][0], y, ring[k][1]], [ring[j][0], y, ring[j][1]], color, style, f, [ring[k][0], 0, 0, 0], [ring[j][0], 0, 0, 0], [0, 1, 0]);
    }
  }

  /**
   * Gable or hip roof over an oriented box, eaves at `y` with an overhang.
   * Ridge runs along the long axis; pitch in degrees.
   */
  private pitchedRoof(out: Builder, o: { cx: number; cz: number; w: number; d: number; ang: number }, y: number, hip: boolean, color: RGB, style: number, wall: RGB, wallStyle: number, yG: number, over: number, pitch: number) {
    const c = Math.cos(o.ang), s = Math.sin(o.ang);
    const P = (u: number, v: number, h: number): V3 => [o.cx + u * c - v * s, h, o.cz + u * s + v * c];
    const hw = o.w / 2 + over, hd = o.d / 2 + over;
    const rise = hd * Math.tan((pitch * Math.PI) / 180);
    const yr = y + rise;
    const ridge = hip ? Math.max(0, hw - hd) : hw;
    const y0 = y - over * Math.tan((pitch * Math.PI) / 180);
    const f = (u: number) => [u, 0, 0, 0];
    // Long slopes.
    out.quad(P(-hw, -hd, y0), P(hw, -hd, y0), P(ridge, 0, yr), P(-ridge, 0, yr), color, style, f(-hw), f(hw), f(ridge), f(-ridge));
    out.quad(P(hw, hd, y0), P(-hw, hd, y0), P(-ridge, 0, yr), P(ridge, 0, yr), color, style, f(hw), f(-hw), f(-ridge), f(ridge));
    if (hip) {
      out.tri(P(hw, -hd, y0), P(hw, hd, y0), P(ridge, 0, yr), color, style, f(-hd), f(hd), f(0));
      out.tri(P(-hw, hd, y0), P(-hw, -hd, y0), P(-ridge, 0, yr), color, style, f(hd), f(-hd), f(0));
    } else {
      // Gable ends in the wall finish, flush with the walls.
      const gw = o.w / 2, gd = o.d / 2;
      for (const e of [-1, 1]) {
        const vt = yr - yG, vb = y - yG;
        out.tri(P(e * gw, -gd, y), P(e * gw, gd, y), P(e * gw, 0, yr), wall, wallStyle, [0, vb, 0, 0], [o.d, vb, 0, 0], [o.d / 2, vt, 0, 0]);
      }
    }
  }

  /**
   * Hotel Marysville (1927): a seven-storey tower over the centre bay, capped by
   * a red clay-tile pyramid, with balconies stacked at its corners.
   */
  private hotelTower(out: Builder, ring: [number, number][], yG: number, wall: RGB) {
    const o = obb(ring);
    const w = Math.min(16, o.w * 0.4), d = Math.min(16, o.d * 0.6);
    const { cx, cz, ang } = o;
    const storey = 3.6, levels = 8;
    const top = yG + storey * levels;
    const c = Math.cos(ang), s = Math.sin(ang);
    const box: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([du, dv]) => {
      const u = (du * w) / 2, v = (dv * d) / 2;
      return [cx + u * c - v * s, cz + u * s + v * c];
    });
    this.walls(out, box, yG - 0.4, top, yG, wall, STYLE.HOTEL, storey, levels);
    out.box(cx, cz, top, w + 0.8, d + 0.8, 0.6, ang, rgb('#efe6d2'), STYLE.STUCCO);
    this.pitchedRoof(out, { cx, cz, w: w + 0.4, d: d + 0.4, ang }, top + 0.6, true, rgb('#a6472c'), STYLE.ROOF_TILE, wall, STYLE.STUCCO, yG, 0.6, 34);
    const rail = rgb('#3a3632');
    for (const [du, dv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const u = du * (w / 2 + 0.5), v = dv * (d / 2 - 1.6);
      const x = cx + u * c - v * s, z = cz + u * s + v * c;
      for (let k = 2; k < levels; k++) {
        out.box(x, z, yG + k * storey, 1.0, 2.6, 0.18, ang, wall, STYLE.CONCRETE);
        out.box(x + du * c * 0.45, z + du * s * 0.45, yG + k * storey + 0.18, 0.06, 2.6, 0.9, ang, rail, STYLE.RAILING);
      }
    }
  }

  /** Front porch on a house: raised deck, turned posts, railing and a shed roof. */
  private porch(out: Builder, ring: [number, number][], yG: number, roofCol: RGB) {
    const e = this.streetEdge(ring);
    if (!e) return;
    const [a, c, n] = e;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l < 5) return;
    const span = Math.min(l - 0.8, 9), dep = 2.2;
    const tx = (c[0] - a[0]) / l, tz = (c[1] - a[1]) / l;
    const ang = Math.atan2(tz, tx);
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const px = mx + n[0] * dep * 0.5, pz = mz + n[2] * dep * 0.5;
    const trim = rgb('#f4f1ea');
    const deck = yG + 0.6, eave = yG + 3.1;
    out.box(px, pz, yG - 0.3, span, dep, 0.9, ang, rgb('#cfc8bb'), STYLE.STUCCO);
    out.box(px + n[0] * 0.15, pz + n[2] * 0.15, eave, span + 0.3, dep + 0.3, 0.16, ang, roofCol, STYLE.ROOF_SHINGLE);
    const posts = Math.max(2, Math.round(span / 2.4) + 1);
    for (let i = 0; i < posts; i++) {
      const u = (i / (posts - 1) - 0.5) * (span - 0.3);
      const x = mx + tx * u + n[0] * (dep - 0.15), z = mz + tz * u + n[2] * (dep - 0.15);
      out.box(x, z, deck, 0.16, 0.16, eave - deck, ang, trim, STYLE.STUCCO, false);
    }
    const fx = mx + n[0] * (dep - 0.15), fz = mz + n[2] * (dep - 0.15);
    for (const side of [-1, 1]) {
      const u = side * (span * 0.3 + 0.5);
      out.box(fx + tx * u, fz + tz * u, deck + 0.85, span * 0.4 - 0.6, 0.08, 0.08, ang, trim, STYLE.STUCCO, false);
      out.box(fx + tx * u, fz + tz * u, deck + 0.1, span * 0.4 - 0.6, 0.04, 0.75, ang, trim, STYLE.RAILING, false);
    }
  }

  /** Canvas awning over a downtown shopfront, on the side facing the street. */
  private awning(out: Builder, ring: [number, number][], yG: number, s: number) {
    const e = this.streetEdge(ring);
    if (!e) return;
    const [a, c, n] = e;
    const colr = pick(['#7a1f1f', '#1f4a3a', '#2a3550', '#5a2a3a', '#3a3a3a', '#8a6a2a'], s * 5);
    const y1 = yG + 3.4, y0 = yG + 2.7, dep = 1.6;
    const ins = 0.6;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l < 4) return;
    const t = [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
    const A: V3 = [a[0] + t[0] * ins, y1, a[1] + t[1] * ins];
    const C: V3 = [c[0] - t[0] * ins, y1, c[1] - t[1] * ins];
    const f = [0, 3, 0, 0];
    out.quad(A, C, [C[0] + n[0] * dep, y0, C[2] + n[2] * dep], [A[0] + n[0] * dep, y0, A[2] + n[2] * dep], colr, STYLE.RAILING, f, f, f, f);
  }

  /** The footprint edge most nearly facing the nearest street (longest frontage wins ties). */
  private streetEdge(ring: [number, number][]): [[number, number], [number, number], V3] | null {
    let best: [[number, number], [number, number], V3] | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (l < 3) continue;
      const n: V3 = [(c[1] - a[1]) / l, 0, -(c[0] - a[0]) / l];
      const mx = (a[0] + c[0]) / 2 + n[0] * 6, mz = (a[1] + c[1]) / 2 + n[2] * 6;
      const d = this.roadDist(mx, mz);
      const score = l * 0.05 - d;
      if (score > bestScore) {
        bestScore = score;
        best = [a, c, n];
      }
    }
    return best;
  }

  private roadGrid: Map<number, number[]> | null = null;
  private roadDist(x: number, z: number, name?: string): number {
    if (!this.roadGrid) {
      this.roadGrid = new Map();
      this.osm.roads.forEach((r, ri) => {
        const p = r.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const mx = (p[i] + p[i + 2]) / 2, mz = (p[i + 1] + p[i + 3]) / 2;
          if (!this.covers(mx, mz)) continue;
          const k = Math.floor(mx / 100) * 100003 + Math.floor(mz / 100);
          let l = this.roadGrid!.get(k);
          if (!l) this.roadGrid!.set(k, (l = []));
          l.push(ri, i);
        }
      });
    }
    let best = 200;
    const ci = Math.floor(x / 100), cj = Math.floor(z / 100);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const l = this.roadGrid.get((ci + di) * 100003 + cj + dj);
        if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const r = this.osm.roads[l[k]];
          if (name && r.name !== name) continue;
          const p = r.pts, i = l[k + 1];
          const ex = p[i + 2] - p[i], ez = p[i + 3] - p[i + 1];
          const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (z - p[i + 1]) * ez) / (ex * ex + ez * ez || 1)));
          best = Math.min(best, Math.hypot(p[i] + ex * t - x, p[i + 1] + ez * t - z));
        }
      }
    }
    return best;
  }

  /** State Theatre (1927): a lit marquee over the E Street entrance. */
  private marquee(out: Builder, ring: [number, number][], yG: number) {
    const e = this.streetEdge(ring);
    if (!e) return;
    const [a, c, n] = e;
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const w = Math.min(9, Math.hypot(c[0] - a[0], c[1] - a[1]) * 0.8);
    const dep = 3.2;
    const px = mx + n[0] * dep / 2, pz = mz + n[2] * dep / 2;
    out.box(px, pz, yG + 3.5, w, dep, 1.1, ang, rgb('#efe6d0'), STYLE.MODERN);
    // Chaser bulbs round the marquee edge.
    const t = [Math.cos(ang), Math.sin(ang)];
    for (let k = 0; k <= 12; k++) {
      const u = -w / 2 + (k / 12) * w;
      const x = px + t[0] * u + n[0] * dep / 2, z = pz + t[1] * u + n[2] * dep / 2;
      this.lights.push(x, yG + 3.45, z, 1, 0.78, 0.45, 0.35, 0);
    }
    this.lights.push(px + n[0] * 1.2, yG + 3.2, pz + n[2] * 1.2, 1, 0.85, 0.6, 1.6, 0);
  }

  // ---------------------------------------------------------------- landmarks

  /**
   * St. Joseph Catholic Church (1855): white stucco over brick, buttressed nave,
   * a central tower carrying the 100-foot steeple (its spire replaced in 2020)
   * and a rose window over the door. Fronts C Street.
   */
  private stJoseph(ring: [number, number][], cx: number, cz: number) {
    const out = this.builder(cx, cz);
    const o = obb(ring);
    const yG = this.hf.height(cx, cz);
    const base = yG - 0.4;
    const white = rgb('#f1efe8');
    const h = 9.5;
    const c = Math.cos(o.ang), s = Math.sin(o.ang);
    const P = (u: number, v: number): [number, number] => [o.cx + u * c - v * s, o.cz + u * s + v * c];
    // Front: the short end nearer C Street.
    const ends = [1, -1].map((e) => {
      const [x, z] = P((e * o.w) / 2 + 8, 0);
      return { e, d: this.roadDist(x, z, 'C Street') };
    });
    const front = ends[0].d <= ends[1].d ? 1 : -1;

    // Nave on its real footprint, lancets in 5 m bays; gable roof at a Gothic pitch.
    this.walls(out, ring, base, yG + h, yG, white, STYLE.CHURCH, 5.0, h);
    this.pitchedRoof(out, o, yG + h, false, rgb('#4d4f52'), STYLE.ROOF_SHINGLE, white, STYLE.STUCCO, yG, 0.4, 48);
    // Buttresses along both flanks.
    for (const side of [-1, 1]) {
      for (let u = -o.w / 2 + 2.5; u < o.w / 2 - 1.5; u += 5) {
        const [x, z] = P(u, side * (o.d / 2 + 0.45));
        out.box(x, z, base, 0.9, 0.9, h * 0.82 + 0.4, o.ang, white, STYLE.STUCCO);
        const [x2, z2] = P(u, side * (o.d / 2 + 0.25));
        out.box(x2, z2, yG + h * 0.82, 0.8, 0.5, 1.2, o.ang, white, STYLE.STUCCO);
        // Pinnacle rising past the eaves.
        const [x3, z3] = P(u, side * (o.d / 2 + 0.1));
        out.box(x3, z3, yG + h - 0.2, 0.55, 0.55, 1.2, o.ang, white, STYLE.STUCCO);
        out.prism(x3, z3, yG + h + 1.0, 0.36, 0, 2.4, 4, white, STYLE.SPIRE, o.ang + Math.PI / 4);
      }
    }
    // Tower centred on the front, projecting from the facade.
    const tw = Math.min(5.4, o.d * 0.38);
    const [tx, tz] = P(front * (o.w / 2 + tw * 0.3), 0);
    const t1 = 14.5;
    out.box(tx, tz, base, tw, tw, t1 - base + yG, o.ang, white, STYLE.STUCCO);
    // Belfry with louvred openings, then the octagonal spire to 100 ft.
    const bw = tw * 0.82;
    const belfry = 4.5;
    out.box(tx, tz, yG + t1, bw, bw, belfry, o.ang, white, STYLE.STUCCO);
    const louvre = rgb('#2e2a26');
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ox = (du * c - dv * s) * (bw / 2 + 0.02), oz = (du * s + dv * c) * (bw / 2 + 0.02);
      out.box(tx + ox, tz + oz, yG + t1 + 1.0, du ? 0.05 : bw * 0.42, du ? bw * 0.42 : 0.05, 2.6, o.ang, louvre, STYLE.RAILING);
    }
    const spireBase = yG + t1 + belfry;
    out.box(tx, tz, spireBase, bw + 0.5, bw + 0.5, 0.5, o.ang, white, STYLE.STUCCO);
    // Corner pinnacles ringing the spire.
    for (const [du, dv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ox = (du * c - dv * s) * (bw / 2), oz = (du * s + dv * c) * (bw / 2);
      out.prism(tx + ox, tz + oz, spireBase + 0.5, 0.42, 0, 3.6, 4, white, STYLE.SPIRE, o.ang + Math.PI / 4);
    }
    const top = yG + 30.5;
    out.prism(tx, tz, spireBase + 0.5, bw * 0.62, 0, top - spireBase - 0.5, 8, rgb('#f6f6f2'), STYLE.SPIRE, o.ang + Math.PI / 8);
    out.box(tx, tz, top - 0.2, 0.12, 0.12, 1.6, o.ang, rgb('#c9a84a'), STYLE.STEEL, true);
    const [ax, az] = [Math.cos(o.ang + Math.PI / 2), Math.sin(o.ang + Math.PI / 2)];
    out.beam([tx - ax * 0.45, top + 0.95, tz - az * 0.45], [tx + ax * 0.45, top + 0.95, tz + az * 0.45], 0.1, 0.1, rgb('#c9a84a'), STYLE.STEEL);
    // Rose window and pointed doorway on the tower front.
    const fx = c * front, fz = s * front;
    const lx = -s * front, lz = c * front;
    const wx = tx + fx * (tw / 2 + 0.03), wz = tz + fz * (tw / 2 + 0.03);
    const R = tw * 0.3;
    const rc = 9.4;
    const seg = 20;
    const p = (a: number): V3 => [wx + lx * Math.cos(a) * R, yG + rc + Math.sin(a) * R, wz + lz * Math.cos(a) * R];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      out.tri([wx, yG + rc, wz], p(a0), p(a1), white, STYLE.ROSE, [0, 0, 0, 0], [Math.cos(a0), Math.sin(a0), 0, 0], [Math.cos(a1), Math.sin(a1), 0, 0], [fx, 0, fz]);
    }
    const door = rgb('#4a3020');
    const dw = 1.1;
    const d0: V3 = [wx - lx * dw, yG, wz - lz * dw];
    const d1: V3 = [wx + lx * dw, yG, wz + lz * dw];
    const d2: V3 = [wx + lx * dw, yG + 3.6, wz + lz * dw];
    const d3: V3 = [wx - lx * dw, yG + 3.6, wz - lz * dw];
    const f0 = [0, 0, 0, 0];
    out.quad(d0, d1, d2, d3, door, STYLE.RAILING, f0, f0, f0, f0, [fx, 0, fz]);
    out.tri(d3, d2, [wx, yG + 4.9, wz], door, STYLE.RAILING, f0, f0, f0, [fx, 0, fz]);
    // Clock on the belfry front: a cream dial with a dark rim and hands.
    const cx0 = tx + fx * (tw / 2 + 0.06), cz0 = tz + fz * (tw / 2 + 0.06);
    const cy = yG + t1 - 1.6;
    const ring2 = (r: number, a: number): V3 => [cx0 + lx * Math.cos(a) * r, cy + Math.sin(a) * r, cz0 + lz * Math.cos(a) * r];
    const dial = rgb('#f3ead2'), rim = rgb('#1f1d1b');
    const n: V3 = [fx, 0, fz];
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2;
      out.quad(ring2(1.05, a0), ring2(1.25, a0), ring2(1.25, a1), ring2(1.05, a1), rim, STYLE.STEEL, f0, f0, f0, f0, n);
      out.tri([cx0, cy, cz0], ring2(1.05, a0), ring2(1.05, a1), dial, STYLE.STUCCO, f0, f0, f0, n);
    }
    const hx = cx0 + fx * 0.05, hz = cz0 + fz * 0.05;
    out.beam([hx, cy, hz], [hx + lx * 0.5, cy + 0.45, hz + lz * 0.5], 0.08, 0.04, rim, STYLE.STEEL);
    out.beam([hx, cy, hz], [hx - lx * 0.15, cy + 0.85, hz - lz * 0.15], 0.06, 0.04, rim, STYLE.STEEL);
    // Floodlights on the steeple.
    for (const e of [-1, 1]) this.lights.push(wx + fx * 4 + lx * e * 3, yG + 0.6, wz + fz * 4 + lz * e * 3, 0.95, 0.95, 1, 0.8, 0);
  }

  /**
   * Bok Kai Temple (1880): one-storey brick, plastered white, under a double
   * gable of clay tile, with a recessed porch of red columns facing the Yuba
   * levee to the south.
   */
  private bokKai(ring: [number, number][], cx: number, cz: number) {
    const out = this.builder(cx, cz);
    const o = obb(ring);
    const yG = this.hf.height(cx, cz);
    const base = yG - 0.4;
    const white = rgb('#efece4');
    const h = 5.2;
    this.walls(out, ring, base, yG + h, yG, white, STYLE.STUCCO, 0, 1);
    const c = Math.cos(o.ang), s = Math.sin(o.ang);
    // Which box axis faces south (+z)? Ridges run front to back.
    const alongIsSouth = Math.abs(s) > Math.abs(c);
    const front = alongIsSouth ? (s > 0 ? 1 : -1) : c > 0 ? 1 : -1;
    const tile = rgb('#9a5a3c');
    if (alongIsSouth) {
      // Long axis runs north-south: two gables side by side across the width.
      for (const side of [-1, 1]) {
        const off = side * o.d / 4;
        this.pitchedRoof(out, { cx: o.cx - s * off, cz: o.cz + c * off, w: o.w, d: o.d / 2, ang: o.ang }, yG + h, false, tile, STYLE.ROOF_TILE, white, STYLE.STUCCO, yG, 0.35, 30);
      }
    } else {
      for (const side of [-1, 1]) {
        const off = side * o.w / 4;
        this.pitchedRoof(out, { cx: o.cx + c * off, cz: o.cz + s * off, w: o.d, d: o.w / 2, ang: o.ang + Math.PI / 2 }, yG + h, false, tile, STYLE.ROOF_TILE, white, STYLE.STUCCO, yG, 0.35, 30);
      }
    }
    // Porch: red columns and lintel along the south face.
    const fu = alongIsSouth ? front : 0, fv = alongIsSouth ? 0 : front;
    const fwx = fu * c - fv * s, fwz = fu * s + fv * c;
    const half = alongIsSouth ? o.w / 2 : o.d / 2;
    const span = alongIsSouth ? o.d : o.w;
    const lx = -fwz, lz = fwx;
    const px = o.cx + fwx * (half + 0.9), pz = o.cz + fwz * (half + 0.9);
    const red = rgb('#a8221c');
    for (let k = 0; k < 4; k++) {
      const t = (k / 3 - 0.5) * span * 0.7;
      out.prism(px + lx * t, pz + lz * t, base, 0.18, 0.18, h - 0.5 - (base - yG), 10, red, STYLE.LACQUER);
    }
    out.beam([px - lx * span * 0.4, yG + h - 0.35, pz - lz * span * 0.4], [px + lx * span * 0.4, yG + h - 0.35, pz + lz * span * 0.4], 0.35, 0.4, red, STYLE.LACQUER);
    out.box(px - fwx * 0.45, pz - fwz * 0.45, yG + h - 0.6, span * 0.85, 1.0, 0.2, Math.atan2(lz, lx), tile, STYLE.ROOF_TILE);
    // Red lanterns at the door.
    for (const e of [-1, 1]) this.lights.push(px + lx * e * 1.4, yG + 3.0, pz + lz * e * 1.4, 1, 0.12, 0.05, 0.6, 0);
  }

  // ------------------------------------------------------------------ bridges

  /**
   * Everywhere else in the valley OSM roads are draped on the terrain, which is
   * carved under the rivers. Find the stretches that run through water: crossings
   * (water on both sides) become bridges, levee-top roads beside it become embankments.
   */
  /**
   * Shade trees in the parkway strips of the residential streets, the old
   * oaks and sycamores that canopy Marysville. Downtown stays bare.
   */
  streetTrees(): PlantedTree[] {
    const out: PlantedTree[] = [];
    const KINDS = new Set(['residential', 'tertiary', 'secondary', 'unclassified', 'living_street']);
    for (const r of this.osm.roads) {
      if (!KINDS.has(r.kind)) continue;
      const half = roadSpec(r).half;
      const p = r.pts;
      let carry = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
        const l = Math.hypot(dx, dz);
        if (l < 1) continue;
        const tx = dx / l, tz = dz / l;
        let s = carry;
        for (; s < l; s += 11) {
          const x0 = ax + tx * s, z0 = az + tz * s;
          if (!this.covers(x0, z0) || this.inCore(x0, z0)) continue;
          for (const side of [-1, 1]) {
            const h = hash(x0 * 0.71 + z0 * 1.37 + side * 5.3);
            if (h < 0.22) continue;
            const off = half + 2.4 + h * 0.6;
            const x = x0 - tz * side * off, z = z0 + tx * side * off;
            // Keep clear of walls and porches, the river and other streets.
            const nx = -tz * side, nz = tx * side;
            if (this.frontage(x, z, nx, nz, 6) < 4.5) continue;
            if (this.frontage(x, z, tx, tz, 3) < 3 || this.frontage(x, z, -tx, -tz, 3) < 3) continue;
            const w = this.water.sample(x, z);
            if (w.mask > 0.3) continue;
            const big = hash(h * 31.7) < 0.6;
            out.push({
              x,
              z,
              r: big ? 4.5 + h * 2.0 : 3.2 + h * 1.4,
              h: big ? 11 + h * 5 : 7.5 + h * 3,
              sp: big ? TREE.VALLEY_OAK : TREE.COTTONWOOD,
            });
          }
        }
        carry = s - l;
      }
    }
    return out;
  }

  private crossings(): TownBridge[] {
    const out: TownBridge[] = [];
    const STEP = 8;
    const under = (x: number, z: number) => {
      const w = this.water.sample(x, z);
      return w.mask > 0.35 && w.level > this.hf.height(x, z) - 0.2;
    };
    for (const r of this.osm.roads) {
      if (r.kind === 'track' || r.kind === 'service' || r.kind === 'path') continue;
      const spec = roadSpec(r);
      const pts: number[] = [];
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / STEP));
        for (let k = 0; k < n; k++) pts.push(p[i] + ((p[i + 2] - p[i]) * k) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * k) / n);
      }
      pts.push(p[p.length - 2], p[p.length - 1]);
      const m = pts.length / 2;
      const wet: boolean[] = [];
      for (let i = 0; i < m; i++) wet.push(under(pts[i * 2], pts[i * 2 + 1]));
      // Runs of wet samples, bridging short dry gaps, padded onto dry land.
      for (let i = 0; i < m; i++) {
        if (!wet[i]) continue;
        let j = i, gap = 0;
        for (let k = i + 1; k < m && gap * STEP < 25; k++) {
          if (wet[k]) {
            j = k;
            gap = 0;
          } else gap++;
        }
        const a = Math.max(0, i - 3), b = Math.min(m - 1, j + 3);
        i = j + 1;
        const mid = Math.floor((a + b) / 2);
        const mx = pts[mid * 2], mz = pts[mid * 2 + 1];
        const dx = pts[Math.min(b, mid + 1) * 2] - pts[Math.max(a, mid - 1) * 2];
        const dz = pts[Math.min(b, mid + 1) * 2 + 1] - pts[Math.max(a, mid - 1) * 2 + 1];
        const dl = Math.hypot(dx, dz) || 1;
        if (this.decks.at(mx, mz, dx / dl, dz / dl) != null) continue;
        // Water on both sides of the road: a crossing. Otherwise the road runs along a bank.
        let across = 0, n = 0;
        for (let k = a; k <= b; k++) {
          if (!wet[k]) continue;
          const kk = Math.min(b, k + 1), kp = Math.max(a, k - 1);
          const ex = pts[kk * 2] - pts[kp * 2], ez = pts[kk * 2 + 1] - pts[kp * 2 + 1];
          const el = Math.hypot(ex, ez) || 1;
          const off = spec.half + 18;
          const x = pts[k * 2], z = pts[k * 2 + 1];
          if (under(x - (ez / el) * off, z + (ex / el) * off) && under(x + (ez / el) * off, z - (ex / el) * off)) across++;
          n++;
        }
        out.push({
          k: 'road',
          n: r.name,
          ref: '',
          loc: '',
          w: spec.half * 2,
          lanes: r.lanes || 2,
          layer: 1,
          boardwalk: 0,
          pts: pts.slice(a * 2, b * 2 + 2),
          levee: across < n * 0.5,
        });
      }
    }
    return out;
  }

  /** Earth embankment under a levee-top road: asphalt crest, grassy slopes down to the ground. */
  private embankment(out: Builder, pts: number[], y: Float32Array, half: number) {
    const m = y.length;
    const earth = rgb('#77704f');
    const asphalt = rgb('#5d5c5a');
    let u = 0;
    for (let i = 0; i < m - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      const ya = y[i], yb = y[i + 1];
      const f = (uu: number) => [uu, 0, 0, 0];
      const e = half + 0.8;
      out.quad([ax - nx * e, ya, az - nz * e], [bx - nx * e, yb, bz - nz * e], [bx + nx * e, yb, bz + nz * e], [ax + nx * e, ya, az + nz * e], asphalt, STYLE.DECK, f(u), f(u + l), f(u + l), f(u), [0, 1, 0]);
      for (const sd of [1, -1]) {
        const ga = this.hf.height(ax + nx * e * sd, az + nz * e * sd) - 1;
        const gb = this.hf.height(bx + nx * e * sd, bz + nz * e * sd) - 1;
        const wa = e + Math.max(1, (ya - ga) * 2), wb = e + Math.max(1, (yb - gb) * 2);
        out.quad(
          [ax + nx * e * sd, ya, az + nz * e * sd],
          [bx + nx * e * sd, yb, bz + nz * e * sd],
          [bx + nx * wb * sd, Math.min(gb, yb - 1), bz + nz * wb * sd],
          [ax + nx * wa * sd, Math.min(ga, ya - 1), az + nz * wa * sd],
          earth,
          STYLE.DECK,
          f(u),
          f(u + l),
          f(u + l),
          f(u),
        );
      }
      u += l;
    }
  }

  private addBridge(br: TownBridge, anywhere = false) {
    const raw = br.pts;
    const pts: number[] = [];
    for (let i = 0; i + 3 < raw.length; i += 2) {
      const dx = raw[i + 2] - raw[i], dz = raw[i + 3] - raw[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 6));
      for (let k = 0; k < n; k++) pts.push(raw[i] + (dx * k) / n, raw[i + 1] + (dz * k) / n);
    }
    pts.push(raw[raw.length - 2], raw[raw.length - 1]);
    const m = pts.length / 2;
    if (m < 2) return;
    const mx = pts[Math.floor(m / 2) * 2], mz = pts[Math.floor(m / 2) * 2 + 1];
    if (!anywhere && !this.covers(mx, mz)) return;
    if (br.k === 'road' && /twin cities/i.test(br.n) && !this.landmark('twincities'))
      this.landmarks.push({ id: 'twincities', name: 'Twin Cities Memorial Bridge', x: mx, z: mz });

    const cum = new Float32Array(m);
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const len = cum[m - 1];
    const ground = new Float32Array(m);
    const wet = new Float32Array(m);
    const req = new Float32Array(m);
    const foot = br.k === 'foot';
    for (let i = 0; i < m; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      ground[i] = this.hf.height(x, z);
      wet[i] = this.water.sample(x, z).mask;
    }
    let wetLen = 0;
    for (let i = 1; i < m; i++) if (wet[i] > 0.3) wetLen += cum[i] - cum[i - 1];
    // River bridges stand at levee height, well clear of the water; small crossings less so.
    const clear = br.levee ? 1.2 : br.boardwalk ? 0.6 : foot ? 3.5 : wetLen > 60 ? (br.k === 'oldrail' ? 8.5 : 10) : Math.min(6.5, 2 + wetLen * 0.08);
    for (let i = 0; i < m; i++) {
      const w = this.water.sample(pts[i * 2], pts[i * 2 + 1]);
      req[i] = Math.max(ground[i] + (br.boardwalk ? 0.4 : 1.0), w.mask > 0.3 ? w.level + clear : -Infinity);
    }
    // Deck: level between the abutments (the levee crests), lifted clear of the water, smoothed.
    const crest = (from: number, dir: number) => {
      let h = ground[from];
      for (let i = from; i >= 0 && i < m && Math.abs(cum[i] - cum[from]) < 60; i += dir) if (wet[i] < 0.3) h = Math.max(h, ground[i]);
      return h;
    };
    const g0 = br.boardwalk ? ground[0] : crest(0, 1), g1 = br.boardwalk ? ground[m - 1] : crest(m - 1, -1);
    let y = new Float32Array(m);
    let top = Math.max(g0, g1);
    for (let i = 0; i < m; i++) top = Math.max(top, req[i]);
    for (let i = 0; i < m; i++) y[i] = br.boardwalk ? Math.max(g0 + (g1 - g0) * (cum[i] / (len || 1)), req[i]) : top;
    const R = Math.max(1, Math.round(30 / 6));
    const filt = (src: Float32Array, op: 'max' | 'avg') => {
      const dst = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        let acc = op === 'max' ? -Infinity : 0, n = 0;
        for (let k = Math.max(0, i - R); k <= Math.min(m - 1, i + R); k++) {
          if (op === 'max') acc = Math.max(acc, src[k]);
          else acc += src[k];
          n++;
        }
        dst[i] = op === 'max' ? acc : acc / n;
      }
      return dst;
    };
    if (!br.boardwalk) y = filt(filt(filt(y, 'max'), 'avg'), 'avg');
    // Ramp down to the road at each end, unless that end stops out over the water.
    for (let i = 0; i < m; i++) {
      const first = cum[i] < len / 2;
      if (wet[first ? 0 : m - 1] > 0.3) continue;
      const e = first ? cum[i] : len - cum[i];
      const end = ground[first ? 0 : m - 1];
      y[i] = end + (y[i] - end) * smoothstep(0, Math.min(45, len / 4), e);
    }

    const half = br.w / 2;
    if (br.k === 'road') this.decks.add({ pts: new Float32Array(pts), y, half });

    const out = this.builder(mx, mz);
    if (br.levee) return this.embankment(out, pts, y, half);
    const name = `${br.n} ${br.loc}`;
    const modern = /twin cities/i.test(name);
    const tenth = /pow\/mia|10th/i.test(name);
    const concrete = rgb(modern ? '#c9c6bd' : '#b3b0a8');
    const steel = rgb(tenth ? '#6f7a72' : br.k === 'rail' ? '#5a4a3e' : '#3c3f42');
    const depth = br.k === 'road' ? (modern ? 2.2 : 1.6) : br.k === 'rail' ? 1.8 : br.k === 'oldrail' ? 1.0 : br.boardwalk ? 0.3 : 0.7;
    const deckCol = br.k === 'oldrail' || foot ? rgb('#8a7d6a') : rgb('#5d5c5a');

    // Deck slab and fascia.
    let u = 0;
    for (let i = 0; i < m - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      const ya = y[i], yb = y[i + 1];
      const L: [V3, V3] = [[ax + nx * half, ya, az + nz * half], [bx + nx * half, yb, bz + nz * half]];
      const Rr: [V3, V3] = [[ax - nx * half, ya, az - nz * half], [bx - nx * half, yb, bz - nz * half]];
      const f = (uu: number, v: number) => [uu, v, 0, 0];
      out.quad(Rr[0], Rr[1], L[1], L[0], br.k === 'rail' ? rgb('#6b6158') : deckCol, br.k === 'rail' ? STYLE.BALLAST : STYLE.DECK, f(u, 0), f(u + l, 0), f(u + l, 0), f(u, 0), [0, 1, 0]);
      const sides = [L, Rr];
      for (const [p0, p1] of sides) {
        const fasciaStyle = br.k === 'rail' || (tenth && br.k === 'road') ? STYLE.STEEL : STYLE.CONCRETE;
        const fc = fasciaStyle === STYLE.STEEL ? steel : concrete;
        out.quad([p0[0], p0[1] - depth, p0[2]], [p1[0], p1[1] - depth, p1[2]], p1, p0, fc, fasciaStyle, f(u, -depth), f(u + l, -depth), f(u + l, 0), f(u, 0));
      }
      out.quad([Rr[0][0], ya - depth, Rr[0][2]], [L[0][0], ya - depth, L[0][2]], [L[1][0], yb - depth, L[1][2]], [Rr[1][0], yb - depth, Rr[1][2]], concrete, STYLE.CONCRETE, f(u, 0), f(u, 0), f(u + l, 0), f(u + l, 0), [0, -1, 0]);

      // Railings: concrete barrier on road bridges, steel rail elsewhere.
      for (const sd of [1, -1]) {
        const ox = nx * (half - 0.2) * sd, oz = nz * (half - 0.2) * sd;
        if (br.k === 'road') {
          out.beam([ax + ox, ya + 0.42, az + oz], [bx + ox, yb + 0.42, bz + oz], 0.4, 0.84, concrete, STYLE.CONCRETE);
          if (modern || tenth) out.beam([ax + ox, ya + 1.1, az + oz], [bx + ox, yb + 1.1, bz + oz], 0.08, 0.08, rgb('#8c9093'), STYLE.RAILING);
        } else if (br.k !== 'rail') {
          out.beam([ax + ox, ya + 1.1, az + oz], [bx + ox, yb + 1.1, bz + oz], 0.07, 0.07, rgb('#4a4c4e'), STYLE.RAILING);
          out.beam([ax + ox, ya + 0.5, az + oz], [bx + ox, yb + 0.5, bz + oz], 0.04, 0.04, rgb('#4a4c4e'), STYLE.RAILING);
          out.beam([ax + ox, ya, az + oz], [ax + ox, ya + 1.1, az + oz], 0.06, 0.06, rgb('#4a4c4e'), STYLE.RAILING);
        }
      }
      if (br.k === 'rail') {
        for (const g of [-0.72, 0.72]) {
          out.beam([ax + nx * g, ya + 0.3, az + nz * g], [bx + nx * g, yb + 0.3, bz + nz * g], 0.08, 0.15, rgb('#4b4540'), STYLE.STEEL);
        }
        out.quad([ax - nx * 1.3, ya + 0.15, az - nz * 1.3], [bx - nx * 1.3, yb + 0.15, bz - nz * 1.3], [bx + nx * 1.3, yb + 0.15, bz + nz * 1.3], [ax + nx * 1.3, ya + 0.15, az + nz * 1.3], rgb('#4a3a2c'), STYLE.BALLAST, [u, 0, 0, 0], [u + l, 0, 0, 0], [u + l, 0, 0, 0], [u, 0, 0, 0], [0, 1, 0]);
      }
      u += l;
    }

    // Truss spans over the main channel of the old Northern Electric bridge.
    let trussFrom = Infinity, trussTo = -Infinity;
    if (br.k === 'oldrail') {
      let a = -1, b = -1;
      for (let i = 0; i < m; i++) if (wet[i] > 0.5) {
        if (a < 0) a = i;
        b = i;
      }
      if (a >= 0) {
        const mid = (cum[a] + cum[b]) / 2;
        const span = 45.7; // two 150 ft pin-connected Pratt through trusses
        trussFrom = mid - span;
        trussTo = mid + span;
        for (const s0 of [trussFrom, mid]) this.pratt(out, pts, cum, y, s0, span, half + 0.3, steel);
      }
    }

    // Piers wherever the deck stands clear of the ground.
    const spacing = br.k === 'road' ? (tenth ? 49 : modern ? 50 : 38) : br.k === 'rail' ? 24 : br.k === 'oldrail' ? 9 : 14;
    for (let s0 = spacing / 2; s0 < len - 4; s0 += spacing) {
      if (s0 > trussFrom + 1 && s0 < trussTo - 1 && Math.abs(s0 - (trussFrom + trussTo) / 2) > 1) continue;
      const p = along(pts, cum, s0);
      const yd = lerpAt(y, cum, s0) - depth;
      const gnd = this.hf.height(p.x, p.z);
      if (yd - gnd < 1.2) continue;
      const nx = -p.dz, nz = p.dx;
      if (br.k === 'road') {
        const cols = half > 6 ? 3 : 2;
        for (let k = 0; k < cols; k++) {
          const t = (k / (cols - 1) - 0.5) * (half * 1.2);
          out.prism(p.x + nx * t, p.z + nz * t, gnd - 2, 0.85, 0.85, yd - gnd + 2, 12, concrete, STYLE.CONCRETE);
        }
        out.box(p.x, p.z, yd - 1.0, 1.6, half * 2 - 0.6, 1.0, Math.atan2(p.dz, p.dx), concrete, STYLE.CONCRETE);
      } else {
        out.box(p.x, p.z, gnd - 2, br.k === 'oldrail' ? 1.0 : 1.4, half * 2 + 0.4, yd - gnd + 2, Math.atan2(p.dz, p.dx), concrete, STYLE.CONCRETE);
      }
    }

    // Street lamps: LED poles on the new bridge, sodium on the 1947 one.
    if (br.k === 'road' && (modern || tenth)) {
      for (let s0 = 15; s0 < len - 10; s0 += modern ? 36 : 42) {
        const p = along(pts, cum, s0);
        const nx = -p.dz, nz = p.dx;
        const yy = lerpAt(y, cum, s0);
        const sd = modern ? 1 : -1;
        const bx = p.x + nx * (half - 0.2) * sd, bz = p.z + nz * (half - 0.2) * sd;
        out.prism(bx, bz, yy, 0.09, 0.07, 9, 6, rgb('#8c9093'), STYLE.STEEL);
        out.beam([bx, yy + 9, bz], [bx - nx * 1.6 * sd, yy + 9, bz - nz * 1.6 * sd], 0.12, 0.12, rgb('#8c9093'), STYLE.STEEL);
        this.lights.push(bx - nx * 1.6 * sd, yy + 8.9, bz - nz * 1.6 * sd, modern ? 0.85 : 1, modern ? 0.88 : 0.5, modern ? 0.92 : 0.14, 1.8, 0);
      }
    }
  }

  /** Pin-connected Pratt through truss: diagonals slope down toward midspan. */
  private pratt(out: Builder, pts: number[], cum: Float32Array, y: Float32Array, s0: number, span: number, half: number, steel: RGB) {
    const panels = 6;
    const H = 7.6;
    const node = (k: number, side: number, top: boolean): V3 => {
      const s = s0 + (k / panels) * span;
      const p = along(pts, cum, s);
      const nx = -p.dz, nz = p.dx;
      const yy = lerpAt(y, cum, s);
      return [p.x + nx * half * side, yy + (top ? H : 0), p.z + nz * half * side];
    };
    for (const side of [-1, 1]) {
      for (let k = 0; k < panels; k++) {
        out.beam(node(k, side, false), node(k + 1, side, false), 0.35, 0.5, steel, STYLE.STEEL);
        if (k >= 1 && k < panels - 1) out.beam(node(k, side, true), node(k + 1, side, true), 0.45, 0.45, steel, STYLE.STEEL);
        if (k >= 1) out.beam(node(k, side, false), node(k, side, true), 0.25, 0.3, steel, STYLE.STEEL);
      }
      // Inclined end posts.
      out.beam(node(0, side, false), node(1, side, true), 0.45, 0.45, steel, STYLE.STEEL);
      out.beam(node(panels, side, false), node(panels - 1, side, true), 0.45, 0.45, steel, STYLE.STEEL);
      for (let k = 1; k < panels - 1; k++) {
        const toMid = k < panels / 2 ? 1 : -1;
        if (k === panels / 2) {
          out.beam(node(k, side, true), node(k - 1, side, false), 0.12, 0.2, steel, STYLE.STEEL);
          out.beam(node(k, side, true), node(k + 1, side, false), 0.12, 0.2, steel, STYLE.STEEL);
        } else out.beam(node(k, side, true), node(k + toMid, side, false), 0.15, 0.22, steel, STYLE.STEEL);
      }
    }
    // Top struts and portal bracing.
    for (let k = 1; k < panels; k++) out.beam(node(k, -1, true), node(k, 1, true), 0.2, 0.25, steel, STYLE.STEEL);
    for (const k of [1, panels - 1]) {
      const a = node(k, -1, true), b = node(k, 1, true);
      out.beam([a[0], a[1] - 1.2, a[2]], [b[0], b[1] - 1.2, b[2]], 0.2, 0.25, steel, STYLE.STEEL);
    }
  }

  update(cam: THREE.Vector3, focus: THREE.Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - c.radius;
      c.mesh.visible = d < 6000;
      if (c.caster) c.caster.visible = Math.hypot(c.center.x - focus.x, c.center.z - focus.z) - c.radius < 700;
    }
  }

  addShadowCasters(shadow: ShadowMap) {
    for (const c of this.chunks) c.caster = shadow.addCaster(c.geo, this.shadowMaterial);
  }

  landmark(id: string) {
    return this.landmarks.find((l) => l.id === id);
  }
}

/** OSM splits long bridges into several ways (at piers, lane changes); chain them back into one deck. */
function joinBridges(list: TownBridge[]): TownBridge[] {
  const out = list.map((b) => ({ ...b, pts: [...b.pts] }));
  const near = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz) < 3;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = 0; j < out.length && !merged; j++) {
        if (i === j || out[i].k !== out[j].k || out[i].boardwalk !== out[j].boardwalk) continue;
        const a = out[i].pts, b = out[j].pts;
        const n = a.length;
        // Only carry straight on: no U-turns onto the opposite carriageway.
        const ahead = (cx: number, cz: number) => {
          const ex = a[n - 2] - a[n - 4], ez = a[n - 1] - a[n - 3];
          const fx = cx - a[n - 2], fz = cz - a[n - 1];
          return (ex * fx + ez * fz) / ((Math.hypot(ex, ez) || 1) * (Math.hypot(fx, fz) || 1)) > 0.7;
        };
        if (near(a[n - 2], a[n - 1], b[0], b[1]) && ahead(b[2], b[3])) {
          out[i].pts = [...a, ...b.slice(2)];
        } else if (near(a[n - 2], a[n - 1], b[b.length - 2], b[b.length - 1]) && ahead(b[b.length - 4], b[b.length - 3])) {
          const r: number[] = [];
          for (let k = b.length - 4; k >= 0; k -= 2) r.push(b[k], b[k + 1]);
          out[i].pts = [...a, ...r];
        } else continue;
        // A named part (e.g. "Twin Cities Memorial Bridge") names the whole.
        if (!out[i].n && out[j].n) out[i].n = out[j].n;
        if (!out[i].loc && out[j].loc) out[i].loc = out[j].loc;
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

function along(pts: number[], cum: Float32Array, s: number) {
  const m = cum.length;
  let i = 0;
  while (i < m - 2 && cum[i + 1] < s) i++;
  const l = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / l));
  const dx = (pts[i * 2 + 2] - pts[i * 2]) / l, dz = (pts[i * 2 + 3] - pts[i * 2 + 1]) / l;
  return { x: pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, z: pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t, dx, dz };
}

function lerpAt(y: Float32Array, cum: Float32Array, s: number) {
  const m = cum.length;
  let i = 0;
  while (i < m - 2 && cum[i + 1] < s) i++;
  const l = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / l));
  return y[i] + (y[i + 1] - y[i]) * t;
}
