import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';

const COUNT = 22000;
const NEAR_BOX = 26;
const FAR_BOX = 90;

/**
 * Falling rain and snow around the camera. Each instance is a quad whose
 * position is computed analytically in the vertex shader and wrapped in a
 * camera-centred box. Raindrops are drawn as motion-blurred streaks along their
 * velocity relative to the camera, so they slant past a moving truck or bird;
 * snowflakes tumble and drift on the wind.
 */
export class Precipitation {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private lastCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private carInv = new THREE.Matrix4();

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        ...G,
        uCamVel: { value: this.camVel },
        uPixelScale: { value: 800 },
        uSnowMode: { value: 0 },
        uCarInv: { value: this.carInv },
        uCarOn: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** `car` is the truck's world matrix when it is in the scene. */
  update(dt: number, cam: THREE.PerspectiveCamera, heightPx: number, car: THREE.Matrix4 | null) {
    const rain = G.uRain.value;
    const snow = G.uSnowFall.value;
    const amount = Math.max(rain, snow);
    const geo = this.mesh.geometry as THREE.InstancedBufferGeometry;
    geo.instanceCount = Math.floor(COUNT * Math.min(1, amount * 1.1));
    this.mesh.visible = geo.instanceCount > 0;

    if (dt > 0) {
      const step = cam.position.distanceTo(this.lastCam);
      const v = cam.position.clone().sub(this.lastCam).divideScalar(dt);
      // Teleports (respawns, view switches) would smear every drop.
      if (step > 4 || v.length() > 90) v.set(0, 0, 0);
      this.camVel.lerp(v, Math.min(1, dt * 8));
    }
    this.lastCam.copy(cam.position);

    const u = this.material.uniforms;
    u.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    u.uSnowMode.value = snow > rain ? 1 : 0;
    u.uCarOn.value = car ? 1 : 0;
    if (car) this.carInv.copy(car).invert();
  }
}

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uCamVel;
uniform float uPixelScale;
uniform float uSnowMode;
uniform mat4 uCarInv;
uniform float uCarOn;
in vec4 aSeed;
out vec3 vWorld;
out vec2 vUv;
out float vAlpha;

void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vAlpha = 0.0;
}

void main() {
  float far = step(0.72, aSeed.w);
  float box = mix(${NEAR_BOX.toFixed(1)}, ${FAR_BOX.toFixed(1)}, far);
  float ph = aSeed.x * 53.0 + aSeed.z * 97.0;
  vec3 vel;
  vec3 wob = vec3(0.0);
  if (uSnowMode > 0.5) {
    // Flakes fall at ~1 m/s, ride the wind and tumble side to side.
    vel = vec3(uWind.x, -(0.8 + aSeed.y * 0.7), uWind.y) * vec3(0.9, 1.0, 0.9);
    wob = vec3(sin(uTime * 1.3 + ph), 0.0, cos(uTime * 1.1 + ph * 1.7)) * 0.45
        + vec3(sin(uTime * 3.1 + ph * 2.3), 0.0, cos(uTime * 2.7 + ph)) * 0.12;
  } else {
    // Raindrops: 6-9 m/s terminal velocity, blown sideways by the wind.
    vel = vec3(uWind.x * 0.8, -(6.5 + aSeed.y * 2.5), uWind.y * 0.8);
  }
  vec3 local = aSeed.xyz * box * 7.31 + vel * uTime + wob;
  vec3 p = mod(local - uCamPos + box * 0.5, box) - box * 0.5 + uCamPos;

  if (uCarOn > 0.5) {
    vec3 c = (uCarInv * vec4(p, 1.0)).xyz;
    if (abs(c.x) < 2.9 && c.y > -0.2 && c.y < 2.05 && abs(c.z) < 1.05) { collapse(); return; }
  }

  vec3 toCam = uCamPos - p;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-3);
  // A drop must cover at least ~1 px; thinner ones fade instead of aliasing.
  float minW = 1.1 * dist / uPixelScale;

  vec3 axis;
  float len;
  float width;
  float a;
  if (uSnowMode > 0.5) {
    float size = mix(0.008, 0.02, aSeed.z);
    width = max(size, minW);
    a = size / width;
    vec3 rel = vel - uCamVel;
    // Flakes streak only when the camera rushes through them.
    float streak = min(length(rel) * 0.012, 0.6);
    axis = length(rel) > 0.01 ? normalize(rel) : vec3(0.0, 1.0, 0.0);
    len = width * 2.0 + streak;
    a *= 0.9 * min(1.0, width * 2.0 / len * 2.0);
  } else {
    vec3 rel = vel - uCamVel;
    float rl = length(rel);
    axis = rel / max(rl, 1e-3);
    // Streak length = distance travelled during a ~1/45 s exposure.
    len = max(rl * 0.022, 0.05);
    float size = mix(0.0012, 0.0025, aSeed.z);
    width = max(size, minW);
    a = size / width * 0.55;
  }
  vec3 side = cross(axis, V);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec3 w = p + side * position.x * width + axis * (position.y - 0.5) * len;

  vWorld = p;
  vUv = vec2(position.x, position.y * 2.0 - 1.0);
  float fadeNear = smoothstep(0.25, 1.0, dist);
  float fadeFar = 1.0 - smoothstep(box * 0.32, box * 0.5, dist);
  vAlpha = a * fadeNear * fadeFar * mix(1.0, 0.8, far);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform float uSnowMode;
in vec3 vWorld;
in vec2 vUv;
in float vAlpha;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  if (vAlpha <= 0.001) discard;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 col;
  float shape;
  if (uSnowMode > 0.5) {
    shape = exp(-dot(vUv, vUv) * 2.2);
    vec3 n = normalize(uCamPos - vWorld);
    // Flakes scatter the bright overcast sky and glow in the headlights.
    col = SNOW_ALB / PI * (skyAmbient(up, 1.0) * 1.1 + sunRadiance(vWorld.y) * 0.6);
    col += headlight(SNOW_ALB * 1.5, normalize(uHeadPos - vWorld), vWorld);
  } else {
    shape = (1.0 - vUv.x * vUv.x) * smoothstep(1.0, 0.6, abs(vUv.y));
    // A drop is a tiny lens: it shows a squashed image of the whole sky,
    // and blazes where it crosses a headlight beam.
    col = skyAmbient(up, 1.0) / PI * 0.85 + skyRadianceDir(normalize(vWorld - uCamPos)) * 0.25;
    col += headlight(vec3(6.0), normalize(uHeadPos - vWorld), vWorld);
  }
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, vAlpha * shape);
}
`;
