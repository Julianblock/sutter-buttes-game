import * as THREE from 'three';
import { G } from '../render/globals';
import { roadFragment, roadVertex } from '../render/shaders/roadShader';
import type { Heightfield } from './heightfield';
import type { OsmData, OsmRoad } from './meta';

const TILE = 3000;
const STEP = 12;

/** Paved half width (m) and marking style per road class. */
function spec(r: OsmRoad): { half: number; style: number; rank: number } {
  const lanes = r.lanes || 0;
  switch (r.kind) {
    case 'motorway':
      return { half: 1.85 * Math.max(2, lanes) + 1.4, style: 4, rank: 6 };
    case 'trunk':
      return r.oneway ? { half: 1.85 * Math.max(2, lanes) + 1.2, style: 4, rank: 5 } : { half: 4.6, style: 3, rank: 5 };
    case 'primary':
    case 'secondary':
      return { half: 4.2, style: 2, rank: 4 };
    case 'tertiary':
      return { half: 3.3, style: 1, rank: 3 };
    case 'unclassified':
      return { half: 2.8, style: 0, rank: 1 };
    default:
      return { half: 4.0, style: 0, rank: 0 };
  }
}

interface Builder {
  pos: number[];
  road: number[];
  info: number[];
  nz: number[];
  idx: number[];
}

/** Asphalt ribbons with markings draped over the heightfield along every OSM road. */
export class Roads {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;

  constructor(osm: OsmData, hf: Heightfield, radius = 24000) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: roadVertex,
      fragmentShader: roadFragment,
      uniforms: { ...G },
      transparent: true,
      depthWrite: false,
    });
    const tiles = new Map<number, Builder>();
    const tileOf = (x: number, z: number) => {
      const k = Math.floor(x / TILE) * 1000 + Math.floor(z / TILE);
      let b = tiles.get(k);
      if (!b) {
        b = { pos: [], road: [], info: [], nz: [], idx: [] };
        tiles.set(k, b);
      }
      return b;
    };
    const nrm = { x: 0, y: 1, z: 0 };
    // Draw minor roads first so bigger ones blend on top at junctions.
    const roads = osm.roads.filter((r) => r.pts.length >= 4 && Math.hypot(r.pts[0], r.pts[1]) < radius);
    roads.sort((a, b) => spec(a).rank - spec(b).rank);
    for (const r of roads) {
      const { half, style, rank } = spec(r);
      const w = half / 0.85;
      // Resample the polyline so the ribbon follows the terrain.
      const pts: number[] = [];
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i];
        const dz = p[i + 3] - p[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
        for (let k = 0; k < n; k++) pts.push(p[i] + (dx * k) / n, p[i + 1] + (dz * k) / n);
      }
      pts.push(p[p.length - 2], p[p.length - 1]);
      const m = pts.length / 2;
      if (m < 2) continue;
      const b = tileOf(pts[0], pts[1]);
      const base = b.pos.length / 3;
      let along = 0;
      for (let i = 0; i < m; i++) {
        const x = pts[i * 2];
        const z = pts[i * 2 + 1];
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(m - 1, i + 1);
        let tx = pts[i1 * 2] - pts[i0 * 2];
        let tz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        if (i > 0) along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
        hf.normal(x, z, nrm, 3);
        for (const s of [-1, 1]) {
          const vx = x - tz * w * s;
          const vz = z + tx * w * s;
          b.pos.push(vx, hf.height(vx, vz) + 0.15, vz);
          b.road.push(s, along);
          b.info.push(half, style, rank, nrm.x);
          b.nz.push(nrm.z);
        }
        if (i < m - 1) {
          const a = base + i * 2;
          b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    for (const b of tiles.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('aRoad', new THREE.Float32BufferAttribute(b.road, 2));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(b.info, 4));
      g.setAttribute('aNz', new THREE.Float32BufferAttribute(b.nz, 1));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material);
      mesh.renderOrder = -1;
      this.group.add(mesh);
    }
  }
}
