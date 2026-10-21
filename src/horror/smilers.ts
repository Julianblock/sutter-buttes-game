import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { FlowField } from './nav';

/**
 * The smiling ones: knee-high figures in hooded cloaks with pale faces, a
 * smile far too wide, and two pinpricks of eyeshine. Entirely fictional.
 */

export type HorrorState = 'DORMANT' | 'OBSERVING' | 'FOLLOWING' | 'GATHERING' | 'PURSUIT' | 'SURROUNDING';

const MAX = 12;
// About 0.9 m tall before the per-figure 0.75..1.05 scale: 2 to 3 feet.
const NECK = 0.56;

function cloakGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 2).fill(0), 2));
    parts.push(g.toNonIndexed());
  };
  // Robe: a flared bell from the ground to the shoulders, hem ragged by the shader.
  const robe = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.27, 0.0),
      new THREE.Vector2(0.25, 0.12),
      new THREE.Vector2(0.2, 0.32),
      new THREE.Vector2(0.15, 0.5),
      new THREE.Vector2(0.1, NECK),
      new THREE.Vector2(0.0, NECK + 0.02),
    ],
    14,
  );
  tag(robe, 0);
  // Hood: a slightly peaked dome, open at the front.
  const hood = new THREE.SphereGeometry(0.17, 14, 10, Math.PI * 0.8, Math.PI * 1.4, 0, Math.PI * 0.82);
  const hp = hood.attributes.position.array as Float32Array;
  for (let i = 0; i < hp.length; i += 3) {
    const up = Math.max(0, hp[i + 1]) / 0.17;
    hp[i + 1] *= 1.18;
    hp[i + 2] -= up * up * 0.05; // the peak sags backwards
  }
  hood.computeVertexNormals();
  hood.translate(0, NECK + 0.14, 0);
  tag(hood, 1);
  // Face: a pale oval set back in the hood, facing +z.
  const face = new THREE.CircleGeometry(0.115, 20);
  face.scale(1, 1.22, 1);
  face.translate(0, NECK + 0.135, 0.085);
  tag(face, 2);
  // Hands: two pale little stubs at the sleeve ends.
  for (const s of [-1, 1]) {
    const hand = new THREE.SphereGeometry(0.032, 6, 4);
    hand.translate(s * 0.15, 0.3, 0.09);
    tag(hand, 3);
  }
  const g = new THREE.BufferGeometry();
  const merge = (name: string, size: number) => {
    const arr: number[] = [];
    for (const p of parts) arr.push(...(p.attributes[name].array as Float32Array));
    g.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  };
  merge('position', 3);
  merge('normal', 3);
  merge('uv', 2);
  merge('aPart', 1);
  return g;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
in float aPart;
in vec4 iPos;   // x, y, z, heading
in vec4 iAnim;  // seed, head tilt (rad), scale, agitation 0..1
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec3 vLocal;
flat out float vPart;
flat out vec4 vAnim;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float seed = iAnim.x;
  float agit = iAnim.w;
  // Breathing sway; giggling shakes the whole body.
  float sway = sin(uTime * 1.3 + seed * 6.0) * 0.025 + sin(uTime * 31.0 + seed * 3.0) * 0.018 * agit;
  if (aPart > 0.5) {
    // Head (hood, face) tilts about the neck.
    float t = iAnim.y + sway * 0.6;
    float c = cos(t), s = sin(t);
    vec2 xy = vec2(p.x, p.y - ${NECK.toFixed(2)});
    p.xy = vec2(xy.x * c - xy.y * s, xy.x * s + xy.y * c) + vec2(0.0, ${NECK.toFixed(2)});
    n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
  }
  p.x += sway * p.y;
  // Ragged hem stirs on its own even in dead air.
  if (aPart < 0.5 && p.y < 0.12) p.xz *= 1.0 + 0.06 * sin(atan(p.z, p.x) * 7.0 + seed * 9.0 + uTime * 0.7);
  vLocal = p;
  p *= iAnim.z;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  p.xz = vec2(p.x * ch + p.z * sh, -p.x * sh + p.z * ch);
  n.xz = vec2(n.x * ch + n.z * sh, -n.x * sh + n.z * ch);
  vec3 world = iPos.xyz + p;
  vWorld = world;
  vNormal = n;
  vUv = uv;
  vPart = aPart;
  vAnim = iAnim;
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec3 vLocal;
flat in float vPart;
flat in vec4 vAnim;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 albedo = vec3(0.045, 0.04, 0.045);
  vec3 emit = vec3(0.0);
  float glowK = uInvExposure * (0.25 + 0.75 * uNight);
  if (vPart < 0.5 || (vPart > 0.5 && vPart < 1.5)) {
    // Coarse, filthy wool; the hood lining is darker still.
    albedo *= 0.8 + 0.4 * vnoise(vLocal.xy * 40.0 + vAnim.x * 9.0);
    if (!gl_FrontFacing) albedo *= 0.4;
  } else if (vPart < 2.5) {
    // The face. uv: (-1..1) across, (-1..1) up.
    vec2 q = (vUv - 0.5) * 2.0;
    vec3 skin = vec3(0.6, 0.585, 0.555);
    albedo = skin * (0.55 + 0.45 * smoothstep(1.0, 0.4, length(q)));
    // Hood shadow across the brow.
    albedo *= mix(0.35, 1.0, smoothstep(0.85, 0.2, q.y));
    // The smile: a crescent that reaches almost to the edges of the face.
    float x2 = q.x * q.x;
    float top = -0.2 + 0.52 * x2;
    float bot = -0.66 + 1.45 * x2;
    float mouth = step(bot, q.y) * step(q.y, top);
    if (mouth > 0.5) {
      float tooth = step(0.28, fract(q.x * 17.0 + 0.5));
      float upper = step(top - 0.11 + 0.04 * x2, q.y) * tooth;
      float lower = step(q.y, bot + 0.08) * tooth * step(abs(q.x), 0.55);
      albedo = mix(vec3(0.03, 0.006, 0.01), vec3(0.82, 0.79, 0.66), max(upper, lower));
    }
    // Cheeks bunched up by the grin.
    albedo *= 1.0 - 0.25 * smoothstep(0.12, 0.0, abs(q.y - top - 0.07 - 0.2 * x2)) * step(0.2, abs(q.x));
    // Tiny eyes, close set; black, with eyeshine that finds you.
    vec2 e = vec2(abs(q.x) - 0.17, q.y - 0.3);
    float eye = smoothstep(0.06, 0.048, length(e * vec2(1.0, 1.4)));
    albedo = mix(albedo, vec3(0.005), eye);
    float facing = pow(max(dot(n, V), 0.0), 3.0);
    float pin = smoothstep(0.035, 0.0, length(e - vec2(0.012, 0.012)));
    emit += vec3(0.95, 0.88, 0.55) * pin * facing * glowK * 2.5;
    // The faintest pallor so the face reads in the dark.
    emit += albedo * glowK * 0.05;
  } else {
    albedo = vec3(0.7, 0.68, 0.64);
    emit += albedo * glowK * 0.03;
  }
  albedo *= 0.55;
  vec3 col = shadeSurface(albedo, n, vWorld, 1.0, 0.9, 1.0);
  col = applyAtmosphere(col, vWorld);
  // Eyeshine cuts through the fog further than anything else.
  float d = length(uCamPos - vWorld);
  col += emit * mix(1.0, exp(-d * 0.02), 0.6);
  outColor = vec4(col, 1.0);
}
`;

export interface Smiler {
  x: number;
  y: number;
  z: number;
  heading: number;
  tilt: number;
  tiltTarget: number;
  scale: number;
  seed: number;
  active: boolean;
  /** In the player's view right now (frustum + line of sight). */
  observed: boolean;
  /** Seconds observed continuously. */
  seen: number;
  /** Seconds since last observed. */
  unseen: number;
  /** Angle of its place in the ring around the player. */
  slot: number;
  agitation: number;
  moving: boolean;
  /** Pending relocation (vanishes the moment nobody is looking). */
  relocate: boolean;
  stride: number;
  nextVoice: number;
}

export interface SmilerWorld {
  ground(x: number, z: number): number;
  /** Wall, trunk or water at (x, z)? */
  blocked(x: number, z: number): boolean;
  /** Line of sight (walls only). */
  clear(ax: number, az: number, bx: number, bz: number): boolean;
}

export type SmilerEvent = 'giggle' | 'laugh' | 'step' | 'breath' | 'whisper';

/** Seeded RNG so a given run of the director plays out the same way. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Smilers {
  readonly mesh: THREE.Mesh;
  readonly list: Smiler[] = [];
  state: HorrorState = 'DORMANT';
  /** How many the director wants out. */
  want = 0;
  observedCount = 0;
  /** Nearest active one (m). */
  nearest = Infinity;
  /** Ring centre while surrounding, and the escape gap. */
  ring = { x: 0, z: 0, t: 0, gap: 0, open: false };
  onEvent: (e: SmilerEvent, x: number, y: number, z: number, k: number) => void = () => {};
  /** Fires when they reach the player (pursuit ends in a circle). */
  onCaught: () => void = () => {};
  private geo: THREE.InstancedBufferGeometry;
  private iPos: THREE.InstancedBufferAttribute;
  private iAnim: THREE.InstancedBufferAttribute;
  private rnd = mulberry(0x5a77e5);
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private v3 = new THREE.Vector3();

  constructor(
    private world: SmilerWorld,
    private flow: FlowField,
  ) {
    const base = cloakGeometry();
    this.geo = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(base.attributes)) this.geo.setAttribute(k, base.attributes[k]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iAnim', this.iAnim);
    this.geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment, uniforms: { ...G }, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'smilers';
    for (let i = 0; i < MAX; i++) {
      this.list.push({
        x: 0, y: 0, z: 0, heading: 0, tilt: 0, tiltTarget: 0, scale: 0.75 + this.rnd() * 0.3, seed: this.rnd() * 10, active: false,
        observed: false, seen: 0, unseen: 99, slot: (i / MAX) * Math.PI * 2, agitation: 0, moving: false, relocate: false, stride: 0, nextVoice: 3 + this.rnd() * 6,
      });
    }
  }

  /** Puts one somewhere the player is not looking, `r0`..`r1` metres away. */
  private spawn(s: Smiler, px: number, pz: number, camYaw: number, r0: number, r1: number) {
    for (let tries = 0; tries < 24; tries++) {
      // Behind and to the sides: 100..260 degrees off the view direction.
      const a = camYaw + Math.PI * (0.55 + this.rnd() * 0.9);
      const r = r0 + this.rnd() * (r1 - r0);
      const x = px - Math.sin(a) * r, z = pz - Math.cos(a) * r;
      if (this.world.blocked(x, z)) continue;
      if (tries < 16 && !Number.isFinite(this.flow.at(x, z))) continue;
      s.x = x;
      s.z = z;
      s.y = this.world.ground(x, z);
      s.active = true;
      s.seen = 0;
      s.unseen = 0;
      s.relocate = false;
      s.heading = Math.atan2(px - x, pz - z);
      s.tilt = s.tiltTarget = (this.rnd() - 0.5) * 0.3;
      return true;
    }
    return false;
  }

  /** Everyone goes, instantly (lights-up, mode switched off, the player woke). */
  clear() {
    for (const s of this.list) s.active = false;
    this.geo.instanceCount = 0;
    this.observedCount = 0;
    this.nearest = Infinity;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, player: { x: number; z: number; speed: number }) {
    const px = player.x, pz = player.z;
    if (this.state === 'DORMANT') {
      if (this.geo.instanceCount) this.clear();
      return;
    }
    this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const fwd = cam.getWorldDirection(this.v3);
    const camYaw = Math.atan2(-fwd.x, -fwd.z);

    // Bring the count toward what the director asked for, out of sight.
    let active = this.list.filter((s) => s.active).length;
    const ranges: Record<HorrorState, [number, number]> = {
      DORMANT: [0, 0], OBSERVING: [26, 55], FOLLOWING: [16, 26], GATHERING: [12, 22], PURSUIT: [14, 24], SURROUNDING: [8, 12],
    };
    for (const s of this.list) {
      if (active >= this.want) break;
      if (s.active) continue;
      if (this.spawn(s, px, pz, camYaw, ...ranges[this.state])) active++;
    }
    for (let i = this.list.length - 1; i >= 0 && active > this.want; i--) {
      const s = this.list[i];
      // They only ever leave when nobody is watching.
      if (s.active && !s.observed) (s.active = false), active--;
    }

    this.observedCount = 0;
    this.nearest = Infinity;
    let k = 0;
    const pursuit = this.state === 'PURSUIT';
    const surround = this.state === 'SURROUNDING';
    const actives = this.list.filter((s) => s.active);
    actives.forEach((s, idx) => (s.slot = (idx / Math.max(1, actives.length)) * Math.PI * 2 + this.ring.t * 0.15));
    for (const s of actives) {
      const dx = px - s.x, dz = pz - s.z;
      const d = Math.hypot(dx, dz);
      this.nearest = Math.min(this.nearest, d);
      this.v3.set(s.x, s.y + 0.45 * s.scale, s.z);
      const inView = this.frustum.containsPoint(this.v3) && d < 90;
      s.observed = inView && this.world.clear(cam.position.x, cam.position.z, s.x, s.z);
      if (s.observed) (s.seen += dt), (s.unseen = 0), this.observedCount++;
      else (s.unseen += dt), (s.seen = 0);

      // Stared at too long, or crowded: it goes, the moment you look away.
      if (this.state === 'OBSERVING' && (s.seen > 3.5 || d < 9)) s.relocate = true;
      if (s.relocate && !s.observed && s.unseen > 0.4) {
        if (!this.spawn(s, px, pz, camYaw, ...ranges[this.state])) s.active = false;
        continue;
      }

      // Where it wants to be.
      let speed = 0;
      let tx = px, tz = pz;
      let stop = 0;
      if (this.state === 'FOLLOWING') {
        stop = 9 + (s.seed % 1) * 5;
        speed = s.observed ? 0 : 3.6;
      } else if (this.state === 'GATHERING') {
        stop = 6.5 + (s.seed % 1) * 3;
        speed = s.observed ? 0 : 3.2;
        tx = px + Math.sin(s.slot) * stop;
        tz = pz + Math.cos(s.slot) * stop;
        stop = 0.6;
      } else if (pursuit) {
        // Close a ring: each heads for its own place around you, cutting you off.
        const r = Math.max(1.4, Math.min(6, d * 0.45));
        tx = px + Math.sin(s.slot) * r;
        tz = pz + Math.cos(s.slot) * r;
        speed = 3.7 + (s.seed % 1) * 0.6 + (s.observed ? 0 : 0.6);
        stop = 0.3;
        if (d < 1.1) this.onCaught();
      } else if (surround) {
        const ring = this.ring;
        const gapOff = Math.abs(Math.atan2(Math.sin(s.slot - ring.gap), Math.cos(s.slot - ring.gap)));
        const r = ring.open && gapOff < 0.9 ? 5.5 : 2.3;
        tx = ring.x + Math.sin(s.slot) * r;
        tz = ring.z + Math.cos(s.slot) * r;
        speed = ring.open ? 1.6 : 2.2;
        stop = 0.15;
      }

      s.moving = false;
      const gx = tx - s.x, gz = tz - s.z;
      const gd = Math.hypot(gx, gz);
      if (speed > 0 && gd > stop) {
        // Straight at it if the way is open, otherwise follow the flow field to the player.
        let mx = gx / gd, mz = gz / gd;
        if (!this.world.clear(s.x, s.z, tx, tz) || this.flow.isWall(s.x + mx, s.z + mz)) {
          const f = this.flow.dir(s.x, s.z);
          if (f) [mx, mz] = f;
        }
        // Keep apart from each other.
        for (const o of actives) {
          if (o === s) continue;
          const ox = s.x - o.x, oz = s.z - o.z;
          const od = Math.hypot(ox, oz);
          if (od > 0.01 && od < 1.2) (mx += (ox / od) * (1.2 - od)), (mz += (oz / od) * (1.2 - od));
        }
        const ml = Math.hypot(mx, mz) || 1;
        const step = Math.min(gd - stop, speed * dt);
        const nx = s.x + (mx / ml) * step, nz = s.z + (mz / ml) * step;
        if (!this.world.blocked(nx, nz)) {
          s.x = nx;
          s.z = nz;
          s.moving = true;
          s.stride += step;
          if (s.stride > 0.45) {
            s.stride = 0;
            if (d < 30) this.onEvent('step', s.x, s.y, s.z, Math.min(1, speed / 4));
          }
        }
        s.y = this.world.ground(s.x, s.z);
      }
      // Always facing you, whether moving or not.
      const want = Math.atan2(dx, dz);
      s.heading += Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)) * Math.min(1, dt * (s.observed ? 2 : 8));

      // Heads cock when you look at them; in the ring they loll right over.
      if (surround) s.tiltTarget = Math.sin(this.ring.t * 0.8 + s.seed) * 0.75;
      else if (s.seen > 0.8) s.tiltTarget = (s.seed % 2 > 1 ? 1 : -1) * 0.45;
      else if (s.unseen > 3) s.tiltTarget = 0;
      s.tilt += (s.tiltTarget - s.tilt) * Math.min(1, dt * (s.observed ? 0.8 : 4));
      s.agitation += ((pursuit || surround ? 1 : 0) - s.agitation) * Math.min(1, dt * 2);

      // Voices.
      s.nextVoice -= dt;
      if (s.nextVoice <= 0 && d < 45) {
        const rate = surround ? 1.2 : pursuit ? 2.0 : this.state === 'GATHERING' ? 5 : 9;
        s.nextVoice = rate * (0.6 + this.rnd() * 0.8);
        const kind: SmilerEvent = surround ? 'laugh' : pursuit || this.rnd() < 0.6 ? 'giggle' : d < 12 ? 'breath' : 'whisper';
        this.onEvent(kind, s.x, s.y + 0.6 * s.scale, s.z, 1);
      }

      this.iPos.setXYZW(k, s.x, s.y, s.z, s.heading);
      this.iAnim.setXYZW(k, s.seed, s.tilt, s.scale, s.agitation);
      k++;
    }
    this.geo.instanceCount = k;
    this.iPos.needsUpdate = true;
    this.iAnim.needsUpdate = true;
  }
}
