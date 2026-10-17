import * as THREE from 'three';
import { G } from '../render/globals';
import { propFragment, propVertex } from '../render/shaders/propShader';
import type { ShadowMap } from '../render/shadows';
import type { Heightfield } from './heightfield';
import { LC, type OsmData } from './meta';

export const KIND = { HOUSE: 0, SHED: 1, SILO: 2, TOWER: 3, HUT: 4 } as const;

function hash(n: number) {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
}

function withPart(g: THREE.BufferGeometry, part: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(ng.attributes.position.count).fill(part), 1));
  ng.deleteAttribute('uv');
  return ng;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const part = new Float32Array(count);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    part.set(g.attributes.aPart.array as Float32Array, o);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  m.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return m;
}

/** Unit house: walls to 0.62, gable roof to 1, ridge along x. */
function houseGeometry(): THREE.BufferGeometry {
  const walls = new THREE.BoxGeometry(1, 0.62, 1).translate(0, 0.31, 0);
  const roof = new THREE.BufferGeometry();
  const e = 0.54; // eave overhang
  const v = [
    // two sloped faces
    -e, 0.6, -e, e, 0.6, -e, e, 1, 0, -e, 0.6, -e, e, 1, 0, -e, 1, 0,
    -e, 0.6, e, -e, 1, 0, e, 1, 0, -e, 0.6, e, e, 1, 0, e, 0.6, e,
    // gable ends
    -0.5, 0.62, -0.5, -0.5, 1, 0, -0.5, 0.62, 0.5,
    0.5, 0.62, -0.5, 0.5, 0.62, 0.5, 0.5, 1, 0,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  const gables = new THREE.BufferGeometry();
  gables.setAttribute('position', new THREE.Float32BufferAttribute(v.slice(36), 3));
  gables.computeVertexNormals();
  const slopes = new THREE.BufferGeometry();
  slopes.setAttribute('position', new THREE.Float32BufferAttribute(v.slice(0, 36), 3));
  slopes.computeVertexNormals();
  return merge([withPart(walls, 0), withPart(gables, 0), withPart(slopes, 1)]);
}

/** Unit shed: tall walls with a shallow metal roof. */
function shedGeometry(): THREE.BufferGeometry {
  const walls = new THREE.BoxGeometry(1, 0.85, 1).translate(0, 0.425, 0);
  const roof = new THREE.CylinderGeometry(0.72, 0.72, 1.02, 12, 1, false, -0.78, 1.56)
    .rotateZ(Math.PI / 2)
    .scale(1, 0.32, 1.4)
    .translate(0, 0.62, 0);
  return merge([withPart(walls, 0), withPart(roof, 1)]);
}

function siloGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.5, 0.5, 0.84, 18, 1, true).translate(0, 0.42, 0);
  const cap = new THREE.ConeGeometry(0.52, 0.16, 18, 1, true).translate(0, 0.92, 0);
  return merge([withPart(body, 2), withPart(cap, 1)]);
}

/** Triangular lattice broadcast tower, unit height, unit base width. */
function towerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leg = (h: number) => 0.5 * (1 - 0.7 * h);
  const corner = (k: number, h: number) => {
    const a = (k / 3) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * leg(h), h, Math.sin(a) * leg(h));
  };
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, 3, 1, true).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    parts.push(withPart(g, 2));
  };
  const seg = 14;
  for (let i = 0; i < seg; i++) {
    const h0 = i / seg;
    const h1 = (i + 1) / seg;
    for (let k = 0; k < 3; k++) {
      strut(corner(k, h0), corner(k, h1), 0.02);
      strut(corner(k, h0), corner((k + 1) % 3, h1), 0.008);
      strut(corner(k, h1), corner((k + 1) % 3, h1), 0.008);
    }
  }
  return merge(parts);
}

interface Batch {
  geo: THREE.InstancedBufferGeometry;
  data: number[][];
}

/** OSM buildings (houses, farm sheds, rice silos) and the South Butte antenna farm. */
export class Props {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly shadowMaterial: THREE.ShaderMaterial;
  /** Point lights (world xyz, rgb, size, blink) for the night-light renderer. */
  readonly lights: number[] = [];
  private batches: Batch[] = [];

  constructor(osm: OsmData, hf: Heightfield) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: propVertex,
      fragmentShader: propFragment,
      uniforms: { ...G },
      side: THREE.DoubleSide,
    });
    this.shadowMaterial = this.material.clone();
    this.shadowMaterial.uniforms = this.material.uniforms;
    this.shadowMaterial.defines = { SHADOW_PASS: '' };

    const geos = [houseGeometry(), shedGeometry(), siloGeometry(), towerGeometry()];
    const data: number[][][] = geos.map(() => []);
    const c = new THREE.Color();
    const push = (kind: number, x: number, z: number, w: number, h: number, d: number, ang: number, wall: string, roof: string, lit: number, seed: number) => {
      const y = hf.height(x, z) - 0.4;
      c.set(wall);
      const wr = [c.r, c.g, c.b];
      c.set(roof);
      const geoIndex = kind === KIND.HUT ? 0 : kind;
      data[geoIndex].push([x, y, z, ang, w, h, d, kind, wr[0], wr[1], wr[2], lit, c.r, c.g, c.b, seed]);
    };

    const HOUSE_WALL = ['#e8e2d4', '#d9cdb5', '#c9b99a', '#b8b2a6', '#efe9dc', '#a99c86', '#c7c2b8'];
    const HOUSE_ROOF = ['#4a4744', '#5a4e44', '#3b3a3a', '#6b5a4a', '#7a4c38'];
    const BARN_WALL = ['#8a2f22', '#9a3a2a', '#c9c6be', '#b7b4ab', '#7a7064'];
    const METAL = ['#c4c6c8', '#b0b4b8', '#d8d8d4', '#9ea3a8'];
    osm.buildings.forEach(([x, z, w, d, ang], i) => {
      const s = hash(i + x * 0.01);
      const area = w * d;
      if (area < 12 || w > 400 || d > 400) return;
      const lc = hf.landcover(x, z);
      const urban = lc >= LC.URBAN_LOW && lc <= LC.URBAN_HIGH;
      const ratio = Math.max(w, d) / Math.max(1, Math.min(w, d));
      if (!urban && ratio < 1.18 && w > 5 && w < 22 && s < 0.85) {
        // Round grain bins / rice dryers in the farmland.
        const h = w * (1.2 + s * 0.8);
        push(KIND.SILO, x, z, w, h, w, ang, METAL[i % METAL.length], '#b9bcbf', 0, s);
        return;
      }
      if (area > 450 || (!urban && area > 220)) {
        const h = 5.5 + Math.min(6, Math.sqrt(area) * 0.12) + s * 2;
        const wall = urban ? METAL[i % METAL.length] : BARN_WALL[i % BARN_WALL.length];
        push(KIND.SHED, x, z, w, h, d, ang, wall, METAL[(i + 1) % METAL.length], 0, s);
        return;
      }
      const h = (urban ? 6.2 : 5.6) + s * 1.6 + (area > 200 ? 2.5 : 0);
      const lit = urban ? (s < 0.75 ? 1 : 0) : s < 0.6 ? 1 : 0;
      push(KIND.HOUSE, x, z, w, h, d, ang, HOUSE_WALL[i % HOUSE_WALL.length], HOUSE_ROOF[(i * 7) % HOUSE_ROOF.length], lit, s);
      if (lit) {
        // Porch / yard light.
        const y = hf.height(x, z) + 3;
        const warm = s < 0.3 ? [1, 0.55, 0.22] : [1, 0.82, 0.6];
        this.lights.push(x + Math.cos(ang) * w * 0.6, y, z + Math.sin(ang) * w * 0.6, warm[0], warm[1], warm[2], 1, 0);
      }
    });

    // South Butte summit antenna farm (heights from FCC records of the site).
    const summit = [
      { x: -501, z: -80, h: 58, w: 3.2 },
      { x: -478, z: -50, h: 92, w: 4.2 },
      { x: -520, z: -95, h: 36, w: 2.4 },
      { x: -462, z: -70, h: 44, w: 2.6 },
      { x: -492, z: -112, h: 28, w: 2.0 },
      { x: -535, z: -60, h: 22, w: 1.8 },
    ];
    for (const t of summit) {
      push(KIND.TOWER, t.x, t.z, t.w, t.h, t.w, hash(t.x) * 6, '#a8adb2', '#a8adb2', 0, 0.5);
      push(KIND.HUT, t.x + 8, t.z + 4, 6, 3.2, 4, hash(t.z) * 3, '#b9b6ad', '#8c8a86', 0, 0.2);
      const base = hf.height(t.x, t.z);
      // Red aviation obstruction lights at the top and mid-mast.
      this.lights.push(t.x, base + t.h, t.z, 1, 0.08, 0.04, 3.2, 1);
      if (t.h > 40) this.lights.push(t.x, base + t.h * 0.5, t.z, 1, 0.08, 0.04, 2.2, 1);
    }
    // Other broadcast masts across the valley.
    for (const m of osm.masts) {
      if (Math.hypot(m.x + 490, m.z + 70) < 200) continue;
      const h = 60 + hash(m.x) * 90;
      push(KIND.TOWER, m.x, m.z, 3, h, 3, hash(m.z) * 6, '#a8adb2', '#a8adb2', 0, 0.5);
      this.lights.push(m.x, hf.height(m.x, m.z) + h, m.z, 1, 0.08, 0.04, 3.0, 1);
    }

    geos.forEach((base, k) => {
      const rows = data[k];
      if (!rows.length) return;
      const g = new THREE.InstancedBufferGeometry();
      for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]);
      const n = rows.length;
      const t0 = new Float32Array(n * 4);
      const t1 = new Float32Array(n * 4);
      const wall = new Float32Array(n * 4);
      const roof = new Float32Array(n * 4);
      rows.forEach((r, i) => {
        t0.set(r.slice(0, 4), i * 4);
        t1.set(r.slice(4, 8), i * 4);
        wall.set(r.slice(8, 12), i * 4);
        roof.set(r.slice(12, 16), i * 4);
      });
      g.setAttribute('aT0', new THREE.InstancedBufferAttribute(t0, 4));
      g.setAttribute('aT1', new THREE.InstancedBufferAttribute(t1, 4));
      g.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 4));
      g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 4));
      g.instanceCount = n;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.batches.push({ geo: g, data: rows });
    });
  }

  addShadowCasters(shadow: ShadowMap) {
    for (const b of this.batches) shadow.addCaster(b.geo, this.shadowMaterial);
  }
}
