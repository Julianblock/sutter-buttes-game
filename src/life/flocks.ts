import * as THREE from 'three';
import { G } from '../render/globals';
import { FLOCK_SPECIES, flockFragment, flockVertex } from '../render/shaders/flockShader';
import type { Heightfield } from '../world/heightfield';
import { LC } from '../world/meta';

const SP = { GOOSE: 0, VULTURE: 1, EGRET: 2, BLACKBIRD: 3 } as const;

/** Wingspan (m) and wingbeat frequency (Hz) per species. */
const INFO = [
  { span: 1.45, hz: 3.0 },
  { span: 1.75, hz: 1.6 },
  { span: 1.35, hz: 2.0 },
  { span: 0.36, hz: 11 },
];

const CAP = 1600;

function birdGeometry() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const span: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], s: number[], w: number, n = [0, 1, 0]) => {
    for (const [v, sv] of [
      [a, s[0]],
      [b, s[1]],
      [c, s[2]],
    ] as [number[], number][]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      span.push(sv);
      wing.push(w);
    }
  };
  // Body: a slim diamond-section spindle with a neck and tail.
  const ring = (z: number, rx: number, ry: number) => [
    [rx, 0, z],
    [0, ry, z],
    [-rx, 0, z],
    [0, -ry * 0.8, z],
  ];
  const rings = [ring(0.42, 0.012, 0.012), ring(0.28, 0.035, 0.035), ring(0.1, 0.07, 0.065), ring(-0.1, 0.06, 0.055), ring(-0.26, 0.03, 0.012)];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < 4; k++) {
      const a = rings[r][k];
      const b = rings[r][(k + 1) % 4];
      const c = rings[r + 1][k];
      const d = rings[r + 1][(k + 1) % 4];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const l = Math.hypot(mx, my) || 1;
      const n = [mx / l, my / l, 0];
      tri(a, c, b, [0, 0, 0], 0, n);
      tri(b, c, d, [0, 0, 0], 0, n);
    }
  }
  // Tail fan.
  tri([0.05, 0, -0.22], [-0.05, 0, -0.22], [0, 0, -0.36], [0.05, -0.05, 0], 0);
  // Wings: four span segments, tapering chord, slight sweep.
  const N = 5;
  for (const side of [1, -1]) {
    for (let k = 0; k < N; k++) {
      const s0 = 0.06 + (k / N) * 0.94;
      const s1 = 0.06 + ((k + 1) / N) * 0.94;
      const edge = (s: number) => {
        const chord = 0.24 * (1 - Math.pow(s, 1.8) * 0.65);
        const sweep = -s * s * 0.06;
        return { x: side * s * 0.5, le: 0.07 + sweep, te: 0.07 + sweep - chord };
      };
      const e0 = edge(s0);
      const e1 = edge(s1);
      const a = [e0.x, 0, e0.le];
      const b = [e0.x, 0, e0.te];
      const c = [e1.x, 0, e1.le];
      const d = [e1.x, 0, e1.te];
      tri(a, b, c, [side * s0, side * s0, side * s1], 1);
      tri(c, b, d, [side * s1, side * s0, side * s1], 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

type Kind = 'vee' | 'swirl' | 'kettle';

interface Flock {
  kind: Kind;
  species: number;
  n: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  t: number;
  seed: number;
  radius: number;
}

function rnd(a: number, b: number) {
  return a + Math.random() * (b - a);
}

/** Snow goose skeins, turkey vulture kettles, egrets and blackbird murmurations. */
export class Flocks {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private aP: Float32Array;
  private aO: Float32Array;
  private aF: Float32Array;
  private flocks: Flock[] = [];
  private month = 1;
  private prev = new Map<number, [number, number, number]>();

  constructor(private hf: Heightfield) {
    const c = (h: string) => new THREE.Color(h);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: flockVertex,
      fragmentShader: flockFragment,
      side: THREE.DoubleSide,
      uniforms: {
        ...G,
        // Snow goose, turkey vulture (silvery flight feathers), great egret, blackbird.
        uBody: { value: [c('#e8e6e0'), c('#1c1612'), c('#efefea'), c('#141414')] },
        uWingC: { value: [c('#ecebe6'), c('#231c17'), c('#f2f2ee'), c('#161616')] },
        uTip: { value: [c('#121212'), c('#6b6862'), c('#f2f2ee'), c('#161616')] },
        uTipStart: { value: [0.72, 0.55, 2.0, 2.0] },
      },
    });
    if (FLOCK_SPECIES !== 4) throw new Error('species mismatch');
    const base = birdGeometry();
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
    this.aP = new Float32Array(CAP * 4);
    this.aO = new Float32Array(CAP * 4);
    this.aF = new Float32Array(CAP * 2);
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(this.aP, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aO', new THREE.InstancedBufferAttribute(this.aO, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aF', new THREE.InstancedBufferAttribute(this.aF, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  setMonth(m: number) {
    if (Math.round(m) === Math.round(this.month)) return;
    this.month = m;
    this.flocks.length = 0;
  }

  /** Desired flock mix for the season and light. */
  private wanted(day: boolean): { kind: Kind; species: number; count: number }[] {
    const m = ((Math.round(this.month) - 1 + 12) % 12) + 1;
    const winter = m >= 11 || m <= 2;
    const shoulder = m === 10 || m === 3;
    const out: { kind: Kind; species: number; count: number }[] = [];
    if (winter || shoulder) {
      out.push({ kind: 'vee', species: SP.GOOSE, count: winter ? 5 : 2 });
      if (day) out.push({ kind: 'swirl', species: SP.GOOSE, count: winter ? 2 : 0 });
      if (winter) out.push({ kind: 'swirl', species: SP.BLACKBIRD, count: 1 });
    }
    if (day) {
      out.push({ kind: 'kettle', species: SP.VULTURE, count: winter ? 1 : 3 });
      out.push({ kind: 'vee', species: SP.EGRET, count: m >= 4 && m <= 10 ? 3 : 1 });
    }
    return out;
  }

  private spawn(kind: Kind, species: number, cam: THREE.Vector3): Flock | null {
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(600, 3200);
      const x = cam.x + Math.cos(a) * r;
      const z = cam.z + Math.sin(a) * r;
      const ground = this.hf.height(x, z);
      const lc = this.hf.landcover(x, z);
      if (kind === 'swirl' && species === SP.GOOSE && lc !== LC.RICE && lc !== LC.WETLAND) continue;
      if (kind === 'kettle' && ground < 40 && Math.random() < 0.7) continue;
      const f: Flock = {
        kind,
        species,
        n: 0,
        x,
        y: 0,
        z,
        heading: Math.random() * Math.PI * 2,
        speed: 0,
        t: Math.random() * 100,
        seed: Math.random() * 1000,
        radius: 0,
      };
      if (kind === 'vee') {
        f.n = species === SP.GOOSE ? Math.floor(rnd(18, 70)) : Math.floor(rnd(3, 9));
        f.y = ground + (species === SP.GOOSE ? rnd(150, 600) : rnd(25, 90));
        f.speed = species === SP.GOOSE ? rnd(15, 19) : rnd(9, 12);
      } else if (kind === 'swirl') {
        f.n = species === SP.GOOSE ? Math.floor(rnd(250, 500)) : Math.floor(rnd(300, 500));
        f.y = ground + rnd(25, 70);
        f.radius = species === SP.GOOSE ? rnd(90, 160) : rnd(35, 60);
        f.speed = species === SP.GOOSE ? 13 : 12;
      } else {
        f.n = Math.floor(rnd(6, 18));
        f.y = ground + rnd(150, 350);
        f.radius = rnd(35, 70);
        f.speed = 11;
      }
      return f;
    }
    return null;
  }

  update(dt: number, cam: THREE.Vector3, wind: { x: number; z: number }) {
    dt = Math.min(dt, 0.1);
    const day = G.uSunDir.value.y > 0.04;
    // Retire far or out-of-season flocks, then top up.
    const want = this.wanted(day);
    this.flocks = this.flocks.filter((f) => {
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      const ok = want.some((w) => w.kind === f.kind && w.species === f.species && w.count > 0);
      return ok && d < 4500;
    });
    for (const w of want) {
      const have = this.flocks.filter((f) => f.kind === w.kind && f.species === w.species).length;
      if (have < w.count) {
        const f = this.spawn(w.kind, w.species, cam);
        if (f) this.flocks.push(f);
      }
    }

    let i = 0;
    const write = (x: number, y: number, z: number, yaw: number, pitch: number, bank: number, sp: number, flapPhase: number, flapAmt: number, scale: number) => {
      if (i >= CAP) return;
      this.aP.set([x, y, z, scale], i * 4);
      this.aO.set([yaw, pitch, bank, sp], i * 4);
      this.aF.set([flapPhase, flapAmt], i * 2);
      i++;
    };

    for (const f of this.flocks) {
      f.t += dt;
      const info = INFO[f.species];
      if (f.kind === 'vee') {
        // Leader flies a gently meandering course; followers hold V slots.
        f.heading += Math.sin(f.t * 0.05 + f.seed) * 0.02 * dt;
        f.x += Math.sin(f.heading) * f.speed * dt + wind.x * dt;
        f.z += Math.cos(f.heading) * f.speed * dt + wind.z * dt;
        const fx = Math.sin(f.heading);
        const fz = Math.cos(f.heading);
        const spacing = info.span * 1.25;
        for (let k = 0; k < f.n; k++) {
          const rank = Math.ceil(k / 2);
          const side = k % 2 === 0 ? 1 : -1;
          // Uneven arms and a little station-keeping wobble, like real skeins.
          const armBias = side > 0 ? 1 : 0.8 + 0.2 * Math.sin(f.seed);
          const back = rank * spacing * 0.9 * armBias + Math.sin(f.t * 0.7 + k * 1.3) * 0.6;
          const lat = rank * spacing * 0.65 * side + Math.sin(f.t * 0.5 + k) * 0.4;
          const x = f.x - fx * back - fz * lat;
          const z = f.z - fz * back + fx * lat;
          const y = f.y + Math.sin(f.t * 0.4 + k * 0.7) * 1.2 - rank * 0.15;
          const phase = f.t * info.hz * Math.PI * 2 + k * 0.9;
          write(x, y, z, f.heading, 0, Math.sin(f.t * 0.3 + k) * 0.05, f.species, phase, 0.85, info.span);
        }
      } else if (f.kind === 'kettle') {
        // Vultures circle a drifting thermal, climbing, then peel off and reset.
        f.x += wind.x * dt * 0.8;
        f.z += wind.z * dt * 0.8;
        f.y += 0.9 * dt;
        if (f.y - this.hf.height(f.x, f.z) > 1100) f.y -= 800;
        for (let k = 0; k < f.n; k++) {
          const r = f.radius * (0.6 + 0.5 * Math.sin(k * 2.1 + f.seed));
          const w = f.speed / r;
          const dir = k % 5 === 0 ? -1 : 1;
          const a = f.t * w * dir + k * 2.4;
          const x = f.x + Math.cos(a) * r;
          const z = f.z + Math.sin(a) * r;
          const y = f.y + k * 9 - f.n * 4 + Math.sin(f.t * 0.2 + k) * 4;
          const yaw = dir > 0 ? Math.atan2(-Math.sin(a), Math.cos(a)) : Math.atan2(Math.sin(a), -Math.cos(a));
          // Teetering glide: vultures rock side to side on a V dihedral.
          const teeter = Math.sin(f.t * 1.3 + k * 1.7) * 0.12;
          write(x, y, z, yaw, -0.03, 0.38 * dir + teeter, f.species, 0, 0, info.span);
        }
      } else {
        // Murmuration / rising goose cloud: birds orbit a breathing, drifting centre.
        f.x += Math.sin(f.t * 0.11 + f.seed) * 4 * dt + wind.x * dt * 0.5;
        f.z += Math.cos(f.t * 0.09 + f.seed) * 4 * dt + wind.z * dt * 0.5;
        const breathe = 0.75 + 0.25 * Math.sin(f.t * 0.35);
        for (let k = 0; k < f.n; k++) {
          const u = (k * 0.618034 + f.seed) % 1;
          const v = (k * 0.414214) % 1;
          const a = f.t * (f.speed / f.radius) * (0.8 + 0.4 * v) + u * Math.PI * 2;
          const r = f.radius * breathe * (0.35 + 0.65 * Math.sqrt(v));
          const tilt = Math.sin(f.t * 0.23 + u * 6) * 0.5;
          const x = f.x + Math.cos(a) * r + Math.sin(f.t * 0.7 + k) * 6;
          const z = f.z + Math.sin(a) * r * (0.6 + 0.4 * Math.cos(f.t * 0.2));
          const y = f.y + Math.sin(a) * r * tilt + Math.sin(f.t * 0.5 + v * 9) * 8;
          const key = f.seed * 10000 + k;
          const p = this.prev.get(key);
          let yaw = 0;
          let pitch = 0;
          if (p) {
            const dx = x - p[0];
            const dy = y - p[1];
            const dz = z - p[2];
            yaw = Math.atan2(dx, dz);
            pitch = Math.atan2(dy, Math.hypot(dx, dz) + 1e-4);
          }
          this.prev.set(key, [x, y, z]);
          const phase = f.t * info.hz * Math.PI * 2 + k * 2.3;
          write(x, y, z, yaw, pitch, Math.sin(a) * 0.4, f.species, phase, 0.9, info.span);
        }
      }
    }
    if (this.prev.size > 6000) this.prev.clear();
    this.geo.instanceCount = i;
    for (const k of ['aP', 'aO', 'aF']) (this.geo.attributes[k] as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  get count() {
    return this.geo.instanceCount;
  }

  /** Distance from p to the nearest flock centre of a species (Infinity if none). */
  nearest(p: THREE.Vector3, species: number) {
    let best = Infinity;
    for (const f of this.flocks) {
      if (f.species !== species) continue;
      best = Math.min(best, Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z) - f.radius);
    }
    return Math.max(0, best);
  }
}
