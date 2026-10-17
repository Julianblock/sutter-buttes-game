import type { Heightfield } from '../world/heightfield';
import { LC } from '../world/meta';

const CELL = 650;
const CYCLE = 540; // seconds a thermal lives before the cell re-seeds

function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Thermal {
  x: number;
  z: number;
  radius: number;
  strength: number;
  top: number;
}

/**
 * Rising air: drifting thermal columns over sun-heated ground and ridge lift
 * where the wind meets the slopes of the Buttes.
 */
export class AirField {
  sun = 1; // 0..1 thermal-generating insolation
  windX = 3;
  windZ = 1.2;
  thermalTop = 1600;
  time = 0;
  lastThermal = 0;
  lastRidge = 0;
  private n = { x: 0, y: 1, z: 0 };

  constructor(private hf: Heightfield) {}

  /** Thermal in a grid cell (or null). Deterministic for a given time. */
  thermalAt(ci: number, cj: number, out: Thermal): Thermal | null {
    const epoch = Math.floor((this.time + hash(ci, cj, 7) * CYCLE) / CYCLE);
    const h0 = hash(ci, cj, epoch);
    if (h0 < 0.42) return null;
    const life = ((this.time + hash(ci, cj, 7) * CYCLE) % CYCLE) / CYCLE;
    const env = Math.sin(Math.PI * life);
    const bx = (ci + 0.2 + 0.6 * hash(ci, cj, epoch + 11)) * CELL;
    const bz = (cj + 0.2 + 0.6 * hash(ci, cj, epoch + 23)) * CELL;
    const drift = life * CYCLE * 0.35;
    out.x = bx + this.windX * drift;
    out.z = bz + this.windZ * drift;
    const lc = this.hf.landcover(bx, bz);
    let surf = 1;
    if (lc === LC.WATER || lc === LC.WETLAND) surf = 0.15;
    else if (lc === LC.RICE) surf = 0.45;
    else if (lc === LC.GRASS || lc === LC.FALLOW || lc >= LC.URBAN_LOW && lc <= LC.URBAN_HIGH) surf = 1.25;
    out.radius = 55 + 110 * hash(ci, cj, epoch + 5);
    out.strength = (1.4 + 3.2 * hash(ci, cj, epoch + 3)) * env * surf * this.sun;
    out.top = this.thermalTop * (0.75 + 0.5 * hash(ci, cj, epoch + 9));
    return out.strength > 0.05 ? out : null;
  }

  private th: Thermal = { x: 0, z: 0, radius: 0, strength: 0, top: 0 };

  /** Vertical air velocity (m/s) at a world position. */
  lift(x: number, y: number, z: number): number {
    const ground = this.hf.height(x, z);
    const agl = y - ground;
    let w = 0;
    if (this.sun > 0.02) {
      const ci = Math.floor(x / CELL);
      const cj = Math.floor(z / CELL);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const t = this.thermalAt(ci + di, cj + dj, this.th);
          if (!t) continue;
          const dx = x - t.x;
          const dz = z - t.z;
          const r2 = (dx * dx + dz * dz) / (t.radius * t.radius);
          if (r2 > 16) continue;
          // Core updraft ringed by gentle sink.
          const prof = Math.exp(-r2) - 0.18 * Math.exp(-r2 / 6);
          const vert = Math.min(1, Math.max(0, agl / 50)) * (1 - smoothstep(t.top - 250, t.top, y));
          w += t.strength * prof * vert;
        }
      }
      // Broad weak sink between thermals on sunny days.
      w -= 0.25 * this.sun;
    }
    // Ridge (orographic) lift: wind blowing up the slope.
    this.hf.normal(x, z, this.n, 12);
    const slopeUp = -(this.n.x * this.windX + this.n.z * this.windZ) / Math.max(this.n.y, 0.2);
    const ridge = slopeUp * Math.exp(-Math.max(agl, 0) / 180);
    this.lastThermal = w;
    this.lastRidge = ridge;
    return w + ridge;
  }
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
