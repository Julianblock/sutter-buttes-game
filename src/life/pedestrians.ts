import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { ShadowMap } from '../render/shadows';
import type { Heightfield } from '../world/heightfield';
import type { OsmData } from '../world/meta';
import type { RoadIndex } from '../world/roadIndex';
import { roadSpec } from '../world/roads';
import type { Town } from '../world/town';

// Body parts: limb (0 body, 1/2 legs, 3/4 arms), colour slot, variant, pivot height.
const LIMB = { BODY: 0, LEG_L: 1, LEG_R: 2, ARM_L: 3, ARM_R: 4 };
const SLOT = { SKIN: 0, TOP: 1, BOTTOM: 2, SHOES: 3, HAIR: 4, LEGS: 5 };
const VAR = { ALWAYS: 0, DRESS: 1, LONG_HAIR: 2 };

function personGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, limb: number, slot: number, variant: number, pivot: number, taper = 0) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.attributes.position.array as Float32Array;
    if (taper) {
      // Flare the bottom (skirts and dresses).
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 1] < (y0 + y1) / 2) {
          p[i] = (x0 + x1) / 2 + (p[i] - (x0 + x1) / 2) * (1 + taper);
          p[i + 2] = (z0 + z1) / 2 + (p[i + 2] - (z0 + z1) / 2) * (1 + taper);
        }
      }
      g.computeVertexNormals();
    }
    pos.push(...p);
    nrm.push(...(g.attributes.normal.array as Float32Array));
    for (let i = 0; i < p.length / 3; i++) part.push(limb, slot, variant, pivot);
  };
  const HIP = 0.9, SH = 1.42;
  for (const [s, limb] of [[-1, LIMB.LEG_L], [1, LIMB.LEG_R]] as const) {
    box(s * 0.16, 0.08, -0.07, s * 0.03, HIP, 0.07, limb, SLOT.LEGS, VAR.ALWAYS, HIP);
    box(s * 0.165, 0.0, -0.08, s * 0.025, 0.09, 0.15, limb, SLOT.SHOES, VAR.ALWAYS, HIP);
  }
  box(-0.17, 0.82, -0.1, 0.17, 1.02, 0.1, LIMB.BODY, SLOT.BOTTOM, VAR.ALWAYS, 0);
  box(-0.19, 1.0, -0.11, 0.19, 1.46, 0.11, LIMB.BODY, SLOT.TOP, VAR.ALWAYS, 0);
  box(-0.18, 0.5, -0.12, 0.18, 1.02, 0.12, LIMB.BODY, SLOT.BOTTOM, VAR.DRESS, 0, 0.35);
  for (const [s, limb] of [[-1, LIMB.ARM_L], [1, LIMB.ARM_R]] as const) {
    box(s * 0.28, 1.0, -0.05, s * 0.19, SH + 0.03, 0.05, limb, SLOT.TOP, VAR.ALWAYS, SH);
    box(s * 0.275, 0.8, -0.045, s * 0.195, 1.0, 0.045, limb, SLOT.SKIN, VAR.ALWAYS, SH);
  }
  box(-0.05, 1.45, -0.05, 0.05, 1.53, 0.05, LIMB.BODY, SLOT.SKIN, VAR.ALWAYS, 0);
  box(-0.095, 1.52, -0.1, 0.095, 1.76, 0.11, LIMB.BODY, SLOT.SKIN, VAR.ALWAYS, 0);
  box(-0.105, 1.66, -0.12, 0.105, 1.79, 0.09, LIMB.BODY, SLOT.HAIR, VAR.ALWAYS, 0);
  box(-0.11, 1.28, -0.14, 0.11, 1.72, -0.06, LIMB.BODY, SLOT.HAIR, VAR.LONG_HAIR, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 4));
  return g;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
in vec4 aPart;   // limb, colour slot, variant, pivot y
in vec4 iPos;    // x, y, z, heading
in vec4 iAnim;   // phase, stride rate, height scale, walking 0/1
in vec4 iSkin;   // rgb, dress
in vec4 iTop;    // rgb, long hair
in vec4 iBottom; // rgb, bare legs
in vec4 iHair;   // rgb, shoe shade
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
flat out vec3 vAlbedo;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float limb = aPart.x;
  float variant = aPart.z;
  float show = variant < 0.5 ? 1.0 : variant < 1.5 ? iSkin.w : iTop.w;
  // Pants-only hips vanish under a dress; hidden parts collapse to nothing.
  p *= show;
  float ph = iAnim.x + uTime * iAnim.y;
  float walk = iAnim.w;
  float swing = 0.0;
  if (limb > 0.5 && limb < 2.5) swing = sin(ph + (limb > 1.5 ? 3.1416 : 0.0)) * 0.42 * walk;
  else if (limb > 2.5) swing = sin(ph + (limb > 3.5 ? 0.0 : 3.1416)) * 0.35 * walk + (1.0 - walk) * 0.06 * sin(uTime * 1.3 + iAnim.x * 5.0 + limb);
  if (abs(swing) > 0.0) {
    float c = cos(swing), s = sin(swing);
    vec2 yz = vec2(p.y - aPart.w, p.z);
    p.yz = vec2(yz.x * c - yz.y * s, yz.x * s + yz.y * c) + vec2(aPart.w, 0.0);
    n.yz = vec2(n.y * c - n.z * s, n.y * s + n.z * c);
  }
  // Bob while walking, shift weight while standing.
  p.y += walk * abs(sin(ph)) * 0.035;
  p.x += (1.0 - walk) * sin(uTime * 0.7 + iAnim.x * 3.0) * 0.02 * p.y;
  p *= iAnim.z;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  p.xz = vec2(p.x * ch + p.z * sh, -p.x * sh + p.z * ch);
  n.xz = vec2(n.x * ch + n.z * sh, -n.x * sh + n.z * ch);
  vec3 world = iPos.xyz + p;
  vWorld = world;
  vNormal = n;
  float slot = aPart.y;
  vec3 c = slot < 0.5 ? iSkin.rgb : slot < 1.5 ? iTop.rgb : slot < 2.5 ? iBottom.rgb : slot < 3.5 ? vec3(iHair.w) : slot < 4.5 ? iHair.rgb : mix(iBottom.rgb, iSkin.rgb * 0.92, max(iSkin.w, iBottom.w));
  vAlbedo = c;
#ifdef SHADOW_PASS
  vShadowZ = (uShadowMatrix * vec4(world, 1.0)).z;
#else
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
flat in vec3 vAlbedo;
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
  outColor = vec4(vShadowZ, 0.0, 0.0, 1.0);
  return;
#endif
  vec3 n = normalize(vNormal);
  vec3 albedo = vAlbedo * 0.55;
  float shadow = shadowAt(vWorld + n * 0.1, 0.0012);
  vec3 col = shadeSurface(albedo, n, vWorld, 1.0, 0.75, shadow);
  // Shopfronts, neon and streetlights keep a night crowd readable.
  col += albedo * vec3(1.0, 0.78, 0.55) * 0.32 * uNight * uInvExposure * (0.6 + 0.4 * max(n.y, 0.0));
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

const SKIN = ['#f5dcc9', '#f1d3bd', '#e0b394', '#d9a583', '#c68e67', '#a26a45', '#8a5a3a', '#7a4a2e', '#5a3522', '#3f2618'];
const HAIR = ['#0f0c0a', '#1c1410', '#2e1f16', '#4a3020', '#6b4a2b', '#a87a45', '#d9b76a', '#e8d6a0', '#7a2a1a', '#9a9590', '#d6427a', '#3a55c9'];
const HAIR_W = [16, 14, 12, 9, 7, 5, 6, 3, 3, 2, 1, 1];
const TOP = ['#111111', '#141414', '#f2f2f2', '#e9e4da', '#b3122e', '#8a0f22', '#1d3b72', '#e6c84a', '#2f6b4f', '#c9a0dc', '#ff6f61', '#555a60', '#8a5a3c', '#d4af37', '#f06aa5', '#3fb6c9', '#6b2d5c', '#c2c4c8'];
const BOTTOM = ['#2f4a6b', '#1e2a3a', '#3a5a80', '#141414', '#1a1a1a', '#a8946a', '#e8e4dc', '#5a5a5e', '#3a2a22', '#8a1020'];
const DRESS = ['#111111', '#b3122e', '#e6c84a', '#f2f2f2', '#1d3b72', '#d4af37', '#f06aa5', '#2f6b4f', '#c9a0dc', '#ff6f61', '#6b2d5c', '#c2c4c8', '#e2b4a8'];

const col = new THREE.Color();
function lin(hex: string): [number, number, number] {
  col.set(hex);
  return [col.r, col.g, col.b];
}
function weighted(list: string[], w: number[], r: number) {
  const tot = w.reduce((a, b) => a + b, 0);
  let t = r * tot;
  for (let i = 0; i < list.length; i++) {
    t -= w[i];
    if (t <= 0) return list[i];
  }
  return list[list.length - 1];
}

interface Path {
  pts: Float32Array;
  y: Float32Array;
  cum: Float32Array;
  len: number;
  /** Share of the crowd per metre: high on the downtown blocks, thin on the residential walks. */
  weight: number;
}

interface Walker {
  path: number;
  s: number;
  dir: number;
  v: number;
  lateral: number;
  wait: number;
  rank: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Standing in a group: fixed spot and facing. */
  standing: boolean;
  phase: number;
}

/**
 * Downtown Marysville's evening crowd: people walking the sidewalks of the old
 * grid and the Ellis Lake path, and groups gathered outside the bars,
 * restaurants and the State Theatre. Busiest after dark.
 */
export class Pedestrians {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private paths: Path[] = [];
  private walkers: Walker[] = [];
  private iPos: THREE.InstancedBufferAttribute;
  private iAnim: THREE.InstancedBufferAttribute;
  private cx: number;
  private cz: number;
  private shadowMaterial: THREE.ShaderMaterial;
  private caster?: THREE.Mesh;
  /** Fraction of the crowd out right now, 0..1. */
  activity = 1;
  visibleCount = 0;

  constructor(town: Town, osm: OsmData, private roads: RoadIndex, private hf: Heightfield, max = 2800) {
    let sx = 0, sz = 0;
    for (const [x, z] of town.core) {
      sx += x;
      sz += z;
    }
    this.cx = sx / town.core.length;
    this.cz = sz / town.core.length;
    this.buildPaths(town, osm);

    const base = personGeometry();
    this.geo = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(base.attributes)) this.geo.setAttribute(k, base.attributes[k]);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const skin = new Float32Array(max * 4);
    const top = new Float32Array(max * 4);
    const bottom = new Float32Array(max * 4);
    const hair = new Float32Array(max * 4);
    const anim = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) {
      const dress = rnd() < 0.42;
      const long = rnd() < (dress ? 0.85 : 0.35);
      skin.set([...lin(SKIN[Math.floor(rnd() * SKIN.length)]), dress ? 1 : 0], i * 4);
      top.set([...lin(dress ? DRESS[Math.floor(rnd() * DRESS.length)] : TOP[Math.floor(rnd() * TOP.length)]), long ? 1 : 0], i * 4);
      const bare = !dress && rnd() < 0.15;
      bottom.set([...lin(dress ? DRESS[Math.floor(rnd() * DRESS.length)] : BOTTOM[Math.floor(rnd() * BOTTOM.length)]), bare ? 1 : 0], i * 4);
      if (dress) bottom.set(top.slice(i * 4, i * 4 + 3), i * 4);
      hair.set([...lin(weighted(HAIR, HAIR_W, rnd())), rnd() < 0.5 ? 0.02 : rnd() < 0.5 ? 0.6 : 0.12], i * 4);
      anim.set([rnd() * 6.28, 0, (dress ? 0.93 : 1.0) * (0.92 + rnd() * 0.14), 1], i * 4);
    }
    this.geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 4));
    this.geo.setAttribute('iTop', new THREE.InstancedBufferAttribute(top, 4));
    this.geo.setAttribute('iBottom', new THREE.InstancedBufferAttribute(bottom, 4));
    this.geo.setAttribute('iHair', new THREE.InstancedBufferAttribute(hair, 4));
    this.iAnim = new THREE.InstancedBufferAttribute(anim, 4);
    this.iAnim.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iAnim', this.iAnim);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(this.cx, 20, this.cz), 1500);

    const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment, uniforms: { ...G } });
    this.shadowMaterial = material.clone();
    this.shadowMaterial.uniforms = material.uniforms;
    this.shadowMaterial.defines = { SHADOW_PASS: '' };
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;

    // Groups outside the bars, restaurants, the theatre and the hotel.
    const hubs: { x: number; z: number }[] = [];
    for (const s of town.data.spots) if (Math.hypot(s.x - this.cx, s.z - this.cz) < 900) hubs.push(s);
    for (const id of ['state', 'hotel', 'stjoseph', 'bokkai']) {
      const l = town.landmark(id);
      if (l) hubs.push(l);
    }
    // People are ordered by how late they stay out: the first `activity` share is on the street.
    for (let i = 0; i < max; i++) {
      const w: Walker = { path: 0, s: 0, dir: 1, v: 0, lateral: 0, wait: 0, rank: i / max, x: 0, y: 0, z: 0, heading: 0, standing: false, phase: anim[i * 4] };
      if (rnd() < 0.24 && hubs.length) {
        const h = hubs[Math.floor(rnd() * hubs.length)];
        const near = this.nearestOnPaths(h.x, h.z);
        if (near) {
          const a = rnd() * Math.PI * 2;
          const r = 0.6 + rnd() * 1.4;
          w.standing = true;
          w.x = near.x + Math.cos(a) * r;
          w.z = near.z + Math.sin(a) * r;
          w.y = this.hf.height(w.x, w.z);
          // Face the middle of the group.
          w.heading = Math.atan2(near.x - w.x, near.z - w.z);
          anim[i * 4 + 3] = 0;
          this.walkers.push(w);
          continue;
        }
      }
      if (!this.paths.length) {
        this.walkers.push(w);
        continue;
      }
      // Pick paths by weighted length so the downtown blocks are packed.
      let t = rnd() * this.totalWeight;
      let pi = 0;
      for (; pi < this.paths.length - 1; pi++) {
        const pw = this.paths[pi].len * this.paths[pi].weight;
        if (t <= pw) break;
        t -= pw;
      }
      w.path = pi;
      w.s = Math.min(this.paths[pi].len, t / this.paths[pi].weight);
      w.dir = rnd() < 0.5 ? 1 : -1;
      w.v = 1.0 + rnd() * 0.55;
      w.lateral = (rnd() - 0.5) * 1.6;
      anim[i * 4 + 1] = w.v * 3.6;
      this.walkers.push(w);
    }
  }

  private totalWeight = 0;

  private addPath(pts: number[], weight: number) {
    const m = pts.length / 2;
    if (m < 2) return;
    const cum = new Float32Array(m);
    const y = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      if (i) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      y[i] = this.hf.height(pts[i * 2], pts[i * 2 + 1]);
    }
    const len = cum[m - 1];
    if (len < 15) return;
    this.paths.push({ pts: new Float32Array(pts), y, cum, len, weight });
    this.totalWeight += len * weight;
  }

  /** Sidewalks along the downtown streets at the building line, plus mapped footpaths nearby. */
  private buildPaths(town: Town, osm: OsmData) {
    const near = (x: number, z: number, r: number) => Math.hypot(x - this.cx, z - this.cz) < r;
    const busy = (x: number, z: number) => town.inCore(x, z) || near(x, z, 420);
    for (const r of osm.roads) {
      if (!/^(residential|unclassified|tertiary|secondary|primary|trunk)$/.test(r.kind)) continue;
      const p = r.pts;
      const half = roadSpec(r).half;
      for (const side of [-1, 1]) {
        let run: number[] = [];
        let inCore = 0;
        const flush = () => {
          if (run.length >= 4) this.addPath(run, inCore / (run.length / 2) > 0.5 ? 1 : 0.12);
          run = [];
          inCore = 0;
        };
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
          const l = Math.hypot(dx, dz);
          if (l < 1) continue;
          const nx = -dz / l * side, nz = dx / l * side;
          const n = Math.max(1, Math.ceil(l / 10));
          for (let k = 0; k <= n; k++) {
            const x = p[i] + (dx * k) / n, z = p[i + 1] + (dz * k) / n;
            if (!busy(x, z)) {
              flush();
              continue;
            }
            // Sidewalk just outside the shopfronts, or a standard offset on open lots.
            const front = town.frontage(x, z, nx, nz, 16);
            const off = Math.max(half + 1.5, Math.min(front - 1.8, 11));
            const wx = x + nx * off, wz = z + nz * off;
            // Not on the pavement of this or any other road (divided streets, junctions).
            if (this.onPavement(wx, wz)) {
              flush();
              continue;
            }
            run.push(wx, wz);
            if (town.inCore(x, z)) inCore++;
          }
        }
        flush();
      }
    }
    for (const w of town.data.walks) {
      if (w.pts.length < 4 || !near(w.pts[0], w.pts[1], 1400)) continue;
      const weight = town.inCore(w.pts[0], w.pts[1]) ? 1 : 0.06;
      // Crosswalks are mapped as footways too; keep people off the road.
      let run: number[] = [];
      for (let i = 0; i < w.pts.length; i += 2) {
        if (this.onPavement(w.pts[i], w.pts[i + 1])) {
          if (run.length >= 4) this.addPath(run, weight);
          run = [];
        } else run.push(w.pts[i], w.pts[i + 1]);
      }
      if (run.length >= 4) this.addPath(run, weight);
    }
  }

  private onPavement(x: number, z: number) {
    const hit = this.roads.nearest(x, z, 12);
    return !!hit && hit.dist < hit.halfWidth + 0.8;
  }

  private nearestOnPaths(x: number, z: number) {
    let best: { x: number; z: number } | null = null;
    let bd = 60;
    for (const p of this.paths) {
      for (let i = 0; i < p.pts.length; i += 2) {
        const d = Math.hypot(p.pts[i] - x, p.pts[i + 1] - z);
        if (d < bd) {
          bd = d;
          best = { x: p.pts[i], z: p.pts[i + 1] };
        }
      }
    }
    return best;
  }

  /** People out by the hour: a quiet morning, a lunch crowd, the evening rush and a late night. */
  static activityAt(hour: number) {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 19 || h < 1) return 1;
    if (h >= 1 && h < 2.5) return 0.65;
    if (h >= 2.5 && h < 6) return 0.06;
    if (h >= 6 && h < 10) return 0.2 + (h - 6) * 0.05;
    if (h >= 17) return 0.6 + (h - 17) * 0.2;
    return 0.45;
  }

  update(dt: number, cam: THREE.Vector3, hour: number) {
    const far = Math.hypot(cam.x - this.cx, cam.z - this.cz) > 3500;
    this.mesh.visible = !far;
    if (this.caster) this.caster.visible = !far;
    if (far) return;
    this.activity = Pedestrians.activityAt(hour);
    const pos = this.iPos.array as Float32Array;
    const anim = this.iAnim.array as Float32Array;
    const n = Math.floor(this.activity * this.walkers.length);
    for (let i = 0; i < n; i++) {
      const w = this.walkers[i];
      if (!w.standing && this.paths.length) {
        const p = this.paths[w.path];
        if (w.wait > 0) {
          w.wait -= dt;
        } else {
          w.s += w.v * w.dir * dt;
          if (w.s > p.len || w.s < 0) {
            // Turn back at the end of the block, after a moment.
            w.s = Math.max(0, Math.min(p.len, w.s));
            w.dir = -w.dir;
            w.wait = 0.5 + w.rank * 2;
          }
        }
        let k = 0;
        const m = p.cum.length;
        let lo = 0, hi = m - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (p.cum[mid] < w.s) lo = mid;
          else hi = mid;
        }
        k = lo;
        const l = p.cum[k + 1] - p.cum[k] || 1;
        const t = (w.s - p.cum[k]) / l;
        const ex = (p.pts[k * 2 + 2] - p.pts[k * 2]) / l, ez = (p.pts[k * 2 + 3] - p.pts[k * 2 + 1]) / l;
        const lat = w.lateral * w.dir;
        w.x = p.pts[k * 2] + ex * l * t - ez * lat;
        w.z = p.pts[k * 2 + 1] + ez * l * t + ex * lat;
        w.y = p.y[k] + (p.y[k + 1] - p.y[k]) * t;
        const target = Math.atan2(ex * w.dir, ez * w.dir);
        let dh = target - w.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        w.heading += dh * Math.min(1, dt * 5);
        anim[i * 4 + 3] = w.wait > 0 ? 0 : 1;
      }
      pos[i * 4] = w.x;
      pos[i * 4 + 1] = w.y;
      pos[i * 4 + 2] = w.z;
      pos[i * 4 + 3] = w.heading;
    }
    this.visibleCount = n;
    this.geo.instanceCount = n;
    this.iPos.clearUpdateRanges();
    this.iPos.addUpdateRange(0, n * 4);
    this.iPos.needsUpdate = true;
    this.iAnim.needsUpdate = true;
  }

  addShadowCasters(shadow: ShadowMap) {
    this.caster = shadow.addCaster(this.geo, this.shadowMaterial);
  }
}
