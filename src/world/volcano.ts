import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';

const PLUME = 2600;
const LAVA = 900;
const PERIOD = 26;
const RISE = 4;
const HOLD = 38;
const FADE = 7;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPixelScale;
uniform float uVisionT;
uniform float uVision;
uniform vec3 uVent;
uniform vec2 uWind;
in vec4 aSeed;
in float aKind;
out float vAlpha;
out float vKind;
out float vGlow;
out float vSeed;
out vec3 vWorld;

void main() {
  vec3 p;
  float size, alpha, glow;
  if (aKind < 0.5) {
    // Eruption column: a turbulent rising plume that mushrooms out at the top
    // and leans downwind.
    float born = aSeed.w * ${PERIOD.toFixed(1)};
    float age = mod(uVisionT - born, ${PERIOD.toFixed(1)});
    float s = age / ${PERIOD.toFixed(1)};
    float h = 4200.0 * (1.0 - pow(1.0 - s, 1.7));
    float r = (40.0 + 700.0 * pow(s, 0.8) * (0.35 + 0.65 * aSeed.y)) + smoothstep(0.55, 1.0, s) * 2600.0 * aSeed.z;
    float a = aSeed.x * 6.2832 + s * 2.0;
    p = uVent + vec3(cos(a) * r, h, sin(a) * r);
    p.xz += uWind * age * 22.0 * smoothstep(0.1, 0.8, s);
    size = 90.0 + 800.0 * s;
    alpha = smoothstep(0.0, 0.03, s) * pow(1.0 - s, 0.6) * 0.5 * step(born, uVisionT);
    glow = exp(-h / 500.0);
  } else {
    // Lava fountain: incandescent bombs on ballistic arcs over the vent.
    float period = 3.0 + aSeed.w * 3.0;
    float age = mod(uVisionT + aSeed.w * 17.0, period);
    float a = aSeed.x * 6.2832;
    float vh = 8.0 + 32.0 * aSeed.y;
    float vv = 55.0 + 60.0 * aSeed.z;
    p = uVent + vec3(cos(a) * vh * age, vv * age - 4.9 * age * age, sin(a) * vh * age);
    size = 6.0 + 10.0 * aSeed.z;
    alpha = p.y > uVent.y - 60.0 ? 1.0 : 0.0;
    glow = 1.0 - age / period;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = size * uPixelScale / max(-mv.z, 1.0);
  gl_PointSize = clamp(px, 1.5, 700.0);
  vAlpha = alpha * uVision * min(1.0, px / 1.5);
  vKind = aKind;
  vGlow = glow;
  vSeed = aSeed.x;
  vWorld = p;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in float vAlpha;
in float vKind;
in float vGlow;
in float vSeed;
in vec3 vWorld;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0 || vAlpha < 0.002) discard;
  vec3 col;
  float a;
  if (vKind < 0.5) {
    float puff = exp(-r2 * 2.0) * (0.6 + 0.8 * vnoise(q * 2.5 + vSeed * 50.0));
    vec3 ash = vec3(0.16, 0.15, 0.14);
    // Lit from above by the sun and from below by the glowing vent.
    float top = 0.5 + 0.5 * -q.y;
    col = ash / PI * (sunRadiance(vWorld.y) * (0.25 + 0.6 * top) + skyAmbient(vec3(0.0, 1.0, 0.0), 1.0))
        + vec3(1.0, 0.32, 0.07) * vGlow * (0.5 + 0.5 * q.y) * 3.0 * uInvExposure;
    a = vAlpha * puff;
  } else {
    float core = exp(-r2 * 3.0);
    col = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.75, 0.35), core * vGlow) * (4.0 + 20.0 * vGlow) * uInvExposure;
    a = vAlpha * core;
  }
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/**
 * A vision of the Buttes 1.6 million years ago: the central lava domes erupting,
 * an ash column towering over the valley, glowing flows on the slopes.
 */
export class VolcanoVision {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private t = -1;
  /** 0..1 strength of the vision right now. */
  level = 0;

  constructor(vent: THREE.Vector3, core: { x: number; z: number; r: number }) {
    const n = PLUME + LAVA;
    const seed = new Float32Array(n * 4);
    const kind = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      kind[i] = i < PLUME ? 0 : 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        ...G,
        uPixelScale: { value: 800 },
        uVisionT: { value: 0 },
        uVent: { value: vent.clone() },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.visible = false;
    G.uVolcano.value.set(core.x, core.z, core.r);
  }

  get active() {
    return this.t >= 0;
  }

  start() {
    if (this.t < 0) this.t = 0;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, heightPx: number) {
    if (this.t < 0) {
      this.level = 0;
      G.uVision.value = 0;
      return;
    }
    this.t += dt;
    const t = this.t;
    this.level = t < RISE ? t / RISE : t < RISE + HOLD ? 1 : Math.max(0, 1 - (t - RISE - HOLD) / FADE);
    this.level = this.level * this.level * (3 - 2 * this.level);
    if (t > RISE + HOLD + FADE) this.t = -1;
    G.uVision.value = this.level;
    const u = this.material.uniforms;
    u.uVisionT.value = t;
    u.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.points.visible = this.level > 0;
  }
}
