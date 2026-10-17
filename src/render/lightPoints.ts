import * as THREE from 'three';
import { G } from './globals';
import { lightingCommon } from './shaders/lighting';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
uniform float uNight;
uniform float uPixelScale;
in vec4 aColor;   // rgb, size (m)
in float aBlink;  // 0 steady, 1 aviation beacon
out vec3 vColor;
out vec3 vWorld;
out float vCore;

void main() {
  vec3 world = position;
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  vWorld = world;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float on = mix(uNight, 1.0, aBlink);
  if (aBlink > 0.5) {
    float ph = fract(uTime / 1.5 + position.x * 0.013);
    on *= smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.35, 0.5, ph));
    on *= mix(0.25, 1.0, uNight);
  } else {
    // Gentle flicker of distant lights through warm air.
    on *= 0.85 + 0.15 * sin(uTime * 3.0 + position.x * 1.7 + position.z);
  }
  float px = aColor.w * uPixelScale / max(dist, 1.0);
  float size = max(px * 6.0, 2.5);
  // Below ~2.5 px fade energy rather than shrink so totals stay stable.
  vCore = clamp(px * 6.0 / 2.5, 0.0, 1.0);
  vColor = aColor.rgb * on;
  gl_PointSize = on > 0.001 ? size : 0.0;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vColor;
in vec3 vWorld;
in float vCore;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0);
  float halo = exp(-r2 * 3.5) * 0.18;
  vec3 c = vColor * (core * 6.0 + halo) * mix(0.35, 1.0, vCore);
  vec3 dir = vWorld - uCamPos;
  float d = length(dir);
  c *= transmittanceAt(uCamPos.y, dir / max(d, 1.0)) * exp(-d * uFogDensity * 0.6);
  outColor = vec4(c, 1.0);
}
`;

/** Additive emissive points: beacons, porch lights, streetlights, car lamps. */
export class LightPoints {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();

  /** `data` holds 8 floats per light: x, y, z, r, g, b, size, blink. */
  constructor(data: number[], dynamic = false) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { ...G, uPixelScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.set(data, dynamic);
  }

  set(data: number[], dynamic = false) {
    const n = data.length / 8;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 4);
    const blink = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      pos.set([data[o], data[o + 1], data[o + 2]], i * 3);
      col.set([data[o + 3], data[o + 4], data[o + 5], data[o + 6]], i * 4);
      blink[i] = data[o + 7];
    }
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(usage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(usage));
    this.geo.setAttribute('aBlink', new THREE.BufferAttribute(blink, 1).setUsage(usage));
    this.geo.setDrawRange(0, n);
  }

  /** Projection scale so `size` metres maps to pixels. */
  resize(cam: THREE.PerspectiveCamera, heightPx: number) {
    this.material.uniforms.uPixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  }
}
