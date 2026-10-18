import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { CarPhysics } from './car';
import { TRACK, WHEELBASE } from './carModel';

const MAX = 600;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPixelScale;
in vec4 aState;   // size (m), alpha, kind (0 dust, 1 mud, 2 water), seed
out float vAlpha;
out float vKind;
out vec3 vWorld;
out float vSeed;

void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aState.x * uPixelScale / max(-mv.z, 0.3);
  gl_PointSize = min(px, 512.0);
  vAlpha = aState.y * smoothstep(0.5, 3.0, px);
  vKind = aState.z;
  vSeed = aState.w;
  vWorld = position;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in float vAlpha;
in float vKind;
in vec3 vWorld;
in float vSeed;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  // Billowy edge: a little noise breaks up the disc.
  float puff = exp(-r2 * 2.2) * (0.75 + 0.5 * vnoise(q * 3.0 + vSeed * 40.0));
  vec3 alb = vKind < 0.5 ? vec3(0.52, 0.45, 0.35) : vKind < 1.5 ? vec3(0.22, 0.18, 0.13) : vec3(0.8, 0.82, 0.84);
  vec3 V = normalize(uCamPos - vWorld);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  float shadow = shadowAt(vWorld, 0.001);
  vec3 col = alb / PI * (sunRadiance(vWorld.y) * shadow * (0.6 + 2.5 * fwd) + skyAmbient(vec3(0.0, 1.0, 0.0), 1.0))
           + headlight(alb, -V, vWorld);
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, clamp(vAlpha * puff, 0.0, 1.0));
}
`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number; size: number; grow: number; kind: number; seed: number;
}

/** Dust plumes off dry ground, mud and water spray from the truck's tyres. */
export class DustTrail {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 3);
  private state = new Float32Array(MAX * 4);
  private parts: P[] = [];
  private emit = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aState', new THREE.BufferAttribute(this.state, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: { ...G, uPixelScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /**
   * @param dryness 0 wet winter .. 1 bone-dry late summer
   */
  update(dt: number, car: CarPhysics, active: boolean, dryness: number, cam: THREE.PerspectiveCamera, heightPx: number) {
    this.material.uniforms.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const s = car.surface.name;
    const speed = Math.abs(car.speed);
    let kind = 0;
    let rate = 0;
    if (active && speed > 2) {
      if (s === 'water') (kind = 2), (rate = speed * 9);
      else if (s === 'mud') (kind = 1), (rate = speed * 4);
      else if (s === 'gravel') rate = speed * 3.2 * (0.4 + 0.6 * dryness);
      else if (s === 'grass' || s === 'orchard') rate = speed * 2.6 * dryness;
      else if (s === 'paved') rate = car.slip > 0.4 ? speed * 2 * car.slip : 0; // tyre smoke
      rate *= 1 + car.slip * 2;
    }
    this.emit += rate * dt;
    const f = car.forward;
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wind = G.uWind.value;
    while (this.emit >= 1 && this.parts.length < MAX) {
      this.emit -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const back = -WHEELBASE / 2 - 0.3;
      const x = car.pos.x + f.x * back + r.x * side * TRACK * 0.5;
      const z = car.pos.z + f.z * back + r.z * side * TRACK * 0.5;
      const smoke = s === 'paved';
      const kick = kind === 2 ? 2.5 : kind === 1 ? 1.6 : 0.6;
      this.parts.push({
        x: x + (Math.random() - 0.5) * 0.4,
        y: car.pos.y + 0.2,
        z: z + (Math.random() - 0.5) * 0.4,
        vx: car.vel.x * 0.35 + r.x * side * kick * Math.random() + (Math.random() - 0.5),
        vy: kick * (0.6 + Math.random()),
        vz: car.vel.z * 0.35 + r.z * side * kick * Math.random() + (Math.random() - 0.5),
        age: 0,
        life: kind === 0 ? (smoke ? 2.5 : 4 + Math.random() * 3) : 0.7 + Math.random() * 0.5,
        size: kind === 0 ? 0.8 : 0.35,
        grow: kind === 0 ? (smoke ? 1.2 : 1.9) : 0.6,
        kind: smoke ? 2 : kind,
        seed: Math.random(),
      });
    }
    if (this.emit > 1) this.emit = 1;

    let n = 0;
    const keep: P[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const heavy = p.kind === 1 || (p.kind === 2 && p.life < 2);
      if (heavy) p.vy -= 9.8 * dt;
      else {
        // Dust settles into the breeze and rises a little as it spreads.
        const k = 1 - Math.exp(-dt * 1.4);
        p.vx += (wind.x - p.vx) * k;
        p.vz += (wind.y - p.vz) * k;
        p.vy += (0.25 - p.vy) * k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (heavy && p.y < car.pos.y - 0.5) continue;
      p.size += p.grow * dt;
      const t = p.age / p.life;
      const alpha = (p.kind === 0 ? 0.32 : p.kind === 1 ? 0.8 : 0.45) * Math.min(1, p.age * 8) * Math.pow(1 - t, 1.6);
      this.pos.set([p.x, p.y, p.z], n * 3);
      this.state.set([p.size, alpha, p.kind, p.seed], n * 4);
      keep.push(p);
      n++;
    }
    this.parts = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aState.needsUpdate = true;
  }
}
