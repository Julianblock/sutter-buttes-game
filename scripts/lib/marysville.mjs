// Marysville: true building footprints, bridges, sidewalks and nightlife from
// OpenStreetMap, for the detailed town east of the Buttes across the Feather.

import path from 'node:path';
import { latLonToLocal, localToLatLon } from './geo.mjs';
import { overpass } from './osm.mjs';

/** Square zone (m) over Marysville, the Feather River bridges and Ellis Lake. */
const CENTER = { lat: 39.144, lon: -121.5895 };
export const TOWN = { name: 'Marysville', ...latLonToLocal(CENTER.lat, CENTER.lon), size: 5200 };

export const KIND = {
  HOUSE: 0,
  COMMERCIAL: 1, // historic downtown brick blocks
  RETAIL: 2, // modern stores, offices and big boxes
  APARTMENTS: 3,
  CIVIC: 4, // schools, courthouse, hospital
  INDUSTRIAL: 5,
  SHED: 6,
  CANOPY: 7, // carports and fuel canopies
  CHURCH: 8,
  TEMPLE: 9,
  HOTEL: 10,
};
export const ROOF = { FLAT: 0, GABLE: 1, HIP: 2 };

// Downtown Marysville (1st to 6th Street, B to E Street) in local metres,
// traced from the OSM street centrelines with a half-block margin.
const CORE = [
  [19430, 7700],
  [19850, 7660],
  [19775, 7010],
  [19360, 7050],
];
// The old residential grid north of downtown, full of two-storey Victorians.
const OLD_TOWN = { x0: 18900, x1: 19950, z0: 5900, z1: 7060 };

const NAME_FIX = { 'Abandon Marysville Hotel': 'Hotel Marysville' };
const LANDMARKS = [
  { id: 'stjoseph', re: /saint joseph catholic/i },
  { id: 'bokkai', re: /bok kai/i },
  { id: 'hotel', re: /hotel marysville/i },
  { id: 'state', re: /^state theatre$/i },
  { id: 'courthouse', re: /yuba county courthouse/i },
  { id: 'chinesemuseum', re: /chinese american museum/i },
  { id: 'aaron', re: /mary aaron/i },
];

const r1 = (v) => Math.round(v * 10) / 10;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function inside(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/** Drops repeated and collinear vertices; returns an open ring wound consistently. */
function cleanRing(raw) {
  let pts = raw.map((g) => {
    const p = latLonToLocal(g.lat, g.lon);
    return [p.x, p.z];
  });
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.05) pts.pop();
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = out.length ? out.at(-1) : pts.at(-1);
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.4) continue;
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (l > 0 && Math.abs(cross) / l < 0.02) continue;
      out.push(b);
    }
    pts = out;
  }
  if (pts.length < 3) return null;
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

/** Oriented bounding box from the longest edge: fill ratio tells a plain box from an L. */
function obb(pts) {
  let best = 0;
  let ang = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (l > best) {
      best = l;
      ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * c + z * s;
    const v = -x * s + z * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { ang, w: u1 - u0, d: v1 - v0, fill: Math.abs(signedArea(pts)) / ((u1 - u0) * (v1 - v0)) };
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function classify(t, area, x, z) {
  const b = t.building;
  const core = inside(CORE, x, z);
  if (b === 'church' || t.amenity === 'place_of_worship') return KIND.CHURCH;
  if (b === 'hotel' || b === 'hotel_building' || /hotel|motel|inn\b/i.test(t.name || '')) return KIND.HOTEL;
  if (b === 'roof' || b === 'carport') return KIND.CANOPY;
  if (b === 'shed' || b === 'garage' || b === 'garages') return KIND.SHED;
  if (b === 'house' || b === 'detached' || b === 'terrace' || b === 'bungalow') return KIND.HOUSE;
  if (b === 'apartments' || b === 'residential' || b === 'dormitory') return KIND.APARTMENTS;
  if (b === 'school' || b === 'hospital' || b === 'civic' || b === 'public' || b === 'grandstand' || t.amenity === 'courthouse' || t.amenity === 'hospital' || t.amenity === 'school') return KIND.CIVIC;
  if (b === 'hangar' || b === 'industrial' || b === 'warehouse' || b === 'greenhouse') return KIND.INDUSTRIAL;
  if (core && area < 2500) return KIND.COMMERCIAL;
  if (b === 'commercial' || b === 'retail' || b === 'office' || b === 'office_building' || t.shop || t.amenity) return KIND.RETAIL;
  if (area < 45) return KIND.SHED;
  if (area < 330) return KIND.HOUSE;
  return area > 900 ? KIND.RETAIL : KIND.APARTMENTS;
}

/** Wall height (m, ground to eave or parapet) and roof form, from tags or by type. */
function massing(kind, t, area, box, x, z, seed) {
  const s = hash(seed);
  const tagH = num(t.height);
  const tagL = num(t['building:levels']);
  const simple = box.fill > 0.8 && box.w < 40 && box.d < 30;
  const pitched = (kind === KIND.HOUSE || kind === KIND.SHED || (kind === KIND.APARTMENTS && area < 900)) && simple;
  const shape = t['roof:shape'];
  let roof = pitched ? (s < 0.55 ? ROOF.GABLE : ROOF.HIP) : ROOF.FLAT;
  if (shape === 'flat') roof = ROOF.FLAT;
  else if (shape === 'gabled' && simple) roof = ROOF.GABLE;
  else if (shape === 'hipped' && simple) roof = ROOF.HIP;
  const storey = kind === KIND.COMMERCIAL || kind === KIND.HOTEL ? 4.0 : 3.1;
  const oldTown = x > OLD_TOWN.x0 && x < OLD_TOWN.x1 && z > OLD_TOWN.z0 && z < OLD_TOWN.z1;

  let levels = tagL;
  let h = tagH != null ? (roof === ROOF.FLAT ? tagH : tagH * 0.72) : null;
  if (levels == null) {
    switch (kind) {
      case KIND.HOUSE:
        levels = oldTown && area > 90 && s < 0.45 ? 2 : area > 260 && s < 0.25 ? 2 : 1;
        break;
      case KIND.COMMERCIAL:
        levels = area > 600 ? (s < 0.5 ? 2 : 3) : s < 0.25 ? 1 : s < 0.82 ? 2 : 3;
        break;
      case KIND.APARTMENTS:
        levels = 2;
        break;
      case KIND.CIVIC:
        levels = t.building === 'hospital' || t.amenity === 'hospital' ? 4 : t.amenity === 'courthouse' ? 3 : area > 2500 ? 2 : 1;
        break;
      case KIND.HOTEL:
        levels = 2;
        break;
      case KIND.CHURCH:
        levels = 1;
        break;
      default:
        levels = 1;
    }
  }
  if (h == null) {
    switch (kind) {
      case KIND.HOUSE:
        h = levels * 3.0 + 0.7; // raised floors against the floods
        break;
      case KIND.SHED:
        h = 2.6 + s * 0.6;
        break;
      case KIND.CANOPY:
        h = t.amenity === 'fuel' || area > 150 ? 5.0 : 2.7;
        break;
      case KIND.COMMERCIAL:
        h = 4.8 + (levels - 1) * 4.0 + 1.0;
        break;
      case KIND.RETAIL:
        h = tagL != null ? levels * 3.8 + 0.8 : area > 4000 ? 8.5 : area > 1200 ? 6.8 : 5.2;
        break;
      case KIND.INDUSTRIAL:
        h = 6.5 + s * 2.5;
        break;
      case KIND.CHURCH:
        h = area > 300 ? 9.5 : 6.5;
        break;
      default:
        h = levels * storey + 0.8;
    }
  }
  return { h: r1(h), levels, roof, tagged: tagH != null || tagL != null };
}

function lineLocal(geometry) {
  const pts = [];
  for (const g of geometry) {
    const p = latLonToLocal(g.lat, g.lon);
    pts.push(r1(p.x), r1(p.z));
  }
  return pts;
}

function polyLength(pts) {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
}

export async function buildMarysville(cacheDir) {
  const h = TOWN.size / 2;
  const nw = localToLatLon(TOWN.x - h, TOWN.z - h);
  const se = localToLatLon(TOWN.x + h, TOWN.z + h);
  const bbox = `${se.lat},${nw.lon},${nw.lat},${se.lon}`;
  const json = await overpass(
    `[out:json][timeout:240];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["bridge"]["highway"](${bbox});
  way["bridge"]["railway"](${bbox});
  way["man_made"="bridge"](${bbox});
  way["highway"~"^(footway|pedestrian|path)$"](${bbox});
  node["amenity"~"^(bar|pub|nightclub|restaurant|cafe|fast_food|theatre|cinema|place_of_worship|ice_cream)$"](${bbox});
  way["amenity"~"^(bar|pub|nightclub|restaurant|cafe|fast_food|theatre|cinema)$"](${bbox});
  node["tourism"~"^(museum|attraction|artwork)$"](${bbox});
  node["historic"](${bbox});
);
out geom;`,
    path.join(cacheDir, 'marysville.json'),
  );

  const nodes = json.elements.filter((e) => e.type === 'node' && e.tags);
  const buildings = [];
  const bridgeOutlines = [];
  const bridges = [];
  const walks = [];
  const spots = [];

  const rings = [];
  for (const e of json.elements) {
    const t = e.tags || {};
    if (t.building && e.type === 'way' && e.geometry) rings.push({ id: e.id, t, geometry: e.geometry });
    if (t.building && e.type === 'relation') {
      for (const m of e.members || []) {
        if (m.role === 'outer' && m.geometry?.length > 3) rings.push({ id: e.id * 10 + rings.length, t, geometry: m.geometry });
      }
    }
    if (t.man_made === 'bridge' && e.geometry) bridgeOutlines.push({ name: t.name || '', loc: t.loc_name || '', pts: cleanRing(e.geometry) });
  }

  for (const { id, t, geometry } of rings) {
    const pts = cleanRing(geometry);
    if (!pts) continue;
    const area = signedArea(pts);
    if (area < 8 || area > 60000) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) {
      cx += x;
      cz += z;
    }
    cx /= pts.length;
    cz /= pts.length;
    // Names often live on a point inside the outline rather than the building.
    let name = t.name || '';
    let tags = t;
    if (!name) {
      const n = nodes.find((n) => {
        if (!n.tags.name || !(n.tags.amenity || n.tags.tourism || n.tags.historic)) return false;
        const q = latLonToLocal(n.lat, n.lon);
        return inside(pts, q.x, q.z);
      });
      if (n) {
        name = n.tags.name;
        tags = { ...n.tags, ...t };
      }
    }
    name = NAME_FIX[name] || name;
    const box = obb(pts);
    const kind = classify(tags, area, cx, cz);
    const m = massing(kind, tags, area, box, cx, cz, id % 100003);
    const rec = { k: kind, h: m.h, l: m.levels, r: m.roof, p: pts.flat().map(r1) };
    if (m.tagged) rec.t = 1;
    if (name) rec.n = name;
    const lm = name && LANDMARKS.find((l) => l.re.test(name));
    if (lm) rec.id = lm.id;
    if (tags['building:colour']) rec.c = tags['building:colour'];
    if (inside(CORE, cx, cz)) rec.d = 1;
    buildings.push(rec);
  }

  // Bok Kai Temple is only mapped as a point; hang it on the building under it.
  for (const n of nodes) {
    const lm = n.tags.name && LANDMARKS.find((l) => l.re.test(n.tags.name));
    if (!lm || buildings.some((b) => b.id === lm.id)) continue;
    const p = latLonToLocal(n.lat, n.lon);
    let best = null;
    let bd = 25;
    for (const b of buildings) {
      const ring = [];
      for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
      if (inside(ring, p.x, p.z)) {
        best = b;
        break;
      }
      for (const [x, z] of ring) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
    }
    if (best && lm.id === 'bokkai') {
      best.id = lm.id;
      best.n = n.tags.name;
      best.k = KIND.TEMPLE;
      best.h = 5.2;
      best.r = ROOF.GABLE;
    } else if (best && !best.n) {
      best.n = n.tags.name;
      best.id = lm.id;
    }
  }

  for (const e of json.elements) {
    const t = e.tags || {};
    if (e.type !== 'way' || !e.geometry) continue;
    if (t.bridge && t.bridge !== 'no' && (t.highway || t.railway)) {
      const pts = lineLocal(e.geometry);
      if (polyLength(pts) < 8) continue;
      const mid = Math.floor(pts.length / 4) * 2;
      const outline = bridgeOutlines.find((o) => o.pts && inside(o.pts, pts[mid], pts[mid + 1]));
      const lanes = num(t.lanes) || (t.oneway === 'yes' ? 1 : 2);
      let kind = 'road';
      let w = num(t.width) || lanes * 3.7 + 2.4;
      if (t.railway === 'rail') {
        kind = 'rail';
        w = 4.6;
      } else if (t.railway === 'abandoned' || t['abandoned:railway']) {
        // The 1906–07 Northern Electric bridge, decked as a trail.
        kind = 'oldrail';
        w = 5.2;
      } else if (/^(footway|path|pedestrian|cycleway)$/.test(t.highway)) {
        kind = 'foot';
        w = num(t.width) || (t.bridge === 'boardwalk' ? 2.0 : 3.0);
      } else if (t.sidewalk && t.sidewalk !== 'no' && t.sidewalk !== 'separate') w += 1.8;
      bridges.push({
        k: kind,
        n: outline?.name || t.name || '',
        ref: t.ref || '',
        loc: outline?.loc || t.loc_name || '',
        w: r1(w),
        lanes,
        layer: num(t.layer) || 1,
        boardwalk: t.bridge === 'boardwalk' ? 1 : 0,
        pts,
      });
    } else if (/^(footway|pedestrian|path)$/.test(t.highway || '') && !t.bridge) {
      walks.push({ k: t.footway || t.highway, pts: lineLocal(e.geometry) });
    }
  }

  for (const e of json.elements) {
    const t = e.tags || {};
    const a = t.amenity;
    if (!a || !/^(bar|pub|nightclub|restaurant|cafe|fast_food|theatre|cinema|ice_cream)$/.test(a)) continue;
    let p = null;
    if (e.type === 'node') p = latLonToLocal(e.lat, e.lon);
    else if (e.geometry) {
      const ring = cleanRing(e.geometry);
      if (ring) p = { x: ring.reduce((s, q) => s + q[0], 0) / ring.length, z: ring.reduce((s, q) => s + q[1], 0) / ring.length };
    }
    if (p) spots.push({ n: t.name || '', k: a, x: r1(p.x), z: r1(p.z) });
  }

  buildings.sort((a, b) => a.p[1] - b.p[1] || a.p[0] - b.p[0]);
  return {
    name: TOWN.name,
    center: [r1(TOWN.x), r1(TOWN.z)],
    size: TOWN.size,
    core: CORE,
    kinds: KIND,
    roofs: ROOF,
    buildings,
    bridges,
    walks,
    spots,
  };
}
