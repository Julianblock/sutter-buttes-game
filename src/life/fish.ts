import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { Heightfield } from '../world/heightfield';
import type { Water, WaterKind } from '../world/water';
import { FISH, type FishSpecies } from './fishSpecies';

const MAX = 120;
const NS = FISH.length;
const SPAWN_R = 24;
const DESPAWN_R = 32;

/**
 * Unit fish, nose at +x and tail at x = -1, built for depth = width = 1; the
 * shader scales each species' proportions. aFish: x = along body (0 nose ..
 * 1 tail tip), y = up the flank (-1 belly .. 1 back), z = 0 body / 1 fin / 2 tail notch.
 */
function fishGeometry(): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const fish: number[] = [];
  const idx: number[] = [];
  const RINGS = 20;
  const SEG = 14;
  const BODY = 0.84;
  const profile = (s: number) => {
    const k = Math.pow(s, 0.72);
    let p = Math.pow(Math.max(0, Math.sin(Math.PI * k)), 0.75);
    if (s > 0.55) p = Math.max(p, 0.16 + (1 - s) * 0.3);
    return Math.max(p, s < 0.02 ? 0.12 : 0) * 0.5;
  };
  for (let r = 0; r <= RINGS; r++) {
    const s = r / RINGS;
    const u = s * BODY;
    const p = profile(s);
    const dp = (profile(Math.min(1, s + 0.01)) - profile(Math.max(0, s - 0.01))) / (0.02 * BODY);
    for (let a = 0; a <= SEG; a++) {
      const t = (a / SEG) * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      pos.push(-u, c * p, sn * p);
      const n = new THREE.Vector3(dp, c, sn).normalize();
      nrm.push(n.x, n.y, n.z);
      fish.push(u, c, 0);
    }
  }
  for (let r = 0; r < RINGS; r++)
    for (let a = 0; a < SEG; a++) {
      const i = r * (SEG + 1) + a;
      idx.push(i, i + SEG + 1, i + 1, i + 1, i + SEG + 1, i + SEG + 2);
    }
  const fin = (pts: [number, number, number, number][]) => {
    const base = pos.length / 3;
    for (const [u, y, z, kind] of pts) {
      pos.push(-u, y, z);
      nrm.push(0, 0, 1);
      fish.push(u, y > 0 ? 1 : -1, kind);
    }
    for (let i = 1; i + 1 < pts.length; i++) idx.push(base, base + i, base + i + 1);
  };
  // Tail: two lobes around a notch whose depth follows the species' fork.
  fin([
    [0.83, 0.0, 0, 2],
    [0.82, -0.08, 0, 1],
    [1.0, -0.42, 0, 1],
    [0.97, 0.0, 0, 2],
    [1.0, 0.42, 0, 1],
    [0.82, 0.08, 0, 1],
  ]);
  const top = (u: number) => profile(u / BODY);
  fin([
    [0.3, top(0.3) * 0.92, 0, 1],
    [0.36, top(0.36) + 0.2, 0, 1],
    [0.56, top(0.56) * 0.95, 0, 1],
  ]);
  fin([
    [0.58, -top(0.58) * 0.9, 0, 1],
    [0.64, -top(0.64) - 0.12, 0, 1],
    [0.72, -top(0.72) * 0.9, 0, 1],
  ]);
  for (const side of [1, -1]) {
    fin([
      [0.2, -0.12, side * 0.3, 1],
      [0.34, -0.3, side * 0.42, 1],
      [0.3, -0.2, side * 0.32, 1],
    ]);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFish', new THREE.Float32BufferAttribute(fish, 3));
  g.setIndex(idx);
  return g;
}

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec4 uShape[${NS}];
in vec3 aFish;
in vec4 aI0; // x y z yaw
in vec4 aI1; // pitch length species phase
out vec3 vWorld;
out vec3 vNormal;
out vec3 vFish;
flat out int vSp;

void main() {
  int sp = int(aI1.z + 0.5);
  vec4 sh = uShape[sp];
  float L = aI1.y;
  vec3 p = position;
  vec3 n = normal;
  p.y *= sh.x;
  p.z *= sh.y;
  n = normalize(vec3(n.x, n.y / sh.x, n.z / sh.y));
  if (aFish.z > 1.5) p.x = -mix(0.99, 0.86, sh.z);
  // Swimming: a travelling wave that grows toward the tail.
  float u = aFish.x;
  float w = sin(aI1.w - u * 6.5) * (0.02 + 0.16 * u * u) * sh.w;
  p.z += w;
  float yaw = aI0.w;
  float pitch = aI1.x;
  vec3 X = vec3(cos(yaw) * cos(pitch), sin(pitch), sin(yaw) * cos(pitch));
  vec3 Z = normalize(cross(X, vec3(0.0, 1.0, 0.0)));
  vec3 Y = cross(Z, X);
  // Body origin at mid-length.
  vec3 local = (p + vec3(0.5, 0.0, 0.0)) * L;
  vWorld = aI0.xyz + X * local.x + Y * local.y + Z * local.z;
  vNormal = normalize(X * n.x + Y * n.y + Z * n.z);
  vFish = aFish;
  vSp = sp;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform vec3 uTop[${NS}];
uniform vec3 uSide[${NS}];
uniform vec3 uBelly[${NS}];
uniform vec3 uAccent[${NS}];
uniform vec2 uPattern[${NS}]; // pattern id, accent amount
in vec3 vWorld;
in vec3 vNormal;
in vec3 vFish;
flat in int vSp;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  float u = vFish.x;
  float v = vFish.y;
  bool fin = vFish.z > 0.5;
  vec3 top = uTop[vSp], side = uSide[vSp], belly = uBelly[vSp], acc = uAccent[vSp];
  int pat = int(uPattern[vSp].x + 0.5);
  float accAmt = uPattern[vSp].y;
  // Countershading: dark back, bright flanks, pale belly.
  vec3 alb = mix(belly, side, smoothstep(-0.6, -0.05, v));
  alb = mix(alb, top, smoothstep(0.3, 0.85, v));
  vec2 g = vec2(u * 34.0, v * 7.0);
  if (pat == 1) {
    // Black spots on the back and tail.
    vec2 c = floor(g);
    vec2 o = hash22(c) * 0.6 + 0.2;
    float d = length(fract(g) - o);
    float sp = smoothstep(0.22, 0.12, d) * step(0.55, hash12(c + 3.0)) * (smoothstep(0.0, 0.4, v) + step(0.8, u));
    alb = mix(alb, top * 0.25, sp);
  } else if (pat == 2) {
    // Seven or eight dark lines along the flank.
    float s = abs(fract(v * 3.6 + 0.5) - 0.5);
    alb = mix(alb, top * 0.35, smoothstep(0.12, 0.05, s) * step(-0.55, v) * step(u, 0.82) * step(0.12, u));
  } else if (pat == 3) {
    float s = abs(fract(u * 8.0) - 0.5);
    alb = mix(alb, acc * 0.8 + top * 0.2, smoothstep(0.16, 0.06, s) * smoothstep(-0.6, -0.1, v) * step(u, 0.8) * 0.75);
  } else if (pat == 4) {
    // Blotchy dark stripe along the lateral line.
    float band = smoothstep(0.32, 0.08, abs(v - 0.05 + (vnoise(vec2(u * 18.0, 0.0)) - 0.5) * 0.25));
    alb = mix(alb, top * 0.45, band * step(0.08, u) * step(u, 0.84));
  } else if (pat == 5) {
    // Rows of pale bony scutes.
    float row = min(min(abs(v - 0.85), abs(v + 0.05)), abs(v + 0.7));
    float s = length(vec2(fract(u * 26.0) - 0.5, row * 4.0));
    alb = mix(alb, acc, smoothstep(0.32, 0.15, s) * step(u, 0.82));
  } else if (pat == 6) {
    // Large scales outlined in darker bronze.
    vec2 q = vec2(u * 30.0 + v * 0.5, v * 6.0 + floor(u * 30.0) * 0.5);
    float s = length(fract(q) - 0.5);
    alb *= mix(1.0, 0.72, smoothstep(0.38, 0.5, s) * step(u, 0.84));
  }
  // Accent: rainbow band, orange breast or spawning blush.
  float accMask = pat == 3 ? smoothstep(-0.2, -0.7, v) * step(u, 0.55) : smoothstep(0.35, 0.0, abs(v + 0.05));
  if (pat == 0 || pat == 6) accMask = smoothstep(0.1, -0.5, v) * 0.6;
  if (pat != 3) alb = mix(alb, acc, accMask * accAmt);
  else alb = mix(alb, acc, accMask * accAmt);
  // Eye.
  float eye = length(vec2((u - 0.055) * 9.0, v - 0.3));
  alb = mix(alb, vec3(0.02), smoothstep(0.3, 0.18, eye) * step(u, 0.1));
  if (fin) alb = mix(side, top, 0.55) * 0.8;

  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 col = shadeSurface(alb * 0.8, n, vWorld, 1.0, fin ? 0.7 : 0.32, 1.0);
  // Guanine-silver flanks flash when they catch the light.
  vec3 V = normalize(uCamPos - vWorld);
  float flash = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 12.0) * step(-0.6, v) * (fin ? 0.0 : 1.0);
  col += sunRadiance(vWorld.y) * flash * 0.04 * max(uSunDir.y, 0.0);
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

interface Agent {
  sp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  len: number;
  speed: number;
  phase: number;
  goalYaw: number;
  goalY: number;
  wander: number;
  leader: Agent | null;
  fright: number;
}

/** Freshwater fish around an underwater (or water-skimming) camera. */
export class Fish {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private i0: THREE.InstancedBufferAttribute;
  private i1: THREE.InstancedBufferAttribute;
  private agents: Agent[] = [];
  private month = 6;
  private material: THREE.ShaderMaterial;
  /** Called when a species swims close in front of the camera. */
  onSpot?: (s: FishSpecies) => void;

  constructor(private water: Water, private hf: Heightfield) {
    this.geo = fishGeometry();
    this.i0 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.i1 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.i0.setUsage(THREE.DynamicDrawUsage);
    this.i1.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aI0', this.i0);
    this.geo.setAttribute('aI1', this.i1);
    this.geo.instanceCount = 0;
    const col = (k: 'top' | 'side' | 'belly' | 'accent') => FISH.map((f) => new THREE.Color(f[k]));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        ...G,
        uShape: { value: FISH.map((f) => new THREE.Vector4(f.depth, f.width, f.fork, f.bottom ? 0.6 : 1)) },
        uTop: { value: col('top') },
        uSide: { value: col('side') },
        uBelly: { value: col('belly') },
        uAccent: { value: col('accent') },
        uPattern: { value: FISH.map((f) => new THREE.Vector2(f.pattern, f.accentAmt)) },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fish';
  }

  setMonth(m: number) {
    this.month = m;
    // Autumn salmon on their spawning run darken to olive and blush maroon.
    const k = FISH.findIndex((f) => f.id === 'chinook');
    const spawn = m >= 10 && m <= 12 ? 0.55 : m === 9 ? 0.25 : 0;
    (this.material.uniforms.uPattern.value as THREE.Vector2[])[k].y = spawn;
  }

  get count() {
    return this.agents.length;
  }

  private pick(kind: WaterKind): number {
    let total = 0;
    const w = FISH.map((f) => {
      const h = f.habitat[kind] ?? 0;
      const ok = !f.months || f.months.includes(this.month);
      const v = ok ? h : 0;
      total += v;
      return v;
    });
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
    return 0;
  }

  private spawnAt(x: number, z: number, cam: THREE.Vector3): boolean {
    const s = this.water.sample(x, z);
    if (s.mask < 0.6 || s.depth < 0.7) return false;
    const body = this.water.bodyAt(x, z);
    const sp = this.pick(body?.kind ?? 'pond');
    const f = FISH[sp];
    const n = f.school ? f.school[0] + Math.floor(Math.random() * (f.school[1] - f.school[0] + 1)) : 1;
    let leader: Agent | null = null;
    const yaw = Math.random() * Math.PI * 2;
    // Big fish only where the water is deep enough for them.
    if (f.len[0] > s.depth * 1.2) return false;
    for (let i = 0; i < n && this.agents.length < MAX; i++) {
      const ax = x + (Math.random() - 0.5) * 2.5;
      const az = z + (Math.random() - 0.5) * 2.5;
      const as = this.water.sample(ax, az);
      if (as.depth < 0.5) continue;
      const bed = as.level - as.depth;
      const len = f.len[0] + Math.random() * (f.len[1] - f.len[0]);
      const y = f.bottom ? bed + 0.2 + len * 0.12 : bed + 0.35 + Math.random() * Math.max(0.1, as.depth - 0.7);
      const a: Agent = {
        sp,
        x: ax,
        y,
        z: az,
        yaw: yaw + (Math.random() - 0.5) * 0.4,
        pitch: 0,
        len,
        speed: f.speed * len,
        phase: Math.random() * 10,
        goalYaw: yaw,
        goalY: y,
        wander: Math.random() * 3,
        leader,
        fright: 0,
      };
      if (!leader) leader = a;
      this.agents.push(a);
    }
    void cam;
    return true;
  }

  /** `active` when the camera is in or just over the water; `actor` is the bird or truck. */
  update(dt: number, cam: THREE.Camera, active: boolean, actor: THREE.Vector3) {
    const cp = cam.position;
    this.agents = this.agents.filter((a) => Math.hypot(a.x - cp.x, a.z - cp.z) < DESPAWN_R && active);
    if (active) {
      const want = 70;
      const first = this.agents.length === 0;
      for (let t = 0; t < (first ? 120 : 6) && this.agents.length < want; t++) {
        const ang = Math.random() * Math.PI * 2;
        const r = first ? 3 + Math.random() * (SPAWN_R - 3) : SPAWN_R * (0.7 + Math.random() * 0.3);
        this.spawnAt(cp.x + Math.cos(ang) * r, cp.z + Math.sin(ang) * r, cp);
      }
    }
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const a0 = this.i0.array as Float32Array;
    const a1 = this.i1.array as Float32Array;
    let k = 0;
    for (const a of this.agents) {
      const f = FISH[a.sp];
      a.wander -= dt;
      if (a.leader && this.agents.includes(a.leader)) {
        a.goalYaw = a.leader.yaw;
        a.goalY = a.leader.y + (a.phase % 1 - 0.5) * 0.5;
      } else if (a.wander <= 0) {
        a.wander = 2 + Math.random() * 4;
        a.goalYaw = a.yaw + (Math.random() - 0.5) * 2.2;
        const s = this.water.sample(a.x, a.z);
        const bed = s.level - s.depth;
        a.goalY = f.bottom ? bed + 0.2 + a.len * 0.12 : bed + 0.35 + Math.random() * Math.max(0.1, s.depth - 0.7);
      }
      // Bolt from the bird or truck.
      const dx = a.x - actor.x, dy = a.y - actor.y, dz = a.z - actor.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 3.5 + a.len * 2) {
        a.fright = 1.2;
        a.goalYaw = Math.atan2(dz, dx) + (Math.random() - 0.5) * 0.5;
      }
      a.fright = Math.max(0, a.fright - dt);
      // Turn back from banks and shallows.
      const look = 1 + a.len * 2;
      const ahead = this.water.sample(a.x + Math.cos(a.yaw) * look, a.z + Math.sin(a.yaw) * look);
      if (ahead.depth < 0.45 || ahead.mask < 0.5) a.goalYaw = a.yaw + Math.PI * 0.8;
      let dyaw = a.goalYaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      a.yaw += THREE.MathUtils.clamp(dyaw, -2.5 * dt, 2.5 * dt) * (a.fright > 0 ? 2.5 : 1);
      const cruise = f.speed * a.len * (a.fright > 0 ? 4 : 1);
      a.speed += (cruise - a.speed) * Math.min(1, dt * 2);
      const vy = THREE.MathUtils.clamp((a.goalY - a.y) * 0.6, -0.4, 0.4);
      a.pitch += (Math.atan2(vy, Math.max(a.speed, 0.05)) * 0.7 - a.pitch) * Math.min(1, dt * 3);
      a.x += Math.cos(a.yaw) * a.speed * dt;
      a.z += Math.sin(a.yaw) * a.speed * dt;
      a.y += vy * dt;
      const s = this.water.sample(a.x, a.z);
      const bed = this.hf.height(a.x, a.z);
      a.y = THREE.MathUtils.clamp(a.y, bed + 0.12, Math.max(bed + 0.12, s.level - 0.12));
      a.phase += dt * (2 + (a.speed / a.len) * 5);
      if (k >= MAX) continue;
      a0[k * 4] = a.x;
      a0[k * 4 + 1] = a.y;
      a0[k * 4 + 2] = a.z;
      a0[k * 4 + 3] = a.yaw;
      a1[k * 4] = a.pitch;
      a1[k * 4 + 1] = a.len;
      a1[k * 4 + 2] = a.sp;
      a1[k * 4 + 3] = a.phase;
      k++;
      if (this.onSpot) {
        const ex = a.x - cp.x, ey = a.y - cp.y, ez = a.z - cp.z;
        const dist = Math.hypot(ex, ey, ez);
        if (dist < 4 + a.len * 4 && (ex * fwd.x + ey * fwd.y + ez * fwd.z) / dist > 0.75) this.onSpot(f);
      }
    }
    this.geo.instanceCount = k;
    this.i0.needsUpdate = true;
    this.i1.needsUpdate = true;
  }
}
