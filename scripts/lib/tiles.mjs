import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { latLonToMercatorPx, localToLatLon } from './geo.mjs';

const CACHE = path.resolve('.cache/tiles');
const UA = 'sutter-buttes-game/0.1 (github.com/Julianblock/sutter-buttes-game)';

export const SOURCES = {
  terrarium: {
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    ext: 'png',
  },
  usgsImagery: {
    url: (z, x, y) =>
      `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    ext: 'jpg',
  },
};

async function fetchWithRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === tries - 1) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  return null;
}

async function getTile(sourceName, z, x, y) {
  const src = SOURCES[sourceName];
  const file = path.join(CACHE, sourceName, String(z), String(x), `${y}.${src.ext}`);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await fetchWithRetry(src.url(z, x, y));
    if (!buf) return null;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

async function pool(items, limit, fn) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
      done++;
      if (done % 50 === 0 || done === items.length) {
        process.stdout.write(`\r    tiles ${done}/${items.length}   `);
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
}

/**
 * Downloads every tile needed to cover a square local region (centred on
 * cx, cz) and returns a bilinear sampler over the decoded RGB mosaic in local
 * coordinates.
 */
export async function buildMosaic(sourceName, zoom, size, cx = 0, cz = 0) {
  const h = size / 2;
  const nw = localToLatLon(cx - h, cz - h);
  const se = localToLatLon(cx + h, cz + h);
  const a = latLonToMercatorPx(nw.lat, nw.lon, zoom);
  const b = latLonToMercatorPx(se.lat, se.lon, zoom);
  const tx0 = Math.floor(a.px / 256) - 1;
  const ty0 = Math.floor(a.py / 256) - 1;
  const tx1 = Math.floor(b.px / 256) + 1;
  const ty1 = Math.floor(b.py / 256) + 1;
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  const W = cols * 256;
  const H = rows * 256;
  const isHeight = sourceName === 'terrarium';
  const C = isHeight ? 1 : 3;
  const data = isHeight ? new Float32Array(W * H) : new Uint8Array(W * H * 3);
  if (!isHeight) {
    // Missing imagery tiles are open Pacific; paint them deep ocean blue.
    for (let i = 0; i < W * H; i++) data.set([16, 34, 52], i * 3);
  }

  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  console.log(`  ${sourceName} z${zoom}: ${cols}x${rows} tiles`);

  await pool(jobs, 12, async ([tx, ty]) => {
    const buf = await getTile(sourceName, zoom, tx, ty);
    if (!buf) return;
    const { data: px, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = (tx - tx0) * 256;
    const oy = (ty - ty0) * 256;
    for (let y = 0; y < info.height; y++) {
      const srcRow = y * info.width * 3;
      if (isHeight) {
        const dstRow = (oy + y) * W + ox;
        for (let x = 0; x < info.width; x++) {
          const s = srcRow + x * 3;
          data[dstRow + x] = px[s] * 256 + px[s + 1] + px[s + 2] / 256 - 32768;
        }
      } else {
        const dstRow = ((oy + y) * W + ox) * 3;
        for (let x = 0; x < info.width; x++) {
          const s = srcRow + x * 3;
          // Low-zoom imagery encodes open ocean as pure black.
          if (zoom <= 11 && px[s] + px[s + 1] + px[s + 2] < 8) continue;
          data[dstRow + x * 3] = px[s];
          data[dstRow + x * 3 + 1] = px[s + 1];
          data[dstRow + x * 3 + 2] = px[s + 2];
        }
      }
    }
  });

  const originPx = tx0 * 256;
  const originPy = ty0 * 256;

  return function sample(x, z, out) {
    const ll = localToLatLon(x, z);
    const m = latLonToMercatorPx(ll.lat, ll.lon, zoom);
    const fx = m.px - originPx - 0.5;
    const fy = m.py - originPy - 0.5;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const dx = Math.min(1, Math.max(0, fx - x0));
    const dy = Math.min(1, Math.max(0, fy - y0));
    const i00 = (y0 * W + x0) * C;
    const i10 = i00 + C;
    const i01 = i00 + W * C;
    const i11 = i01 + C;
    for (let c = 0; c < C; c++) {
      const top = data[i00 + c] * (1 - dx) + data[i10 + c] * dx;
      const bot = data[i01 + c] * (1 - dx) + data[i11 + c] * dx;
      out[c] = top * (1 - dy) + bot * dy;
    }
    return out;
  };
}
