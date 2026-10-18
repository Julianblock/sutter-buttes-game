import type { OsmData } from './meta';
import { roadSpec } from './roads';

export interface RoadHit {
  dist: number;
  /** Closest point on the road centreline. */
  x: number;
  z: number;
  /** Unit direction of the segment. */
  dx: number;
  dz: number;
  name: string;
  kind: string;
  /** Approximate paved half-width (m). */
  halfWidth: number;
}

const CELL = 120;

/** Grid-hashed road segments for nearest-road queries (spawning, grip, HUD). */
export class RoadIndex {
  private cells = new Map<number, number[]>();
  private seg: Float32Array;
  private meta: { name: string; kind: string; half: number }[] = [];
  private segRoad: Uint32Array;

  constructor(osm: OsmData) {
    const s: number[] = [];
    const r: number[] = [];
    osm.roads.forEach((road, ri) => {
      this.meta.push({ name: road.name, kind: road.kind, half: roadSpec(road).half });
      const p = road.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const id = s.length / 4;
        s.push(p[k], p[k + 1], p[k + 2], p[k + 3]);
        r.push(ri);
        const x0 = Math.floor(Math.min(p[k], p[k + 2]) / CELL);
        const x1 = Math.floor(Math.max(p[k], p[k + 2]) / CELL);
        const z0 = Math.floor(Math.min(p[k + 1], p[k + 3]) / CELL);
        const z1 = Math.floor(Math.max(p[k + 1], p[k + 3]) / CELL);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const key = cx * 100003 + cz;
            const l = this.cells.get(key);
            if (l) l.push(id);
            else this.cells.set(key, [id]);
          }
      }
    });
    this.seg = new Float32Array(s);
    this.segRoad = new Uint32Array(r);
  }

  /** Nearest road within `radius` metres, or null. */
  nearest(x: number, z: number, radius = 60, filter?: (kind: string) => boolean): RoadHit | null {
    const rc = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best: RoadHit | null = null;
    let bestD = radius;
    const seen = new Set<number>();
    for (let i = -rc; i <= rc; i++)
      for (let j = -rc; j <= rc; j++) {
        const l = this.cells.get((cx + i) * 100003 + (cz + j));
        if (!l) continue;
        for (const id of l) {
          if (seen.has(id)) continue;
          seen.add(id);
          const m = this.meta[this.segRoad[id]];
          if (filter && !filter(m.kind)) continue;
          const o = id * 4;
          const ax = this.seg[o], az = this.seg[o + 1], bx = this.seg[o + 2], bz = this.seg[o + 3];
          const ex = bx - ax, ez = bz - az;
          const len2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
          const px = ax + ex * t, pz = az + ez * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < bestD) {
            bestD = d;
            const len = Math.sqrt(len2);
            best = { dist: d, x: px, z: pz, dx: ex / len, dz: ez / len, name: m.name, kind: m.kind, halfWidth: m.half };
          }
        }
      }
    return best;
  }

  /** Nearest road searching outward up to `max` metres. */
  find(x: number, z: number, max = 6000, filter?: (kind: string) => boolean): RoadHit | null {
    for (let r = 150; r <= max; r *= 2) {
      const h = this.nearest(x, z, r, filter);
      if (h) return h;
    }
    return null;
  }
}
