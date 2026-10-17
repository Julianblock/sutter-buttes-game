import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import { windCommon } from '../render/shaders/wind';

const COUNT = 1800;
const BOX = 70;

/**
 * Wind-borne seeds, thistle down and dust motes drifting around the camera,
 * advected by the wind plus gust-driven turbulence. Positions are computed
 * analytically in the vertex shader and wrapped inside a camera-centred box.
 */
export class WindParticles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader(),
      fragmentShader,
      uniforms: {
        ...G,
        uPixelScale: { value: 800 },
        uBoxOrigin: { value: new THREE.Vector3() },
        uGround: { value: 0 },
        uAmount: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  update(cam: THREE.PerspectiveCamera, ground: number, heightPx: number, amount: number) {
    const u = this.material.uniforms;
    u.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    u.uBoxOrigin.value.copy(cam.position);
    u.uGround.value = ground;
    u.uAmount.value = amount;
    this.points.visible = amount > 0.01 && cam.position.y - ground < 120;
  }
}

function vertexShader() {
  return /* glsl */ `
${lightingCommon}
${windCommon}
#include <logdepthbuf_pars_vertex>
uniform float uPixelScale;
uniform vec3 uBoxOrigin;
uniform float uGround;
uniform float uAmount;
in vec4 aSeed;
out vec3 vWorld;
out float vAlpha;
out float vKind;

void main() {
  float box = ${BOX.toFixed(1)};
  float kind = aSeed.w;
  // Heavier seeds sink and lag the wind; dust and down ride it.
  float drag = mix(0.55, 1.0, kind);
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * drag * uTime;
  float ph = aSeed.x * 37.0 + aSeed.z * 91.0;
  vec3 wob = vec3(sin(uTime * 0.7 + ph), 0.5 * sin(uTime * 0.53 + ph * 1.3), cos(uTime * 0.61 + ph * 0.7)) * 1.6;
  vec3 local = aSeed.xyz * box + drift + wob;
  // Wrap into a box centred on the camera.
  vec3 p = mod(local - uBoxOrigin + box * 0.5, box) - box * 0.5 + uBoxOrigin;
  // Hug the ground: most particles in the first ~15 m of air.
  float hNorm = fract(aSeed.y + kind * 0.37);
  p.y = uGround + 0.3 + hNorm * hNorm * 18.0 + wob.y + windGust(p.xz) * 1.5;
  vWorld = p;
  vKind = kind;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float sizeM = mix(0.012, 0.035, kind);
  float px = sizeM * uPixelScale / max(dist, 0.5);
  gl_PointSize = clamp(px * 2.0, 1.5, 9.0);
  // Sub-pixel motes fade instead of shrinking; far ones vanish.
  vAlpha = clamp(px * 1.5, 0.08, 1.0) * (1.0 - smoothstep(box * 0.3, box * 0.5, length(p - uCamPos))) * uAmount;
  #include <logdepthbuf_vertex>
}
`;
}

const fragmentShader = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in float vAlpha;
in float vKind;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 V = normalize(uCamPos - vWorld);
  float shadow = shadowAt(vWorld, 0.001);
  vec3 sun = sunRadiance(vWorld.y) * shadow;
  // Fluffy down glows when backlit by a low sun.
  float back = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  vec3 alb = mix(vec3(0.5, 0.45, 0.38), vec3(0.85, 0.83, 0.78), vKind);
  vec3 col = alb / PI * (sun * (0.4 + 3.0 * back) + skyAmbient(vec3(0.0, 1.0, 0.0), 1.0));
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, vAlpha * exp(-r2 * 2.5));
}
`;
