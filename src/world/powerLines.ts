import * as THREE from 'three';
import { G } from '../render/globals';
import { wireFragment, wireVertex } from '../render/shaders/wireShader';
import { StrutBuilder } from './geom';
import type { Heightfield } from './heightfield';
import type { OsmData } from './meta';

export const PYLON = { LATTICE: 0, POLE: 1 } as const;

export interface Pylon {
  x: number;
  y: number;
  z: number;
  /** Local +x (cross-arm direction) maps to world (cos ang, sin ang). */
  ang: number;
  type: number;
}

/** Conductor attachment points (across, height) in metres, per pylon type. */
const ATTACH: [number, number][][] = [
  // PG&E-style double-circuit 230 kV lattice: three arms a side plus two earth wires.
  [[-7, 23], [7, 23], [-8.5, 28.5], [8.5, 28.5], [-7, 34], [7, 34], [-3.2, 40], [3.2, 40]],
  // Wood pole sub-transmission: flat cross-arm and a top pin.
  [[-2.3, 15.9], [2.3, 15.9], [0, 17.1]],
];
/** Mid-span sag as a fraction of span length. */
const SAG = [0.032, 0.022];
const RADIUS = [0.016, 0.009];

/** Double-circuit lattice tower, in metres, cross arms along x. */
export function latticeGeometry(): THREE.BufferGeometry {
  const sb = new StrutBuilder();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const half = (y: number) => (y < 36 ? 4.4 - (y / 36) * 3.4 : 1.0);
  const levels = [0, 4.5, 9, 13, 17, 20.5, 23, 25.5, 28.5, 31, 34, 37];
  const corners = (y: number) => {
    const h = half(y);
    return [V(-h, y, -h), V(h, y, -h), V(h, y, h), V(-h, y, h)];
  };
  for (let i = 0; i + 1 < levels.length; i++) {
    const a = corners(levels[i]);
    const b = corners(levels[i + 1]);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      sb.strut(a[k], b[k], 0.14, 2, 4);
      // X-bracing on every face.
      sb.strut(a[k], b[k2], 0.045);
      sb.strut(a[k2], b[k], 0.045);
      sb.strut(b[k], b[k2], 0.045);
    }
  }
  // Peak and earth-wire arms.
  const top = corners(37);
  for (const c of top) sb.strut(c, V(0, 40.5, 0), 0.08);
  for (const s of [-1, 1]) {
    sb.strut(V(s * 1, 37, -1), V(s * 3.2, 40.3, 0), 0.06);
    sb.strut(V(s * 1, 37, 1), V(s * 3.2, 40.3, 0), 0.06);
  }
  // Conductor arms: tapered trusses, insulator strings hanging from the tips.
  for (const [len, y] of [[7, 25.5], [8.5, 31], [7, 36.5]]) {
    const h = half(y);
    for (const s of [-1, 1]) {
      const tip = V(s * len, y, 0);
      sb.strut(V(s * h, y, -h), tip, 0.07);
      sb.strut(V(s * h, y, h), tip, 0.07);
      sb.strut(V(s * h, y + 2.2, 0), tip, 0.06);
      sb.strut(V(s * h, y, -h), V(s * h, y + 2.2, 0), 0.04);
      sb.strut(V(s * h, y, h), V(s * h, y + 2.2, 0), 0.04);
      // Insulator string (glass discs read as a dark beaded cylinder).
      sb.strut(tip, V(s * len, y - 2.5, 0), 0.17, 0, 6);
    }
  }
  return sb.build();
}

/** Tapered wood pole with a cross-arm and pin insulators. */
export function poleGeometry(): THREE.BufferGeometry {
  const sb = new StrutBuilder();
  sb.add(new THREE.CylinderGeometry(0.13, 0.2, 17, 7, 1, true).translate(0, 8.5, 0), 0);
  sb.add(new THREE.BoxGeometry(5.2, 0.14, 0.12).translate(0, 15.6, 0), 0);
  for (const x of [-2.3, 2.3]) sb.add(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 6).translate(x, 15.75, 0), 1);
  sb.add(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 6).translate(0, 16.95, 0), 1);
  // Diagonal braces under the arm.
  sb.strut(new THREE.Vector3(0, 14.3, 0.1), new THREE.Vector3(-1.4, 15.55, 0.1), 0.03, 2);
  sb.strut(new THREE.Vector3(0, 14.3, 0.1), new THREE.Vector3(1.4, 15.55, 0.1), 0.03, 2);
  return sb.build();
}

/**
 * OSM high-voltage lines. Way vertices are the real pylon positions, so each
 * one gets a tower turned to bisect its adjacent spans, and conductors sag
 * between them as parabolic catenaries drawn as pixel-wide ribbons.
 */
export class PowerLines {
  readonly pylons: Pylon[] = [];
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(osm: OsmData, hf: Heightfield) {
    const spans: number[] = [];
    for (const line of osm.power) {
      const p = line.pts;
      const n = p.length / 2;
      if (n < 2) continue;
      const lens: number[] = [];
      for (let i = 0; i + 1 < n; i++) lens.push(Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]));
      const sorted = [...lens].sort((a, b) => a - b);
      const type = sorted[sorted.length >> 1] > 190 ? PYLON.LATTICE : PYLON.POLE;
      const towers: Pylon[] = [];
      for (let i = 0; i < n; i++) {
        const x = p[i * 2];
        const z = p[i * 2 + 1];
        const j0 = Math.max(0, i - 1);
        const j1 = Math.min(n - 1, i + 1);
        // Average the unit directions of both spans for the bisector.
        let dx = 0;
        let dz = 0;
        if (i > 0) {
          const l = lens[i - 1] || 1;
          dx += (x - p[j0 * 2]) / l;
          dz += (z - p[j0 * 2 + 1]) / l;
        }
        if (i < n - 1) {
          const l = lens[i] || 1;
          dx += (p[j1 * 2] - x) / l;
          dz += (p[j1 * 2 + 1] - z) / l;
        }
        const t: Pylon = { x, y: hf.height(x, z), z, ang: Math.atan2(dx, -dz), type };
        towers.push(t);
        this.pylons.push(t);
      }
      const att = ATTACH[type];
      for (let i = 0; i + 1 < n; i++) {
        const a = towers[i];
        const b = towers[i + 1];
        const len = lens[i];
        if (len < 5 || len > 900) continue;
        for (const [ax, ay] of att) {
          spans.push(
            a.x + Math.cos(a.ang) * ax, a.y + ay, a.z + Math.sin(a.ang) * ax,
            b.x + Math.cos(b.ang) * ax, b.y + ay, b.z + Math.sin(b.ang) * ax,
            len * SAG[type], RADIUS[type],
          );
        }
      }
    }

    // One instanced ribbon strip per conductor span.
    const SEG = 16;
    const strip: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      strip.push(i / SEG, -1, i / SEG, 1);
      if (i < SEG) {
        const o = i * 2;
        index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
    geo.setAttribute('aStrip', new THREE.Float32BufferAttribute(strip, 2));
    geo.setIndex(index);
    const n = spans.length / 8;
    const a0 = new Float32Array(n * 4);
    const a1 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const s = spans.slice(i * 8, i * 8 + 8);
      a0.set([s[0], s[1], s[2], s[6]], i * 4);
      a1.set([s[3], s[4], s[5], s[7]], i * 4);
    }
    geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(a0, 4));
    geo.setAttribute('aP1', new THREE.InstancedBufferAttribute(a1, 4));
    geo.instanceCount = n;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: wireVertex,
      fragmentShader: wireFragment,
      // Weathered stranded aluminium.
      uniforms: { ...G, uPixelAngle: { value: 0.001 }, uFar: { value: 9000 }, uWireColor: { value: new THREE.Vector3(0.22, 0.23, 0.24) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Angular size of one pixel, so wires never thin below a pixel. */
  resize(cam: THREE.PerspectiveCamera, heightPx: number) {
    this.material.uniforms.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / heightPx;
  }
}
