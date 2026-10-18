import * as THREE from 'three';
import { G } from '../render/globals';
import { noiseCommon } from '../render/shaders/noise';
import type { CemeteryPlan } from '../world/cemetery';
import type { Heightfield } from '../world/heightfield';

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uTime;
uniform float uPhase;
out vec3 vLocal;
out vec3 vN;
out vec3 vView;

void main() {
  vec3 p = position;
  // The shroud ripples as if in a draught, most at the trailing hem.
  float loose = 1.0 - smoothstep(0.0, 1.5, p.y);
  p.x += sin(p.y * 3.1 + uTime * 1.9 + uPhase) * 0.07 * loose - loose * loose * 0.12;
  p.z += sin(p.y * 2.3 + uTime * 1.3 + uPhase * 2.0) * 0.06 * loose;
  vLocal = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
${noiseCommon}
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uPhase;
uniform float uFade;
uniform float uInvExposure;
uniform float uOrb;
in vec3 vLocal;
in vec3 vN;
in vec3 vView;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 V = normalize(vView);
  vec3 N = normalize(vN);
  float facing = abs(dot(N, V));
  float flick = 0.8 + 0.2 * sin(uTime * 11.0 + uPhase) * sin(uTime * 4.3 + uPhase * 3.0);
  vec3 col;
  if (uOrb > 0.5) {
    col = vec3(0.75, 0.9, 1.0) * pow(facing, 2.0) * 1.6;
  } else {
    // Translucent: the outline glows, the middle is a thin mist.
    float rim = pow(1.0 - facing, 1.6);
    float ang = atan(vLocal.z, vLocal.x);
    float mist = 0.55 + 0.45 * vnoise(vec2(ang * 3.0, vLocal.y * 4.0 - uTime * 0.6));
    // Ragged hem that fades into nothing above the ground.
    float hem = smoothstep(0.05, 0.7, vLocal.y + (vnoise(vec2(ang * 5.0, uTime * 0.8)) - 0.5) * 0.5);
    // The hood is hollow and dark, but for two faint points.
    float face = vLocal.x > 0.0 ? smoothstep(0.1, 0.0, abs(vLocal.y - 1.68) - 0.08) * smoothstep(0.08, 0.16, vLocal.x) : 0.0;
    vec2 e = vec2(vLocal.y - 1.71, abs(vLocal.z) - 0.055);
    float eyes = vLocal.x > 0.1 ? exp(-dot(e, e) / 0.0003) : 0.0;
    col = vec3(0.62, 0.78, 1.0) * (0.06 + rim * 0.75) * mist * hem * (1.0 - face * 0.85) + vec3(0.8, 0.95, 1.0) * eyes * 1.5;
  }
  outColor = vec4(col * flick * uFade * 0.5 * uInvExposure, 1.0);
}
`;

function shroud() {
  const prof = [
    [0.44, 0.0], [0.36, 0.35], [0.29, 0.8], [0.27, 1.1], [0.32, 1.33], [0.27, 1.47],
    [0.19, 1.56], [0.2, 1.66], [0.19, 1.79], [0.13, 1.9], [0.05, 1.96], [0.0, 1.97],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const curve = new THREE.SplineCurve(prof);
  const g = new THREE.LatheGeometry(curve.getPoints(40), 32);
  g.computeVertexNormals();
  return g;
}

interface Ghost {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  x: number;
  z: number;
  tx: number;
  tz: number;
  yaw: number;
  fade: number;
  /** Seconds until it dares to show itself again after vanishing. */
  hide: number;
}

/**
 * Easter egg: hooded figures drifting among the stones of the "witches'
 * cemetery" after dark. They melt away when you get close.
 */
export class Ghosts {
  readonly group = new THREE.Group();
  private ghosts: Ghost[] = [];
  private orbs: Ghost[] = [];
  private poly: number[];
  private cx: number;
  private cz: number;
  /** 0..1 how haunted it feels at the camera (for the audio). */
  presence = 0;
  onSight?: () => void;

  constructor(plan: CemeteryPlan, private hf: Heightfield) {
    this.poly = plan.poly;
    this.cx = plan.cx;
    this.cz = plan.cz;
    const geo = shroud();
    const orbGeo = new THREE.SphereGeometry(0.09, 12, 8);
    const make = (orb: boolean, i: number) => {
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: G.uTime,
          uInvExposure: G.uInvExposure,
          uPhase: { value: i * 2.17 },
          uFade: { value: 0 },
          uOrb: { value: orb ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(orb ? orbGeo : geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      const [x, z] = this.spot();
      const g: Ghost = { mesh, mat, x, z, tx: x, tz: z, yaw: Math.random() * 6.28, fade: 0, hide: 0 };
      this.group.add(mesh);
      return g;
    };
    for (let i = 0; i < 4; i++) this.ghosts.push(make(false, i));
    for (let i = 0; i < 7; i++) this.orbs.push(make(true, i + 10));
    this.group.visible = false;
  }

  /** A random point inside the cemetery fence. */
  private spot(): [number, number] {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.poly.length; i += 2) {
      x0 = Math.min(x0, this.poly[i]);
      x1 = Math.max(x1, this.poly[i]);
      z0 = Math.min(z0, this.poly[i + 1]);
      z1 = Math.max(z1, this.poly[i + 1]);
    }
    for (let k = 0; k < 40; k++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      if (inside(this.poly, x, z)) return [x, z];
    }
    return [this.cx, this.cz];
  }

  update(dt: number, cam: THREE.Camera, night: number) {
    const dc = Math.hypot(cam.position.x - this.cx, cam.position.z - this.cz);
    const dark = THREE.MathUtils.smoothstep(night, 0.6, 0.9);
    this.group.visible = dark > 0 && dc < 600;
    this.presence = dark * THREE.MathUtils.clamp(1 - (dc - 30) / 220, 0, 1);
    if (!this.group.visible) return;
    const t = G.uTime.value;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    let seen = false;
    for (const [i, g] of [...this.ghosts, ...this.orbs].entries()) {
      const orb = i >= this.ghosts.length;
      const speed = orb ? 0.9 : 0.35;
      const dx = g.tx - g.x, dz = g.tz - g.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) [g.tx, g.tz] = this.spot();
      else {
        g.x += (dx / d) * speed * dt;
        g.z += (dz / d) * speed * dt;
        const want = Math.atan2(-dz, dx);
        g.yaw += Math.atan2(Math.sin(want - g.yaw), Math.cos(want - g.yaw)) * Math.min(1, dt * 0.8);
      }
      const ground = this.hf.height(g.x, g.z);
      const y = ground + (orb ? 0.6 + 0.5 * Math.sin(t * 0.7 + i) : 0.15 + 0.12 * Math.sin(t * 0.9 + i * 1.7));
      const ex = g.x - cam.position.x, ey = y + 1 - cam.position.y, ez = g.z - cam.position.z;
      const dist = Math.hypot(ex, ey, ez);
      // Too close: it's gone, and turns up somewhere else a while later.
      if (dist < (orb ? 4 : 9) && g.fade > 0.05) g.hide = 6 + Math.random() * 10;
      if (g.hide > 0) {
        g.hide -= dt;
        g.fade = Math.max(0, g.fade - dt * 1.5);
        if (g.fade === 0 && g.hide <= 0) {
          [g.x, g.z] = this.spot();
          [g.tx, g.tz] = this.spot();
        }
      } else g.fade = Math.min(1, g.fade + dt * 0.25);
      const f = g.fade * dark;
      g.mat.uniforms.uFade.value = f;
      g.mesh.position.set(g.x, y, g.z);
      g.mesh.rotation.y = g.yaw;
      if (!orb && f > 0.5 && dist < 45 && (ex * fwd.x + ey * fwd.y + ez * fwd.z) / dist > 0.8) seen = true;
    }
    if (seen) this.onSight?.();
  }
}

function inside(poly: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
