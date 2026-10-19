import * as THREE from 'three';
import { G } from '../render/globals';
import { propFragment, propVertex } from '../render/shaders/propShader';
import type { ShadowMap } from '../render/shadows';
import type { Heightfield } from './heightfield';
import { merge, StrutBuilder, withPart } from './geom';
import { LC, type OsmData } from './meta';
import { latticeGeometry, poleGeometry, PYLON, type Pylon } from './powerLines';

export const KIND = { HOUSE: 0, SHED: 1, SILO: 2, TOWER: 3, HUT: 4 } as const;

function hash(n: number) {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
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
  const sb = new StrutBuilder();
  const leg = (h: number) => 0.5 * (1 - 0.7 * h);
  const corner = (k: number, h: number) => {
    const a = (k / 3) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * leg(h), h, Math.sin(a) * leg(h));
  };
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number) => sb.strut(a, b, r);
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
  return sb.build();
}

const PROP_TILE = 2000;

interface Batch {
  geo: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  tower: boolean;
  caster?: THREE.Mesh;
}

/** OSM buildings (houses, farm sheds, rice silos) and the South Butte antenna farm. */
export class Props {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly shadowMaterial: THREE.ShaderMaterial;
  /** Point lights (world xyz, rgb, size, blink) for the night-light renderer. */
  readonly lights: number[] = [];
  private batches: Batch[] = [];

  /** `skip` marks ground a detailed town draws itself (its buildings and infill stand down). */
  constructor(osm: OsmData, hf: Heightfield, pylons: Pylon[] = [], skip: (x: number, z: number) => boolean = () => false) {
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

    const geos = [houseGeometry(), shedGeometry(), siloGeometry(), towerGeometry(), latticeGeometry(), poleGeometry()];
    const data: number[][][] = geos.map(() => []);
    const c = new THREE.Color();
    const push = (kind: number, x: number, z: number, w: number, h: number, d: number, ang: number, wall: string, roof: string, lit: number, seed: number, geo?: number) => {
      const y = hf.height(x, z) - 0.4;
      c.set(wall);
      const wr = [c.r, c.g, c.b];
      c.set(roof);
      const geoIndex = geo ?? (kind === KIND.HUT ? 0 : kind);
      data[geoIndex].push([x, y, z, ang, w, h, d, kind, wr[0], wr[1], wr[2], lit, c.r, c.g, c.b, seed]);
    };

    const HOUSE_WALL = ['#e8e2d4', '#d9cdb5', '#c9b99a', '#b8b2a6', '#efe9dc', '#a99c86', '#c7c2b8'];
    const HOUSE_ROOF = ['#4a4744', '#5a4e44', '#3b3a3a', '#6b5a4a', '#7a4c38'];
    const BARN_WALL = ['#8a2f22', '#9a3a2a', '#c9c6be', '#b7b4ab', '#7a7064'];
    const METAL = ['#c4c6c8', '#b0b4b8', '#d8d8d4', '#9ea3a8'];
    const addHouse = (x: number, z: number, w: number, d: number, ang: number, s: number, i: number, urban: boolean) => {
      const h = (urban ? 6.2 : 5.6) + s * 1.6 + (w * d > 200 ? 2.5 : 0);
      const lit = urban ? (s < 0.75 ? 1 : 0) : s < 0.6 ? 1 : 0;
      push(KIND.HOUSE, x, z, w, h, d, ang, HOUSE_WALL[i % HOUSE_WALL.length], HOUSE_ROOF[(i * 7) % HOUSE_ROOF.length], lit, s);
      if (lit) {
        // Porch / yard light.
        const y = hf.height(x, z) + 3;
        const warm = s < 0.3 ? [1, 0.42, 0.1] : s < 0.5 ? [0.75, 0.82, 1] : [1, 0.62, 0.3];
        this.lights.push(x + Math.cos(ang) * w * 0.6, y, z + Math.sin(ang) * w * 0.6, warm[0], warm[1], warm[2], 0.8, 0);
      }
    };
    osm.buildings.forEach(([x, z, w, d, ang], i) => {
      const s = hash(i + x * 0.01);
      const area = w * d;
      if (area < 12 || w > 400 || d > 400 || skip(x, z)) return;
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
      addHouse(x, z, w, d, ang, s, i, urban);
    });

    // Small towns are barely mapped in OSM: infill homes along residential
    // streets in built-up land cover, skipping lots that already hold a building.
    const occ = new Set<number>();
    const key = (x: number, z: number) => Math.floor(x / 16) * 100003 + Math.floor(z / 16);
    for (const [x, z] of osm.buildings) occ.add(key(x, z));
    const isUrban = (x: number, z: number) => {
      const lc = hf.landcover(x, z);
      return lc >= LC.URBAN_LOW && lc <= LC.URBAN_HIGH;
    };
    let seed = 1;
    for (const road of osm.roads) {
      const res = road.kind === 'residential';
      const town = res || road.kind === 'tertiary' || road.kind === 'secondary' || road.kind === 'unclassified';
      if (!town) continue;
      const p = road.pts;
      let lamp = 0;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const dx = p[k + 2] - p[k];
        const dz = p[k + 3] - p[k + 1];
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const ux = dx / len;
        const uz = dz / len;
        const ang = Math.atan2(uz, ux);
        for (let t = 8; t < len; t += 21) {
          const cx = p[k] + ux * t;
          const cz = p[k + 1] + uz * t;
          if (!isUrban(cx, cz)) continue;
          lamp += 21;
          if (lamp > 70) {
            lamp = 0;
            const sx = cx - uz * 6;
            const sz = cz + ux * 6;
            // Mix of old high-pressure sodium and newer LED streetlights.
            const led = hash(seed * 1.3) < 0.4;
            this.lights.push(sx, hf.height(sx, sz) + 8, sz, led ? 0.85 : 1, led ? 0.88 : 0.48, led ? 0.9 : 0.12, 1.6, 0);
          }
          if (!res) continue;
          for (const side of [-1, 1]) {
            const s = hash(seed++);
            if (s < 0.12) continue;
            const off = 17 + s * 4;
            const hx = cx - uz * off * side;
            const hz = cz + ux * off * side;
            const kk = key(hx, hz);
            if (occ.has(kk) || !isUrban(hx, hz) || skip(hx, hz)) continue;
            occ.add(kk);
            addHouse(hx, hz, 13 + s * 6, 10 + s * 4, ang, s, seed, true);
          }
        }
      }
    }

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

    // Transmission pylons (metres-scale geometry; wall colour tints insulators and wood).
    for (const t of pylons) {
      const lattice = t.type === PYLON.LATTICE;
      push(KIND.TOWER, t.x, t.z, 1, 1, 1, t.ang, lattice ? '#5e6b70' : '#6a5440', '#4e5a5e', 0, 0.5, lattice ? 4 : 5);
    }

    // Split each kind into spatial tiles so the GPU only draws what's in view.
    geos.forEach((base, k) => {
      const byTile = new Map<number, number[][]>();
      for (const r of data[k]) {
        const key = k === KIND.TOWER ? -1 : Math.floor(r[0] / PROP_TILE) * 1000 + Math.floor(r[2] / PROP_TILE);
        const l = byTile.get(key);
        if (l) l.push(r);
        else byTile.set(key, [r]);
      }
      for (const rows of byTile.values()) {
        const g = new THREE.InstancedBufferGeometry();
        for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]);
        const n = rows.length;
        const t0 = new Float32Array(n * 4);
        const t1 = new Float32Array(n * 4);
        const wall = new Float32Array(n * 4);
        const roof = new Float32Array(n * 4);
        const box = new THREE.Box3();
        rows.forEach((r, i) => {
          t0.set(r.slice(0, 4), i * 4);
          t1.set(r.slice(4, 8), i * 4);
          wall.set(r.slice(8, 12), i * 4);
          roof.set(r.slice(12, 16), i * 4);
          const metres = k >= 4;
          const e = metres ? 9 : Math.max(r[4], r[6]);
          box.expandByPoint(new THREE.Vector3(r[0] - e, r[1], r[2] - e));
          box.expandByPoint(new THREE.Vector3(r[0] + e, r[1] + (metres ? 41 : r[5]), r[2] + e));
        });
        g.setAttribute('aT0', new THREE.InstancedBufferAttribute(t0, 4));
        g.setAttribute('aT1', new THREE.InstancedBufferAttribute(t1, 4));
        g.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 4));
        g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 4));
        g.instanceCount = n;
        g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        g.boundingBox = box;
        const mesh = new THREE.Mesh(g, this.material);
        this.group.add(mesh);
        this.batches.push({ geo: g, mesh, center: g.boundingSphere.center, radius: g.boundingSphere.radius, tower: k === KIND.TOWER });
      }
    });
  }

  /** Distance-culls far tiles and limits shadow casting to tiles near the focus. */
  update(cam: THREE.Vector3, focus: THREE.Vector3) {
    for (const b of this.batches) {
      const d = Math.hypot(b.center.x - cam.x, b.center.z - cam.z) - b.radius;
      b.mesh.visible = b.tower || d < 14000;
      if (b.caster) b.caster.visible = Math.hypot(b.center.x - focus.x, b.center.z - focus.z) - b.radius < 700;
    }
  }

  addShadowCasters(shadow: ShadowMap) {
    for (const b of this.batches) b.caster = shadow.addCaster(b.geo, this.shadowMaterial);
  }
}
