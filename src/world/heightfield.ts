import type { Decks } from './decks';
import type { HeightGrid, Pixels, WorldData } from './loader';
import { LC } from './meta';

function bilinear(g: HeightGrid, arr: Float32Array, x: number, z: number): number {
  const fx = (x / g.size + 0.5) * g.res - 0.5;
  const fz = (z / g.size + 0.5) * g.res - 0.5;
  const x0 = Math.max(0, Math.min(g.res - 2, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(g.res - 2, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - x0));
  const tz = Math.min(1, Math.max(0, fz - z0));
  const i = z0 * g.res + x0;
  const a = arr[i] + (arr[i + 1] - arr[i]) * tx;
  const b = arr[i + g.res] + (arr[i + g.res + 1] - arr[i + g.res]) * tx;
  return a + (b - a) * tz;
}

/** Weight of a region at (x,z): 1 well inside, fading to 0 across its outer margin. */
export function regionWeight(size: number, x: number, z: number, margin = 0.06): number {
  const e = Math.max(Math.abs(x), Math.abs(z)) / (size / 2);
  const t = (1 - e) / margin;
  return Math.min(1, Math.max(0, t));
}

/** CPU-side terrain queries that mirror the GPU terrain shader exactly. */
export class Heightfield {
  readonly inner: HeightGrid;
  readonly mid: HeightGrid;
  readonly far: HeightGrid;
  private readonly lc: Pixels;
  private readonly lcSize: number;
  private readonly canopy: Pixels;
  /** Bridge decks over the rivers, when a town has them. */
  decks: Decks | null = null;

  constructor(world: WorldData) {
    this.inner = world.heights.inner;
    this.mid = world.heights.mid;
    this.far = world.heights.far;
    this.lc = world.landcover;
    this.lcSize = world.meta.landcover.size;
    this.canopy = world.canopy;
  }

  height(x: number, z: number): number {
    const wi = regionWeight(this.inner.size, x, z);
    const wm = regionWeight(this.mid.size, x, z);
    let h = bilinear(this.far, this.far.heights, x, z);
    if (wm > 0) h += (bilinear(this.mid, this.mid.heights, x, z) - h) * wm;
    if (wi > 0) h += (bilinear(this.inner, this.inner.heights, x, z) - h) * wi;
    return h;
  }

  /** Road surface for travel along heading (hx, hz): a bridge deck where there is one. */
  roadHeight(x: number, z: number, hx: number, hz: number, nearY?: number): number {
    return this.decks?.at(x, z, hx, hz, nearY) ?? this.height(x, z);
  }

  ao(x: number, z: number): number {
    const wi = regionWeight(this.inner.size, x, z);
    const wm = regionWeight(this.mid.size, x, z);
    let a = 1;
    if (wm > 0) a += (bilinear(this.mid, this.mid.ao, x, z) - a) * wm;
    if (wi > 0) a += (bilinear(this.inner, this.inner.ao, x, z) - a) * wi;
    return a;
  }

  normal(x: number, z: number, out: { x: number; y: number; z: number }, e = 4) {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l;
    out.y = (2 * e) / l;
    out.z = -hz / l;
    return out;
  }

  landcover(x: number, z: number): number {
    const r = this.lc.width;
    const i = Math.floor((x / this.lcSize + 0.5) * r);
    const j = Math.floor((z / this.lcSize + 0.5) * r);
    if (i < 0 || j < 0 || i >= r || j >= r) return LC.OTHER;
    return this.lc.data[(j * r + i) * 4];
  }

  /** 0..1 fraction of oak canopy detected in the aerial photo. */
  canopyDensity(x: number, z: number): number {
    const r = this.canopy.width;
    const s = this.inner.size;
    const i = Math.floor((x / s + 0.5) * r);
    const j = Math.floor((z / s + 0.5) * r);
    if (i < 0 || j < 0 || i >= r || j >= r) return 0;
    return this.canopy.data[(j * r + i) * 4] / 255;
  }
}
