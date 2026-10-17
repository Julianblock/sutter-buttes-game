import * as THREE from 'three';
import { G } from '../render/globals';
import type { ShadowMap } from '../render/shadows';
import { animalFragment, animalVertex } from '../render/shaders/animalShader';
import type { Heightfield } from '../world/heightfield';
import { LC } from '../world/meta';

/** Limb ids understood by the animal shader. */
const BODY = 0;
const HEAD = 5;
const TAIL = 6;

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  limb: number;
  pivot: [number, number];
  phase: number;
}

class Builder {
  parts: Part[] = [];

  ellipsoid(c: [number, number, number], r: [number, number, number], color: string, limb = BODY, pivot: [number, number] = [0, 0], phase = 0, seg = 10) {
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3)).scale(r[0], r[1], r[2]).translate(c[0], c[1], c[2]);
    this.parts.push({ geo: g, color: new THREE.Color(color), limb, pivot, phase });
    return this;
  }

  /** Tapered limb segment between two points. */
  limbSeg(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: string, limb: number, pivot: [number, number], phase = 0) {
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    this.parts.push({ geo: g, color: new THREE.Color(color), limb, pivot, phase });
    return this;
  }

  build(): THREE.BufferGeometry {
    let count = 0;
    const geos = this.parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      count += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const limb = new Float32Array(count * 4);
    let o = 0;
    geos.forEach((g, k) => {
      const p = this.parts[k];
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nrm.set(g.attributes.normal.array as Float32Array, o * 3);
      for (let i = 0; i < n; i++) {
        col.set([p.color.r, p.color.g, p.color.b], (o + i) * 3);
        limb.set([p.limb, p.pivot[0], p.pivot[1], p.phase], (o + i) * 4);
      }
      o += n;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aLimb', new THREE.BufferAttribute(limb, 4));
    return out;
  }
}

interface QuadSpec {
  len: number;
  hipY: number;
  bodyR: [number, number];
  legR: number;
  neckLen: number;
  neckUp: number;
  headLen: number;
  headR: number;
  tailLen: number;
  tailR: number;
  tailDown: number;
  coat: string;
  belly: string;
  legs: string;
  face: string;
  tail: string;
  ears?: number;
  rump?: string;
}

/** Generic quadruped: barrel body, four jointed legs, neck and head on a grazing pivot. */
function quadruped(s: QuadSpec): THREE.BufferGeometry {
  const b = new Builder();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const bodyY = s.hipY + s.bodyR[1] * 0.35;
  const half = s.len / 2;
  b.ellipsoid([0, bodyY, 0], [s.bodyR[0], s.bodyR[1], half], s.coat, BODY, [0, 0], 0, 12);
  b.ellipsoid([0, bodyY - s.bodyR[1] * 0.45, 0.05], [s.bodyR[0] * 0.85, s.bodyR[1] * 0.6, half * 0.8], s.belly);
  b.ellipsoid([0, bodyY + 0.02, half * 0.62], [s.bodyR[0] * 1.02, s.bodyR[1] * 1.05, half * 0.42], s.coat);
  if (s.rump) b.ellipsoid([0, bodyY + s.bodyR[1] * 0.1, -half * 0.92], [s.bodyR[0] * 0.7, s.bodyR[1] * 0.7, half * 0.12], s.rump);
  // Legs: hip pivot, slight knee offset, narrowing to the hoof/paw.
  const hipZ = [half * 0.62, half * 0.62, -half * 0.68, -half * 0.68];
  const side = [1, -1, 1, -1];
  const phase = [0, Math.PI, Math.PI, 0];
  for (let i = 0; i < 4; i++) {
    const x = side[i] * s.bodyR[0] * 0.55;
    const z = hipZ[i];
    const knee = V(x, s.hipY * 0.48, z + (i < 2 ? 0.02 : -0.05) * s.len);
    b.limbSeg(V(x, s.hipY + s.bodyR[1] * 0.2, z), knee, s.legR * 1.6, s.legR, s.coat, i + 1, [s.hipY, z], phase[i]);
    b.limbSeg(knee, V(x, 0, z + (i < 2 ? 0.0 : -0.02) * s.len), s.legR, s.legR * 0.7, s.legs, i + 1, [s.hipY, z], phase[i]);
  }
  // Neck and head share the grazing pivot at the withers.
  const nz = half * 0.85;
  const ny = bodyY + s.bodyR[1] * 0.3;
  const top = V(0, ny + s.neckUp, nz + s.neckLen);
  b.limbSeg(V(0, ny - s.bodyR[1] * 0.2, nz - 0.05), top, s.bodyR[0] * 0.55, s.headR * 0.8, s.coat, HEAD, [ny, nz]);
  b.ellipsoid([0, top.y, top.z + s.headLen * 0.35], [s.headR * 0.75, s.headR, s.headLen * 0.6], s.face, HEAD, [ny, nz]);
  b.ellipsoid([0, top.y - s.headR * 0.25, top.z + s.headLen * 0.85], [s.headR * 0.5, s.headR * 0.55, s.headLen * 0.3], s.face, HEAD, [ny, nz], 0, 8);
  if (s.ears) {
    for (const sd of [-1, 1])
      b.ellipsoid([sd * s.headR * 0.9, top.y + s.headR * 0.7, top.z + s.headLen * 0.05], [s.ears * 0.35, s.ears, s.ears * 0.18], s.coat, HEAD, [ny, nz], 0, 6);
  }
  // Tail from the rump.
  const tz = -half * 0.98;
  const ty = bodyY + s.bodyR[1] * 0.35;
  b.limbSeg(V(0, ty, tz), V(0, ty - s.tailDown, tz - s.tailLen), s.tailR, s.tailR * 0.6, s.tail, TAIL, [ty, tz]);
  return b.build();
}

function turkeyGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const bronze = '#2a1e14';
  b.ellipsoid([0, 0.62, 0], [0.22, 0.26, 0.38], bronze, BODY, [0, 0], 0, 10);
  b.ellipsoid([0, 0.66, -0.32], [0.24, 0.22, 0.22], '#3a2a1a');
  // Tail fan, trailing behind and down.
  b.ellipsoid([0, 0.55, -0.48], [0.26, 0.08, 0.22], '#3b2d20', TAIL, [0.6, -0.4]);
  for (let i = 0; i < 2; i++) {
    const x = i === 0 ? 0.08 : -0.08;
    b.limbSeg(V(x, 0.48, 0.02), V(x, 0, 0.05), 0.025, 0.018, '#b3734e', i + 1, [0.48, 0.02], i * Math.PI);
  }
  // Long neck to a small bare blue-red head.
  b.limbSeg(V(0, 0.75, 0.28), V(0, 1.02, 0.38), 0.06, 0.035, '#3a2a1a', HEAD, [0.72, 0.25]);
  b.ellipsoid([0, 1.05, 0.42], [0.05, 0.055, 0.08], '#8a3a3a', HEAD, [0.72, 0.25], 0, 8);
  b.ellipsoid([0, 0.98, 0.43], [0.03, 0.05, 0.03], '#b01e1e', HEAD, [0.72, 0.25], 0, 6);
  return b.build();
}

interface SpeciesDef {
  id: string;
  geo: () => THREE.BufferGeometry;
  cap: number;
  radius: number;
  group: [number, number];
  walk: number;
  run: number;
  stride: number;
  flee: number;
  scale: [number, number];
  tints: string[];
  habitat: (hf: Heightfield, x: number, z: number) => boolean;
}

const slopeOf = (hf: Heightfield, x: number, z: number) => {
  const n = { x: 0, y: 1, z: 0 };
  hf.normal(x, z, n, 4);
  return 1 - n.y;
};

const natural = (lc: number) => lc === LC.GRASS || lc === LC.WOODLAND || lc === LC.HAY || lc === LC.FALLOW || lc === LC.OTHER;

const SPECIES: SpeciesDef[] = [
  {
    id: 'cattle',
    // Black Angus dominate the Buttes ranches, with some Herefords.
    geo: () =>
      quadruped({ len: 2.05, hipY: 0.82, bodyR: [0.36, 0.42], legR: 0.07, neckLen: 0.3, neckUp: 0.05, headLen: 0.48, headR: 0.17, tailLen: 0.75, tailR: 0.035, tailDown: 0.7, coat: '#ffffff', belly: '#f2f2f2', legs: '#e6e6e6', face: '#ffffff', tail: '#e0e0e0', ears: 0.08 }),
    cap: 260,
    radius: 2600,
    group: [8, 22],
    walk: 0.9,
    run: 3,
    stride: 1.6,
    flee: 18,
    scale: [0.92, 1.06],
    tints: ['#121110', '#121110', '#121110', '#17130f', '#4a2316', '#2a1a12'],
    habitat: (hf, x, z) => {
      const lc = hf.landcover(x, z);
      return natural(lc) && hf.canopyDensity(x, z) < 0.35 && slopeOf(hf, x, z) < 0.3;
    },
  },
  {
    id: 'deer',
    // Columbian black-tailed deer.
    geo: () =>
      quadruped({ len: 1.25, hipY: 0.78, bodyR: [0.17, 0.22], legR: 0.03, neckLen: 0.28, neckUp: 0.3, headLen: 0.3, headR: 0.08, tailLen: 0.18, tailR: 0.04, tailDown: 0.1, coat: '#7a6450', belly: '#c9b9a2', legs: '#6b5848', face: '#6e5a48', tail: '#1c1612', ears: 0.11, rump: '#d8cbb6' }),
    cap: 60,
    radius: 1300,
    group: [1, 5],
    walk: 1.1,
    run: 9,
    stride: 1.3,
    flee: 70,
    scale: [0.85, 1.1],
    tints: ['#ffffff', '#f0e8e0', '#e8e8f0'],
    habitat: (hf, x, z) => natural(hf.landcover(x, z)) && hf.canopyDensity(x, z) > 0.08 && slopeOf(hf, x, z) < 0.5,
  },
  {
    id: 'turkey',
    geo: turkeyGeometry,
    cap: 70,
    radius: 900,
    group: [4, 12],
    walk: 0.7,
    run: 4.5,
    stride: 0.45,
    flee: 40,
    scale: [0.9, 1.1],
    tints: ['#ffffff', '#e8e0d8'],
    habitat: (hf, x, z) => natural(hf.landcover(x, z)) && hf.canopyDensity(x, z) > 0.05 && slopeOf(hf, x, z) < 0.4,
  },
  {
    id: 'coyote',
    geo: () =>
      quadruped({ len: 0.95, hipY: 0.42, bodyR: [0.13, 0.16], legR: 0.025, neckLen: 0.16, neckUp: 0.1, headLen: 0.22, headR: 0.075, tailLen: 0.38, tailR: 0.06, tailDown: 0.2, coat: '#8a7a64', belly: '#c8b89c', legs: '#7a6a54', face: '#8f7f68', tail: '#6a5a46', ears: 0.07 }),
    cap: 10,
    radius: 1500,
    group: [1, 2],
    walk: 1.4,
    run: 11,
    stride: 0.9,
    flee: 60,
    scale: [0.9, 1.1],
    tints: ['#ffffff', '#e0d8c8'],
    habitat: (hf, x, z) => {
      const lc = hf.landcover(x, z);
      return (natural(lc) || lc === LC.ROWCROP) && slopeOf(hf, x, z) < 0.45;
    },
  },
];

interface Animal {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  h: number;
  target: number;
  v: number;
  phase: number;
  graze: number;
  state: number; // 0 graze, 1 walk, 2 flee
  timer: number;
  scale: number;
  hx: number; // herd centre
  hz: number;
}

class Population {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  private animals: Animal[] = [];
  private t0: Float32Array;
  private t1: Float32Array;

  constructor(readonly def: SpeciesDef, material: THREE.ShaderMaterial) {
    const base = def.geo();
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
    this.t0 = new Float32Array(def.cap * 4);
    this.t1 = new Float32Array(def.cap * 4);
    const tint = new Float32Array(def.cap * 3);
    const c = new THREE.Color();
    for (let i = 0; i < def.cap; i++) {
      c.set(def.tints[Math.floor(Math.random() * def.tints.length)]);
      // Hereford white faces aren't modelled; vary brightness a touch instead.
      const v = 0.9 + Math.random() * 0.2;
      tint.set([c.r * v, c.g * v, c.b * v], i * 3);
      this.animals.push({ alive: false, x: 0, y: 0, z: 0, h: 0, target: 0, v: 0, phase: Math.random() * 6.28, graze: 1, state: 0, timer: 0, scale: 1, hx: 0, hz: 0 });
    }
    g.setAttribute('aT0', new THREE.InstancedBufferAttribute(this.t0, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT1', new THREE.InstancedBufferAttribute(this.t1, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }

  /** Spawns a group in suitable habitat somewhere in the ring around the camera. */
  private spawnGroup(hf: Heightfield, cx: number, cz: number, startIdx: number) {
    const d = this.def;
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = d.radius * (0.25 + 0.75 * Math.sqrt(Math.random()));
      const gx = cx + Math.cos(a) * r;
      const gz = cz + Math.sin(a) * r;
      if (!d.habitat(hf, gx, gz)) continue;
      const n = d.group[0] + Math.floor(Math.random() * (d.group[1] - d.group[0] + 1));
      const heading = Math.random() * Math.PI * 2;
      let placed = 0;
      for (let i = startIdx; i < this.animals.length && placed < n; i++) {
        const an = this.animals[i];
        if (an.alive) continue;
        const spread = Math.sqrt(n) * d.stride * 3;
        an.x = gx + (Math.random() - 0.5) * spread;
        an.z = gz + (Math.random() - 0.5) * spread;
        if (!d.habitat(hf, an.x, an.z)) continue;
        an.alive = true;
        an.y = hf.height(an.x, an.z);
        an.h = heading + (Math.random() - 0.5) * 1.5;
        an.target = an.h;
        an.state = Math.random() < 0.7 ? 0 : 1;
        an.timer = Math.random() * 10;
        an.graze = an.state === 0 ? 1 : 0;
        an.scale = d.scale[0] + Math.random() * (d.scale[1] - d.scale[0]);
        an.hx = gx;
        an.hz = gz;
        placed++;
      }
      return;
    }
  }

  update(dt: number, hf: Heightfield, cam: THREE.Vector3, bird: THREE.Vector3) {
    const d = this.def;
    const far = d.radius * 1.35;
    let free = -1;
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (a.alive && Math.hypot(a.x - cam.x, a.z - cam.z) > far) a.alive = false;
      if (!a.alive && free < 0) free = i;
    }
    // Top up one group per frame so spawning cost stays flat.
    if (free >= 0) this.spawnGroup(hf, cam.x, cam.z, free);

    let n = 0;
    for (const a of this.animals) {
      if (!a.alive) continue;
      const bx = a.x - bird.x;
      const bz = a.z - bird.z;
      const bd = Math.hypot(bx, bz);
      const close = bd < d.flee && bird.y - a.y < d.flee * 0.8;
      a.timer -= dt;
      if (close) {
        a.state = 2;
        a.target = Math.atan2(bx, bz) + Math.sin(a.phase * 0.1) * 0.3;
        a.timer = 3 + Math.random() * 3;
      } else if (a.timer <= 0) {
        // Alternate grazing and ambling; drift back toward the herd.
        a.state = a.state === 0 ? 1 : 0;
        a.timer = a.state === 0 ? 6 + Math.random() * 20 : 3 + Math.random() * 8;
        const hx = a.hx - a.x;
        const hz = a.hz - a.z;
        const toHerd = Math.atan2(hx, hz);
        a.target = Math.hypot(hx, hz) > d.stride * 10 ? toHerd : a.h + (Math.random() - 0.5) * 2;
      }
      const speed = a.state === 2 ? d.run : a.state === 1 ? d.walk : 0;
      a.v += (speed - a.v) * Math.min(1, dt * (a.state === 2 ? 3 : 1.2));
      let dh = a.target - a.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.h += dh * Math.min(1, dt * (a.state === 2 ? 4 : 1.2));
      const nx = a.x + Math.sin(a.h) * a.v * dt;
      const nz = a.z + Math.cos(a.h) * a.v * dt;
      if (a.v > 0.01) {
        if (d.habitat(hf, nx, nz) || a.state === 2) {
          a.x = nx;
          a.z = nz;
          a.y = hf.height(a.x, a.z);
        } else {
          a.target = a.h + Math.PI * (0.6 + Math.random() * 0.8);
        }
      }
      a.graze += ((a.state === 0 ? 1 : 0) - a.graze) * Math.min(1, dt * 1.5);
      a.phase += (a.v / (d.stride * a.scale)) * Math.PI * dt;
      const gait = a.v < 0.05 ? 0 : a.v <= d.walk * 1.2 ? a.v / d.walk : 1 + Math.min(1, (a.v - d.walk) / (d.run - d.walk));
      this.t0.set([a.x, a.y, a.z, a.h], n * 4);
      this.t1.set([a.scale, a.phase, gait, a.graze], n * 4);
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.attributes.aT0 as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.attributes.aT1 as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  get count() {
    return this.geo.instanceCount;
  }
}

/** Cattle herds, black-tailed deer, wild turkeys and coyotes living around the player. */
export class Wildlife {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly shadowMaterial: THREE.ShaderMaterial;
  readonly pops: Population[];

  constructor(private hf: Heightfield) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: animalVertex,
      fragmentShader: animalFragment,
      uniforms: { ...G },
    });
    this.shadowMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: animalVertex,
      fragmentShader: animalFragment,
      uniforms: this.material.uniforms,
      defines: { SHADOW_PASS: '' },
    });
    this.pops = SPECIES.map((s) => new Population(s, this.material));
    for (const p of this.pops) this.group.add(p.mesh);
  }

  addShadowCasters(shadow: ShadowMap) {
    for (const p of this.pops) shadow.addCaster(p.geo, this.shadowMaterial);
  }

  update(dt: number, cam: THREE.Vector3, bird: THREE.Vector3) {
    dt = Math.min(dt, 0.1);
    for (const p of this.pops) p.update(dt, this.hf, cam, bird);
  }

  counts() {
    return Object.fromEntries(this.pops.map((p) => [p.def.id, p.count]));
  }
}
