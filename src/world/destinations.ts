import type { CemeteryPlan } from './cemetery';
import type { OsmData } from './meta';

export interface Destination {
  id: string;
  label: string;
  blurb: string;
}

export const DESTINATIONS: Destination[] = [
  { id: 'pass', label: 'Pass Road', blurb: 'The county road over the saddle through the middle of the range.' },
  { id: 'northbutte', label: 'North Butte Road', blurb: 'Skirts the north foot of the Buttes past orchards, ranch gates and the old cemeteries.' },
  {
    id: 'cemetery',
    label: 'North Butte Cemetery',
    blurb: 'The "witches\' cemetery": a pioneer burial ground at the end of a long dirt lane. Closed sunset to sunrise.',
  },
  { id: 'track', label: 'Ranch track to North Butte', blurb: 'Private dirt tracks climbing the oak slopes toward North Butte itself.' },
  { id: 'westbutte', label: 'West Butte Road', blurb: 'Gravel-edged county road around the west side, past Noyesburg Cemetery.' },
];

const NORTH_BUTTE: [number, number] = [2467, -3392];
const TRACK_FOOT: [number, number] = [2400, -9300];

const ROAD_ANCHORS: Record<string, [string, number, number]> = {
  pass: ['Pass Road', -500, 2600],
  northbutte: ['North Butte Road', -2788, -9412],
  westbutte: ['West Butte Road', -6600, -3000],
};

export interface Spot {
  x: number;
  z: number;
  psi: number;
  /** On a two-way road: keep right of the centreline. */
  road: boolean;
}

/** Point on the matching roads closest to (ax, az), with the segment heading. */
function nearestOn(osm: OsmData, match: (name: string, kind: string) => boolean, ax: number, az: number) {
  let best = Infinity;
  let spot: { x: number; z: number; dx: number; dz: number } | null = null;
  for (const r of osm.roads) {
    if (!match(r.name, r.kind)) continue;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i], ez = p[i + 3] - p[i + 1];
      const l2 = ex * ex + ez * ez;
      if (l2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((ax - p[i]) * ex + (az - p[i + 1]) * ez) / l2));
      const x = p[i] + ex * t, z = p[i + 1] + ez * t;
      const d = Math.hypot(ax - x, az - z);
      if (d < best) {
        best = d;
        const l = Math.sqrt(l2);
        spot = { x, z, dx: ex / l, dz: ez / l };
      }
    }
  }
  return spot;
}

export function resolveDestination(id: string, osm: OsmData, cemeteries: CemeteryPlan[]): Spot | null {
  const anchor = ROAD_ANCHORS[id];
  if (anchor) {
    const s = nearestOn(osm, (n) => n === anchor[0], anchor[1], anchor[2]);
    return s && { x: s.x, z: s.z, psi: Math.atan2(s.dx, s.dz), road: true };
  }
  if (id === 'cemetery') {
    const c = cemeteries.find((p) => p.name === 'North Butte Cemetery');
    if (!c?.gate) return null;
    const [ox, oz] = c.out;
    return { x: c.gate[0] + ox * 45, z: c.gate[1] + oz * 45, psi: Math.atan2(-ox, -oz), road: false };
  }
  if (id === 'track') {
    // The graded ranch road leaving North Butte Road for the summit slopes.
    const [px, pz] = NORTH_BUTTE;
    const s = nearestOn(osm, (n, k) => k === 'track' && !n, TRACK_FOOT[0], TRACK_FOOT[1]);
    if (!s) return null;
    // Face uphill, toward the summit.
    const up = s.dx * (px - s.x) + s.dz * (pz - s.z) >= 0 ? 1 : -1;
    return { x: s.x, z: s.z, psi: Math.atan2(s.dx * up, s.dz * up), road: false };
  }
  return null;
}
