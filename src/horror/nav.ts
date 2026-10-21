/**
 * Distance-to-target flow field on a 1 m grid around the player. Anything
 * standing on it walks downhill toward the target and routes around walls,
 * trunks and water instead of through them.
 */
export class FlowField {
  readonly n: number;
  readonly cell = 1;
  /** World position of cell (0, 0)'s corner. */
  x0 = 0;
  z0 = 0;
  /** Steps to the target per cell; 65535 = unreachable or blocked. */
  private dist: Uint16Array;
  private blocked: Uint8Array;
  private queue: Int32Array;
  private cx = Infinity;
  private cz = Infinity;
  private age = Infinity;

  constructor(
    n: number,
    private isBlocked: (x: number, z: number) => boolean,
  ) {
    this.n = n;
    this.dist = new Uint16Array(n * n);
    this.blocked = new Uint8Array(n * n);
    this.queue = new Int32Array(n * n);
  }

  /** Rebuilds when the target has moved a few metres or the field is stale. */
  update(dt: number, tx: number, tz: number) {
    this.age += dt;
    const moved = Math.hypot(tx - this.cx, tz - this.cz);
    if (moved < 1.5 && this.age < 0.5) return;
    if (moved > 12 || !Number.isFinite(this.cx)) this.rasterise(tx, tz);
    this.age = 0;
    this.cx = tx;
    this.cz = tz;
    this.solve(tx, tz);
  }

  private rasterise(tx: number, tz: number) {
    const n = this.n;
    this.x0 = Math.floor(tx - n / 2);
    this.z0 = Math.floor(tz - n / 2);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) this.blocked[j * n + i] = this.isBlocked(this.x0 + i + 0.5, this.z0 + j + 0.5) ? 1 : 0;
  }

  private solve(tx: number, tz: number) {
    const n = this.n, d = this.dist, q = this.queue;
    // Re-centre the window when the target nears its edge.
    if (Math.abs(tx - this.x0 - n / 2) > n / 2 - 10 || Math.abs(tz - this.z0 - n / 2) > n / 2 - 10) this.rasterise(tx, tz);
    const ti = Math.floor(tx - this.x0), tj = Math.floor(tz - this.z0);
    d.fill(65535);
    let head = 0, tail = 0;
    const start = tj * n + ti;
    d[start] = 0;
    q[tail++] = start;
    while (head < tail) {
      const c = q[head++];
      const ci = c % n, cj = (c - ci) / n;
      const nd = d[c] + 1;
      for (let k = 0; k < 4; k++) {
        const i = ci + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const j = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const o = j * n + i;
        if (this.blocked[o] || d[o] <= nd) continue;
        d[o] = nd;
        q[tail++] = o;
      }
    }
  }

  /** Steps to the target from (x, z), Infinity when off the field or cut off. */
  at(x: number, z: number) {
    const i = Math.floor(x - this.x0), j = Math.floor(z - this.z0);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return Infinity;
    const v = this.dist[j * this.n + i];
    return v === 65535 ? Infinity : v;
  }

  isWall(x: number, z: number) {
    const i = Math.floor(x - this.x0), j = Math.floor(z - this.z0);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return this.blocked[j * this.n + i] === 1;
  }

  /** Unit direction downhill from (x, z), or null when there is no way through. */
  dir(x: number, z: number): [number, number] | null {
    const here = this.at(x, z);
    if (!Number.isFinite(here)) return null;
    let best = here, bx = 0, bz = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      const v = this.at(x + dx, z + dz);
      if (v < best) (best = v), (bx = dx), (bz = dz);
    }
    if (best === here) return null;
    return [bx, bz];
  }
}
