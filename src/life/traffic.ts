import * as THREE from 'three';
import { G } from '../render/globals';
import { LightPoints } from '../render/lightPoints';
import { propFragment, propVertex } from '../render/shaders/propShader';
import type { Heightfield } from '../world/heightfield';
import type { OsmData } from '../world/meta';
import { merge, withPart } from '../world/props';

/** Free-flow speeds (m/s) and traffic density (vehicles per km) by road class. */
const ROAD: Record<string, { speed: number; density: number; rank: number }> = {
  motorway: { speed: 30, density: 4.5, rank: 6 },
  trunk: { speed: 26, density: 2.2, rank: 5 },
  primary: { speed: 22, density: 1.6, rank: 4 },
  secondary: { speed: 22, density: 0.9, rank: 3 },
  tertiary: { speed: 20, density: 0.4, rank: 2 },
  unclassified: { speed: 15, density: 0.2, rank: 1 },
  residential: { speed: 11, density: 0.12, rank: 0 },
};

/** Paint colours weighted toward what actually drives the valley roads. */
const PAINT = ['#f2f2f0', '#f2f2f0', '#e9e9e6', '#1a1b1d', '#1a1b1d', '#8d9196', '#8d9196', '#b5b8bb', '#5c1a17', '#1f2d4a', '#3b4a3a', '#7a6d5a', '#a8281f', '#c9c2b0'];
const TRAILER = ['#f4f4f2', '#e8e6e0', '#c8ccd0', '#7d2a20', '#2c4a7a'];

interface Edge {
  pts: Float32Array;
  cum: Float32Array;
  len: number;
  a: number;
  b: number;
  name: string;
  kind: string;
  speed: number;
  oneway: number;
  lanes: number;
}

interface Car {
  e: number;
  dir: number;
  s: number;
  seg: number;
  v: number;
  vt: number;
  type: number;
  slot: number;
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  headlight: number;
}

const TYPES = [
  { len: 4.7, lightY: 0.72, lightZ: 0.66 }, // car / SUV
  { len: 5.8, lightY: 0.95, lightZ: 0.74 }, // pickup
  { len: 21.5, lightY: 1.1, lightZ: 1.0 }, // tractor-trailer
];

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}

function wheels(xs: number[], r: number, track: number, width = 0.24) {
  const out: THREE.BufferGeometry[] = [];
  for (const x of xs)
    for (const s of [-1, 1])
      out.push(withPart(new THREE.CylinderGeometry(r, r, width, 12).rotateX(Math.PI / 2).translate(x, r, s * track), 2));
  return out;
}

function taper(g: THREE.BufferGeometry, yAbove: number, fx: number, fz: number, shiftX = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > yAbove) {
      p.setX(i, p.getX(i) * fx + shiftX);
      p.setZ(i, p.getZ(i) * fz);
    }
  }
  g.computeVertexNormals();
  return g;
}

function carGeometry() {
  const cabin = taper(box(2.5, 0.52, 1.62, -0.2, 1.02, 0), 1.3, 0.72, 0.9, -0.15);
  return merge([
    withPart(box(4.7, 0.42, 1.82, 0, 0.32, 0), 0),
    withPart(taper(box(4.6, 0.3, 1.8, 0, 0.72, 0), 0.9, 0.97, 0.98), 0),
    withPart(cabin, 1),
    withPart(box(1.6, 0.05, 1.42, -0.35, 1.53, 0), 0),
    ...wheels([1.45, -1.4], 0.34, 0.8),
  ]);
}

function pickupGeometry() {
  return merge([
    withPart(box(5.8, 0.55, 1.98, 0, 0.45, 0), 0),
    withPart(box(2.1, 0.32, 1.96, 1.75, 1.0, 0), 0),
    withPart(taper(box(1.9, 0.6, 1.8, 0.35, 1.0, 0), 1.3, 0.85, 0.94, -0.05), 1),
    withPart(box(1.5, 0.06, 1.66, 0.3, 1.6, 0), 0),
    // Bed walls.
    withPart(box(2.2, 0.42, 0.08, -1.75, 1.0, 0.95), 0),
    withPart(box(2.2, 0.42, 0.08, -1.75, 1.0, -0.95), 0),
    withPart(box(0.08, 0.42, 1.98, -2.86, 1.0, 0), 0),
    ...wheels([1.85, -1.75], 0.4, 0.86, 0.28),
  ]);
}

function semiGeometry() {
  return merge([
    // Tractor.
    withPart(box(2.4, 1.3, 2.45, 9.4, 0.85, 0), 0),
    withPart(box(2.6, 1.7, 2.45, 7.6, 1.2, 0), 0),
    withPart(box(0.12, 0.9, 2.2, 8.95, 2.0, 0), 1),
    withPart(box(1.8, 0.6, 2.4, 7.4, 2.9, 0), 0),
    // Trailer.
    withPart(box(15.6, 2.75, 2.58, -1.6, 1.25, 0), 0),
    withPart(box(3.6, 0.35, 1.2, 6.2, 0.75, 0), 2),
    ...wheels([9.6, 6.9, 5.6], 0.52, 1.0, 0.32),
    ...wheels([-7.0, -8.3], 0.52, 1.0, 0.5),
  ]);
}

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Vehicles driving the real road graph: Pass Road, CA 99, CA 20 and the farm grid. */
export class Traffic {
  readonly group = new THREE.Group();
  readonly lights: LightPoints;
  readonly material: THREE.ShaderMaterial;
  private edges: Edge[] = [];
  private nodeEdges = new Map<number, number[]>();
  private cars: Car[] = [];
  private geos: THREE.InstancedBufferGeometry[] = [];
  private t0: Float32Array[] = [];
  private buckets = new Map<number, Car[]>();

  constructor(osm: OsmData, private hf: Heightfield, radius = 23000) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: propVertex,
      fragmentShader: propFragment,
      uniforms: { ...G },
    });
    this.buildGraph(osm, radius);
    this.spawn();

    const bases = [carGeometry(), pickupGeometry(), semiGeometry()];
    const counts = [0, 0, 0];
    for (const c of this.cars) c.slot = counts[c.type]++;
    bases.forEach((base, k) => {
      const n = Math.max(1, counts[k]);
      const g = new THREE.InstancedBufferGeometry();
      for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]);
      const t0 = new Float32Array(n * 4);
      const t1 = new Float32Array(n * 4);
      const wall = new Float32Array(n * 4);
      const roof = new Float32Array(n * 4);
      const col = new THREE.Color();
      for (const c of this.cars) {
        if (c.type !== k) continue;
        const i = c.slot;
        const h = hash(i * 7.3 + k);
        // SUVs and minivans are just taller, boxier cars.
        const suv = k === 0 && h < 0.45;
        t1.set([suv ? 1.04 : 0.95 + h * 0.1, suv ? 1.22 : 1, suv ? 1.06 : 1, 5], i * 4);
        col.set(k === 2 ? TRAILER[Math.floor(h * TRAILER.length)] : PAINT[Math.floor(hash(i * 3.1 + k) * PAINT.length)]);
        wall.set([col.r, col.g, col.b, 0], i * 4);
        roof.set([0, 0, 0, h], i * 4);
      }
      const a0 = new THREE.InstancedBufferAttribute(t0, 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aT0', a0);
      g.setAttribute('aT1', new THREE.InstancedBufferAttribute(t1, 4));
      g.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 4));
      g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 4));
      g.instanceCount = counts[k];
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.geos.push(g);
      this.t0.push(t0);
    });

    this.lights = new LightPoints(new Array(this.cars.length * 4 * 8).fill(0), true);
    this.group.add(this.lights.points);
  }

  get count() {
    return this.cars.length;
  }

  /** Nearest vehicle to p: distance and speed. */
  nearest(p: THREE.Vector3) {
    let d = Infinity;
    let v = 0;
    for (const c of this.cars) {
      const dd = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (dd < d) {
        d = dd;
        v = c.v;
      }
    }
    return { d, v };
  }

  private buildGraph(osm: OsmData, radius: number) {
    const nodeId = new Map<string, number>();
    const node = (x: number, z: number) => {
      const k = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      let id = nodeId.get(k);
      if (id === undefined) {
        id = nodeId.size;
        nodeId.set(k, id);
      }
      return id;
    };
    for (const r of osm.roads) {
      const cls = ROAD[r.kind];
      if (!cls || r.pts.length < 4) continue;
      const p = r.pts;
      if (Math.hypot(p[0], p[1]) > radius) continue;
      const n = p.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const len = cum[n - 1];
      if (len < 2) continue;
      let speed = cls.speed;
      if (r.name === 'Pass Road') speed = 16;
      const e: Edge = {
        pts: Float32Array.from(p),
        cum,
        len,
        a: node(p[0], p[1]),
        b: node(p[p.length - 2], p[p.length - 1]),
        name: r.name,
        kind: r.kind,
        speed,
        oneway: r.oneway ?? 0,
        lanes: r.lanes || (r.kind === 'motorway' ? 2 : 1),
      };
      const id = this.edges.length;
      this.edges.push(e);
      for (const nd of [e.a, e.b]) {
        const l = this.nodeEdges.get(nd);
        if (l) l.push(id);
        else this.nodeEdges.set(nd, [id]);
      }
    }
  }

  private spawn() {
    let seed = 1;
    this.edges.forEach((e, id) => {
      const want = (e.len / 1000) * ROAD[e.kind].density * (e.name === 'Pass Road' ? 1.6 : 1);
      let n = Math.floor(want) + (hash(id) < want % 1 ? 1 : 0);
      while (n-- > 0) {
        const h = hash(seed++);
        const dir = e.oneway ? e.oneway : h < 0.5 ? 1 : -1;
        const truckShare = e.kind === 'motorway' || e.kind === 'trunk' ? 0.22 : e.kind === 'residential' ? 0 : 0.05;
        const r = hash(seed++);
        const type = r < truckShare ? 2 : r < truckShare + 0.3 ? 1 : 0;
        const vt = e.speed * (0.88 + hash(seed++) * 0.22) * (type === 2 ? 0.9 : 1);
        this.cars.push({ e: id, dir, s: hash(seed++) * e.len, seg: 0, v: vt, vt, type, slot: 0, x: 0, y: 0, z: 0, hx: 1, hz: 0, headlight: hash(seed++) });
      }
    });
  }

  /** Picks the next edge at a junction, favouring the same road and bigger roads. */
  private next(car: Car, nodeAt: number) {
    const cur = this.edges[car.e];
    const opts = this.nodeEdges.get(nodeAt) ?? [];
    let total = 0;
    const w: number[] = [];
    for (const id of opts) {
      const e = this.edges[id];
      let wt = 0;
      if (id !== car.e) {
        const dirOut = e.a === nodeAt ? 1 : -1;
        if (!e.oneway || e.oneway === dirOut) {
          wt = 0.4 + ROAD[e.kind].rank * 0.5;
          if (e.name && e.name === cur.name) wt *= 8;
          if (e.kind === 'residential' && cur.kind !== 'residential') wt *= 0.15;
        }
      }
      w.push(wt);
      total += wt;
    }
    if (total <= 0) {
      // Dead end: turn around (or respawn one-way traffic at its start).
      if (cur.oneway) {
        car.s = car.dir > 0 ? 0 : cur.len;
      } else {
        car.dir = -car.dir;
        car.s = car.dir > 0 ? 0 : cur.len;
      }
      return;
    }
    let r = Math.random() * total;
    let pick = opts[0];
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r <= 0) {
        pick = opts[i];
        break;
      }
    }
    const e = this.edges[pick];
    car.e = pick;
    car.dir = e.a === nodeAt ? 1 : -1;
    car.s = car.dir > 0 ? 0 : e.len;
    car.seg = car.dir > 0 ? 0 : e.pts.length / 2 - 2;
    car.vt = e.speed * (0.88 + Math.random() * 0.22) * (car.type === 2 ? 0.9 : 1);
  }

  update(dt: number, camPos: THREE.Vector3, night: number) {
    dt = Math.min(dt, 0.1);
    // Simple car following within each edge and direction.
    this.buckets.clear();
    for (const c of this.cars) {
      const k = c.e * 2 + (c.dir > 0 ? 1 : 0);
      const b = this.buckets.get(k);
      if (b) b.push(c);
      else this.buckets.set(k, [c]);
    }
    for (const list of this.buckets.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => (p.s - q.s) * p.dir);
      for (let i = 0; i < list.length - 1; i++) {
        const me = list[i];
        const lead = list[i + 1];
        const gap = Math.abs(lead.s - me.s) - TYPES[lead.type].len;
        const safe = 6 + me.v * 1.6;
        if (gap < safe) me.v = Math.max(0, Math.min(me.v, lead.v * (gap / safe)));
      }
    }

    let li = 0;
    const lp = this.lights;
    for (const c of this.cars) {
      c.v += (c.vt - c.v) * Math.min(1, dt * 0.5);
      let e = this.edges[c.e];
      c.s += c.v * dt * c.dir;
      if (c.s > e.len || c.s < 0) {
        this.next(c, c.s > e.len ? e.b : e.a);
        e = this.edges[c.e];
      }
      // Advance the cached segment index to bracket s.
      const n = e.pts.length / 2;
      let i = Math.min(Math.max(c.seg, 0), n - 2);
      while (i < n - 2 && e.cum[i + 1] < c.s) i++;
      while (i > 0 && e.cum[i] > c.s) i--;
      c.seg = i;
      const x0 = e.pts[i * 2];
      const z0 = e.pts[i * 2 + 1];
      const x1 = e.pts[i * 2 + 2];
      const z1 = e.pts[i * 2 + 3];
      const sl = e.cum[i + 1] - e.cum[i] || 1;
      const f = (c.s - e.cum[i]) / sl;
      const hx = ((x1 - x0) / sl) * c.dir;
      const hz = ((z1 - z0) / sl) * c.dir;
      // Smooth the heading so cars don't snap at polyline vertices.
      c.hx += (hx - c.hx) * Math.min(1, dt * 4);
      c.hz += (hz - c.hz) * Math.min(1, dt * 4);
      const hl = Math.hypot(c.hx, c.hz) || 1;
      const ux = c.hx / hl;
      const uz = c.hz / hl;
      // Keep right: divided highways drive on their own carriageway.
      const lane = e.oneway ? (e.lanes > 1 ? (c.type === 2 || c.headlight > 0.5 ? 1.8 : -1.8) : 0) : 1.9;
      c.x = x0 + (x1 - x0) * f - uz * lane;
      c.z = z0 + (z1 - z0) * f + ux * lane;
      const dx = c.x - camPos.x;
      const dz = c.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 8000 * 8000 || c.y === 0) c.y = this.hf.height(c.x, c.z) + 0.2;
      const ang = Math.atan2(uz, ux);
      this.t0[c.type].set([c.x, c.y, c.z, ang], c.slot * 4);

      if (night > 0.02 && d2 < 15000 * 15000) {
        const t = TYPES[c.type];
        const half = t.len / 2;
        // Headlights are directional: bright toward the viewer, faint from behind.
        const tcx = -dx / Math.sqrt(d2 + 1);
        const tcz = -dz / Math.sqrt(d2 + 1);
        const facing = ux * tcx + uz * tcz;
        const front = 0.7 + 6.0 * Math.pow(Math.max(0, facing), 6);
        const rear = 0.35 + 0.8 * Math.max(0, -facing);
        const led = c.headlight < 0.45;
        const hr = led ? 0.85 : 1;
        const hg = led ? 0.92 : 0.82;
        const hb = led ? 1 : 0.58;
        for (const s of [-1, 1]) {
          const sx = -uz * t.lightZ * s;
          const sz = ux * t.lightZ * s;
          lp.write(li++, c.x + ux * half + sx, c.y + t.lightY, c.z + uz * half + sz, hr * front, hg * front, hb * front, 0.35);
          lp.write(li++, c.x - ux * half + sx, c.y + t.lightY + 0.1, c.z - uz * half + sz, rear, 0.03 * rear, 0.02 * rear, 0.28);
        }
      }
    }
    for (const g of this.geos) (g.attributes.aT0 as THREE.InstancedBufferAttribute).needsUpdate = true;
    lp.commit(li);
  }
}
