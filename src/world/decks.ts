/**
 * Bridge decks that roads, traffic and the truck ride over instead of the
 * river bed below. A deck only applies when travelling along it, so roads
 * that pass underneath stay on the ground.
 */
export interface Deck {
  /** Centreline x0, z0, x1, z1… */
  pts: Float32Array;
  /** Deck surface height at each centreline vertex. */
  y: Float32Array;
  half: number;
}

interface Seg {
  d: Deck;
  i: number;
}

const CELL = 40;

export class Decks {
  readonly list: Deck[] = [];
  private grid = new Map<number, Seg[]>();

  private key(i: number, j: number) {
    return i * 100003 + j;
  }

  add(d: Deck) {
    this.list.push(d);
    const p = d.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const r = d.half + 1;
      const i0 = Math.floor((Math.min(p[i], p[i + 2]) - r) / CELL);
      const i1 = Math.floor((Math.max(p[i], p[i + 2]) + r) / CELL);
      const j0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - r) / CELL);
      const j1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + r) / CELL);
      for (let a = i0; a <= i1; a++) {
        for (let b = j0; b <= j1; b++) {
          const k = this.key(a, b);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push({ d, i });
        }
      }
    }
  }

  /**
   * Deck height under (x, z) for something heading (hx, hz), or null when off
   * every deck or crossing one at an angle. `nearY` rejects decks far above
   * or below whatever is asking (a truck wading under the span).
   */
  at(x: number, z: number, hx = 0, hz = 0, nearY?: number): number | null {
    const l = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return null;
    const hl = Math.hypot(hx, hz);
    let best: number | null = null;
    let bestD = Infinity;
    for (const { d, i } of l) {
      const p = d.pts;
      const ex = p[i + 2] - p[i];
      const ez = p[i + 3] - p[i + 1];
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (z - p[i + 1]) * ez) / l2));
      const dist = Math.hypot(p[i] + ex * t - x, p[i + 1] + ez * t - z);
      if (dist > d.half + 0.6 || dist >= bestD) continue;
      if (hl > 0 && Math.abs(ex * hx + ez * hz) / (Math.sqrt(l2) * hl) < 0.7) continue;
      const y = d.y[i / 2] + (d.y[i / 2 + 1] - d.y[i / 2]) * t;
      if (nearY !== undefined && Math.abs(y - nearY) > 3) continue;
      best = y;
      bestD = dist;
    }
    return best;
  }
}
