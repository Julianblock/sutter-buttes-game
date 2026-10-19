import type { CemeteryPlan } from './cemetery';
import type { OsmData } from './meta';
import type { Town } from './town';

export interface Destination {
  id: string;
  label: string;
  blurb: string;
  group: 'Towns' | 'Marysville' | 'The Buttes';
}

/** Valley towns: start over the town centre as mapped in OSM `place` nodes. */
const TOWNS: Record<string, string> = {
  'Yuba City': 'yubacity',
  Colusa: 'colusa',
  'Live Oak': 'liveoak',
  Gridley: 'gridley',
  Sutter: 'sutter',
  Biggs: 'biggs',
  Princeton: 'princeton',
  Olivehurst: 'olivehurst',
  'Plumas Lake': 'plumaslake',
};

export const DESTINATIONS: Destination[] = [
  { group: 'Towns', id: 'yubacity', label: 'Yuba City', blurb: 'Sutter County seat across the Feather from Marysville, ringed by peach and prune orchards.' },
  { group: 'Towns', id: 'colusa', label: 'Colusa', blurb: 'Colusa County seat on the Sacramento River, west of the Buttes. Snow geese fill the refuges in winter.' },
  { group: 'Towns', id: 'liveoak', label: 'Live Oak', blurb: 'Small farm town on Highway 99 between Yuba City and Gridley.' },
  { group: 'Towns', id: 'gridley', label: 'Gridley', blurb: 'Butte County orchard town north of the Buttes, known for its kiwifruit.' },
  { group: 'Towns', id: 'sutter', label: 'Sutter', blurb: 'The village at the south foot of the Buttes, where Pass Road begins.' },
  { group: 'Towns', id: 'biggs', label: 'Biggs', blurb: 'Rice country, home of the California Rice Experiment Station.' },
  { group: 'Towns', id: 'princeton', label: 'Princeton', blurb: 'Sacramento River village north of Colusa.' },
  { group: 'Towns', id: 'olivehurst', label: 'Olivehurst', blurb: 'Yuba County town south of Marysville along Highway 70.' },
  { group: 'Towns', id: 'plumaslake', label: 'Plumas Lake', blurb: 'New neighbourhoods on the old Feather River farmland south of Olivehurst.' },
  {
    group: 'Marysville',
    id: 'marysville',
    label: 'Downtown Marysville',
    blurb: 'D Street through the Gold Rush brick blocks of the old river port, busiest after dark.',
  },
  {
    group: 'Marysville',
    id: 'bridge',
    label: 'Twin Cities Memorial Bridge',
    blurb: 'The Fifth Street crossing of the Feather River from Yuba City, beside the 1907 Northern Electric truss bridge.',
  },
  { group: 'Marysville', id: 'stjoseph', label: 'St. Joseph Church', blurb: 'The 1855 cathedral on C Street, its white steeple 100 feet over Marysville.' },
  { group: 'The Buttes', id: 'pass', label: 'Pass Road', blurb: 'The county road over the saddle through the middle of the range.' },
  {
    group: 'The Buttes',
    id: 'northbutte',
    label: 'North Butte Road',
    blurb: 'Skirts the north foot of the Buttes past orchards, ranch gates and the old cemeteries.',
  },
  {
    group: 'The Buttes',
    id: 'cemetery',
    label: 'North Butte Cemetery',
    blurb: 'The "witches\' cemetery": a pioneer burial ground at the end of a long dirt lane. Closed sunset to sunrise.',
  },
  {
    group: 'The Buttes',
    id: 'track',
    label: 'Ranch track to North Butte',
    blurb: 'Private dirt tracks climbing the oak slopes toward North Butte itself.',
  },
  {
    group: 'The Buttes',
    id: 'westbutte',
    label: 'West Butte Road',
    blurb: 'Gravel-edged county road around the west side, past Noyesburg Cemetery.',
  },
];

const NORTH_BUTTE: [number, number] = [2467, -3392];
const TRACK_FOOT: [number, number] = [2400, -9300];

const ROAD_ANCHORS: Record<string, [string, number, number]> = {
  pass: ['Pass Road', -500, 2600],
  northbutte: ['North Butte Road', -2788, -9412],
  westbutte: ['West Butte Road', -6600, -3000],
  marysville: ['D Street', 19540, 7380],
  bridge: ['Twin Cities Memorial Bridge', 17990, 7350],
};

export interface Spot {
  x: number;
  z: number;
  psi: number;
  /** On a two-way road: keep right of the centreline. */
  road: boolean;
  /** Bird start height above the ground (m). */
  alt?: number;
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

export function resolveDestination(id: string, osm: OsmData, cemeteries: CemeteryPlan[], town?: Town | null): Spot | null {
  if (id === 'stjoseph') {
    // On C Street, looking at the church front.
    const l = town?.landmark('stjoseph');
    if (!l) return null;
    const s = nearestOn(osm, (n) => n === 'C Street', l.x, l.z);
    if (!s) return null;
    return { x: s.x, z: s.z, psi: Math.atan2(l.x - s.x, l.z - s.z), road: false };
  }
  const townName = Object.keys(TOWNS).find((n) => TOWNS[n] === id);
  if (townName) {
    // On the main street nearest the town centre, high enough to take it in.
    const p = osm.places.find((q) => q.name === townName);
    if (!p) return null;
    const s = nearestOn(osm, (n, k) => !!n && k !== 'track' && k !== 'service', p.x, p.z);
    return s && { x: s.x, z: s.z, psi: Math.atan2(s.dx, s.dz), road: true, alt: 120 };
  }
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
