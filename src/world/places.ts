import type { OsmData } from './meta';

interface Area {
  name: string;
  x: number;
  z: number;
  r: number;
  note?: string;
}

// Local coordinates (m, x east / z south) of named landscapes without OSM points.
const AREAS: Area[] = [
  { name: 'Peace Valley', x: 900, z: -2100, r: 1100, note: 'The hidden valley inside the Buttes' },
  { name: 'Moat', x: 400, z: -1500, r: 4200, note: 'Ring valley around the volcanic core' },
  { name: 'Butte Sink', x: -7300, z: -5000, r: 3600, note: 'Flooded duck clubs and tule marsh' },
  { name: 'Gray Lodge Wildlife Area', x: -2200, z: -12700, r: 3200, note: 'Winter home of 100,000 snow geese' },
  { name: 'Sutter National Wildlife Refuge', x: 4700, z: 11600, r: 3200, note: 'Bypass wetlands south of the Buttes' },
  { name: 'Sutter Bypass', x: -3500, z: 9000, r: 2200, note: 'Flood channel lined with cottonwoods' },
  { name: 'Feather River', x: 17800, z: 3000, r: 1500 },
];

const HIDDEN_ROADS = new Set(['CA 99', 'State Highway 20', 'Route 20', 'Colusa Highway', 'Pass Road', 'West Butte Road', 'South Butte Road', 'North Butte Road', 'East Butte Road', 'Butte House Road', 'Township Road', 'North Township Road', 'South Township Road', 'Garden Highway']);

export interface PlaceInfo {
  title: string;
  subtitle: string;
}

/** Names the landscape under the bird: peaks, valleys, refuges, towns and roads. */
export class Places {
  private roadGrid = new Map<string, { name: string; ax: number; az: number; bx: number; bz: number }[]>();
  private readonly cell = 250;

  constructor(private osm: OsmData) {
    for (const r of osm.roads) {
      if (!r.name || !HIDDEN_ROADS.has(r.name)) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const seg = { name: r.name, ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3] };
        const k = this.key((seg.ax + seg.bx) / 2, (seg.az + seg.bz) / 2);
        let list = this.roadGrid.get(k);
        if (!list) this.roadGrid.set(k, (list = []));
        list.push(seg);
      }
    }
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  nearestRoad(x: number, z: number, maxDist: number): string | null {
    let best = maxDist;
    let name: string | null = null;
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = this.roadGrid.get(`${ci + di},${cj + dj}`);
        if (!list) continue;
        for (const s of list) {
          const dx = s.bx - s.ax;
          const dz = s.bz - s.az;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz + 1e-6)));
          const d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
          if (d < best) {
            best = d;
            name = s.name;
          }
        }
      }
    }
    return name;
  }

  at(x: number, z: number, agl: number): PlaceInfo {
    let peak: { name: string; ele: number | null } | null = null;
    let pd = 650;
    for (const p of this.osm.peaks) {
      if (!p.name) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < pd) {
        pd = d;
        peak = p;
      }
    }
    if (peak) {
      const sub = peak.ele ? `${peak.ele} m · ${Math.round(peak.ele * 3.281)} ft summit` : 'Sutter Buttes';
      return { title: peak.name, subtitle: sub };
    }

    for (const a of AREAS) {
      if (Math.hypot(a.x - x, a.z - z) < a.r) {
        const road = agl < 200 ? this.nearestRoad(x, z, 70) : null;
        return { title: a.name, subtitle: road ? `Above ${road}` : a.note ?? 'Sutter Buttes' };
      }
    }

    let town: { name: string; d: number } | null = null;
    for (const p of this.osm.places) {
      const reach = p.kind === 'city' ? 4000 : p.kind === 'town' ? 2600 : p.kind === 'village' ? 1600 : 900;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < reach && (!town || d < town.d)) town = { name: p.name, d };
    }
    const road = agl < 250 ? this.nearestRoad(x, z, 80) : null;
    const distCore = Math.hypot(x - 300, z + 1600);
    if (town) return { title: town.name, subtitle: road ? `Above ${road}` : 'Sacramento Valley' };
    if (distCore < 7000) return { title: 'Sutter Buttes', subtitle: road ? `Above ${road}` : 'The smallest mountain range in the world' };
    const dir = compassWord(Math.atan2(x - 300, -(z + 1600)));
    return { title: 'Sacramento Valley', subtitle: road ? `Above ${road}` : `${(distCore / 1000).toFixed(0)} km ${dir} of the Buttes` };
  }
}

export function compassWord(rad: number): string {
  const names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const i = Math.round(((rad / (Math.PI * 2)) * 8 + 8) % 8) % 8;
  return names[i];
}
