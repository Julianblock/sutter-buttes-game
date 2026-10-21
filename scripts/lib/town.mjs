// Detailed towns: true building footprints, bridges, sidewalks and nightlife
// from OpenStreetMap (plus Microsoft's ML footprints where OSM is thin), for
// the towns modelled building by building. Each town is a config; see
// marysville.mjs and princeton.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { latLonToLocal, localToLatLon } from './geo.mjs';
import { overpass } from './osm.mjs';

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

function classify(cfg, t, area, x, z) {
  const b = t.building;
  const core = !!cfg.core && inside(cfg.core, x, z);
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
function massing(cfg, kind, t, area, box, x, z, seed) {
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
  const ot = cfg.oldTown;
  const oldTown = !!ot && x > ot.x0 && x < ot.x1 && z > ot.z0 && z < ot.z1;

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

export async function buildTown(cfg, cacheDir) {
  const h = cfg.size / 2;
  const nw = localToLatLon(cfg.x - h, cfg.z - h);
  const se = localToLatLon(cfg.x + h, cfg.z + h);
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
${cfg.extraQuery ? cfg.extraQuery(bbox) : ''}
);
out geom;`,
    path.join(cacheDir, `${cfg.id}_${cfg.size}.json`),
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
  // Where OSM is thin, Microsoft's ML footprints (traced from aerial imagery) fill in.
  if (cfg.msQuadkey) {
    const ms = await msFootprints(cfg.msQuadkey, cacheDir, { s: se.lat, w: nw.lon, n: nw.lat, e: se.lon });
    ms.forEach((f, i) => rings.push({ id: 9e9 + i, t: {}, geometry: f.geometry, ms: f }));
  }
  const osmWays = new Map();
  const hung = new Map();

  for (const { id, t, geometry, ms } of rings) {
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
    // An ML footprint that overlaps a mapped one is the same building.
    if (ms && buildings.some((b) => !b.s && (inside(ringOf(b), cx, cz) || inside(pts, ...centroid(b))))) continue;
    // Names often live on a point inside the outline rather than the building.
    let name = t.name || '';
    let tags = t;
    let named = null;
    if (!name) {
      const n = nodes.find((n) => {
        if (!n.tags.name || !(n.tags.amenity || n.tags.tourism || n.tags.historic)) return false;
        const q = latLonToLocal(n.lat, n.lon);
        return inside(pts, q.x, q.z);
      });
      if (n) {
        name = n.tags.name;
        tags = { ...n.tags, ...t };
        named = n;
      }
    }
    name = cfg.nameFix?.[name] || name;
    const box = obb(pts);
    const kind = classify(cfg, tags, area, cx, cz);
    const m = massing(cfg, kind, tags, area, box, cx, cz, id % 100003);
    const rec = { k: kind, h: m.h, l: m.levels, r: m.roof, p: pts.flat().map(r1) };
    if (m.tagged) rec.t = 1;
    if (ms) {
      // ML heights are to the highest point; pitched roofs put the eaves lower.
      rec.h = r1(Math.max(2.4, Math.min(30, ms.height * (m.roof === ROOF.FLAT ? 1 : 0.72))));
      rec.l = Math.max(1, Math.round(rec.h / 3.4));
      rec.s = 1;
    } else osmWays.set(id, rec);
    if (name) rec.n = name;
    const lm = name && cfg.landmarks.find((l) => l.re.test(name));
    if (lm) rec.id = lm.id;
    if (lm && named) hung.set(lm.id, { node: named, dist: 0 });
    if (tags['building:colour']) rec.c = tags['building:colour'];
    if (cfg.core && inside(cfg.core, cx, cz)) rec.d = 1;
    const campus = cfg.campuses?.find((c) => inside(c.ring, cx, cz));
    if (campus) rec.cp = campus.id;
    buildings.push(rec);
  }

  // Bok Kai Temple is only mapped as a point; hang it on the building under it.
  for (const n of nodes) {
    const lm = n.tags.name && cfg.landmarks.find((l) => l.re.test(n.tags.name));
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
    if (best) hung.set(lm.id, { node: n, dist: inside(ringOf(best), p.x, p.z) ? 0 : bd });
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

  // Landmark registry: where each one came from and how sure we are of it.
  const landmarks = [];
  for (const lm of cfg.landmarks) {
    const b = buildings.find((q) => q.id === lm.id);
    if (!b) continue;
    const [x, z] = centroid(b);
    const ll = localToLatLon(x, z);
    const way = [...osmWays].find(([, r]) => r === b)?.[0];
    const h = hung.get(lm.id);
    const src = way ? `osm:way/${way}` : `osm:node/${h.node.id}`;
    const conf = way ? 0.95 : b.s ? Math.max(0.3, 0.8 - h.dist / 50) : Math.max(0.4, 0.9 - h.dist / 50);
    landmarks.push({
      id: lm.id,
      name: b.n,
      src,
      footprint: b.s ? 'microsoft-ml' : 'osm',
      lat: Math.round(ll.lat * 1e6) / 1e6,
      lon: Math.round(ll.lon * 1e6) / 1e6,
      x: r1(x),
      z: r1(z),
      conf: Math.round(conf * 100) / 100,
      fidelity: lm.fidelity || 'massing from footprint; no reference imagery reviewed',
    });
  }

  buildings.sort((a, b) => a.p[1] - b.p[1] || a.p[0] - b.p[0]);
  return {
    name: cfg.name,
    center: [r1(cfg.x), r1(cfg.z)],
    size: cfg.size,
    core: cfg.core ?? [],
    kinds: KIND,
    roofs: ROOF,
    buildings,
    bridges,
    walks,
    spots,
    ...(landmarks.length && cfg.registry ? { landmarks } : {}),
  };
}

function ringOf(b) {
  const ring = [];
  for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
  return ring;
}

function centroid(b) {
  let x = 0, z = 0;
  const n = b.p.length / 2;
  for (let i = 0; i < b.p.length; i += 2) {
    x += b.p[i];
    z += b.p[i + 1];
  }
  return [x / n, z / n];
}

/**
 * Microsoft Global ML Building Footprints (ODbL) for one zoom-9 quadkey,
 * cached, clipped to the bounding box.
 */
async function msFootprints(quadkey, cacheDir, bb) {
  const file = path.join(cacheDir, `ms_${quadkey}.csv.gz`);
  let gz;
  try {
    gz = await fs.readFile(file);
  } catch {
    const links = await (await fetch('https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv')).text();
    const row = links.split('\n').find((l) => l.split(',')[1] === quadkey);
    if (!row) throw new Error(`No Microsoft footprints for quadkey ${quadkey}`);
    gz = Buffer.from(await (await fetch(row.split(',')[2])).arrayBuffer());
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, gz);
  }
  const out = [];
  for (const line of gunzipSync(gz).toString('utf8').split('\n')) {
    if (!line) continue;
    const f = JSON.parse(line);
    const c = f.geometry.coordinates[0];
    const [lon, lat] = c[0];
    if (lat < bb.s || lat > bb.n || lon < bb.w || lon > bb.e) continue;
    out.push({ height: f.properties.height > 0 ? f.properties.height : 3.2, cf: f.properties.confidence, geometry: c.map(([lo, la]) => ({ lat: la, lon: lo })) });
  }
  return out;
}
