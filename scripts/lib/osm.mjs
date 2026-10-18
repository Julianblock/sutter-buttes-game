import fs from 'node:fs/promises';
import path from 'node:path';
import { latLonToLocal, regionBounds } from './geo.mjs';

const UA = 'sutter-buttes-game/0.1 (github.com/Julianblock/sutter-buttes-game)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(query, cacheFile) {
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch {}
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(json));
      return json;
    } catch (err) {
      console.warn(`  ${url} failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

const r1 = (v) => Math.round(v * 10) / 10;

function toLine(geometry) {
  const pts = [];
  for (const g of geometry) {
    const p = latLonToLocal(g.lat, g.lon);
    pts.push(r1(p.x), r1(p.z));
  }
  return pts;
}

function building(geometry) {
  const pts = geometry.map((g) => latLonToLocal(g.lat, g.lon));
  if (pts.length < 3) return null;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;
  // Orientation from the longest edge, extents measured in that frame.
  let best = 0;
  let ang = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const l = dx * dx + dz * dz;
    if (l > best) {
      best = l;
      ang = Math.atan2(dz, dx);
    }
  }
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const u = (p.x - cx) * c - (p.z - cz) * s;
    const v = (p.x - cx) * s + (p.z - cz) * c;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const w = maxU - minU;
  const d = maxV - minV;
  if (w < 2 || d < 2 || w > 400 || d > 400) return null;
  return [r1(cx), r1(cz), r1(w), r1(d), Math.round(ang * 1000) / 1000];
}

export async function buildOsm(size, cacheDir) {
  const b = regionBounds(size);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const query = `[out:json][timeout:300];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox});
  way["waterway"~"^(river|canal|stream|drain|ditch)$"](${bbox});
  way["natural"="water"](${bbox});
  way["building"](${bbox});
  way["power"="line"](${bbox});
  node["natural"="peak"](${bbox});
  node["place"~"^(city|town|village|hamlet)$"](${bbox});
  node["man_made"~"^(mast|tower|communications_tower)$"](${bbox});
);
out geom;`;
  const json = await overpass(query, path.join(cacheDir, `osm_${size}.json`));

  // Ranch tracks only near the Buttes (the inner region); cemeteries across the valley.
  const ib = regionBounds(22000);
  const extra = await overpass(
    `[out:json][timeout:180];
(
  way["highway"="track"](${ib.south},${ib.west},${ib.north},${ib.east});
  way["landuse"="cemetery"](${bbox});
  way["amenity"="grave_yard"](${bbox});
);
out geom;`,
    path.join(cacheDir, `osm_extra_${size}.json`),
  );
  json.elements.push(...extra.elements);

  const out = { roads: [], waterways: [], waterAreas: [], buildings: [], power: [], peaks: [], places: [], masts: [], cemeteries: [] };
  for (const e of json.elements) {
    const t = e.tags || {};
    if (e.type === 'node') {
      const p = latLonToLocal(e.lat, e.lon);
      const item = { name: t.name || '', x: r1(p.x), z: r1(p.z) };
      if (t.natural === 'peak') out.peaks.push({ ...item, ele: Number(t.ele) || null });
      else if (t.place) out.places.push({ ...item, kind: t.place });
      else if (t.man_made) out.masts.push({ ...item, height: Number(t.height) || null });
      continue;
    }
    if (!e.geometry) continue;
    if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') {
      out.cemeteries.push({ name: t.name || '', pts: toLine(e.geometry) });
    } else if (t.highway) {
      out.roads.push({ name: t.name || t.ref || '', kind: t.highway.replace('_link', ''), grade: Number((t.tracktype || '').slice(5)) || 0, lanes: Number(t.lanes) || 0, oneway: t.oneway === 'yes' || t.highway === 'motorway' ? 1 : t.oneway === '-1' ? -1 : 0, pts: toLine(e.geometry) });
    } else if (t.waterway) {
      out.waterways.push({ name: t.name || '', kind: t.waterway, pts: toLine(e.geometry) });
    } else if (t.natural === 'water') {
      out.waterAreas.push({ name: t.name || '', pts: toLine(e.geometry) });
    } else if (t.building) {
      const bld = building(e.geometry);
      if (bld) out.buildings.push(bld);
    } else if (t.power === 'line') {
      out.power.push({ pts: toLine(e.geometry) });
    }
  }
  return out;
}
