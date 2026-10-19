// Builds the real-world datasets the game streams at runtime.
//   node scripts/fetch-data.mjs [step...]
// Steps: height, imagery, landcover, derived, trees, osm, marysville (default: all)

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CENTER } from './lib/geo.mjs';
import { buildMosaic } from './lib/tiles.mjs';
import { buildLandcover, LC } from './lib/landcover.mjs';
import { buildOsm } from './lib/osm.mjs';
import { buildMarysville, TOWN } from './lib/marysville.mjs';
import { canopyMask, horizonAO, readHeight } from './lib/derived.mjs';
import { detectTrees } from './lib/trees.mjs';

const OUT = path.resolve('public/data');
// Square zone around the Buttes where individual trees are detected from z16 imagery.
const TREE_ZONE = 16000;

export const REGIONS = {
  inner: { size: 22000, heightRes: 2048, heightZoom: 14, imageRes: 4096, imageZoom: 15 },
  mid: { size: 50000, heightRes: 1024, heightZoom: 12, imageRes: 2048, imageZoom: 13 },
  far: { size: 400000, heightRes: 1024, heightZoom: 9, imageRes: 2048, imageZoom: 10 },
};

// Heights are packed into 16 bits across the R and G channels of an 8-bit PNG.
export const HEIGHT_ENCODING = {
  inner: { offset: 20, scale: 64 },
  mid: { offset: 20, scale: 64 },
  far: { offset: 100, scale: 16 },
};

function forEachPixel(res, size, fn) {
  const step = size / res;
  for (let j = 0; j < res; j++) {
    const z = -size / 2 + (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const x = -size / 2 + (i + 0.5) * step;
      fn(i, j, x, z);
    }
  }
}

async function buildHeight(name) {
  const r = REGIONS[name];
  const enc = HEIGHT_ENCODING[name];
  console.log(`height/${name}`);
  const sample = await buildMosaic('terrarium', r.heightZoom, r.size * 1.02);
  const raw = Buffer.alloc(r.heightRes * r.heightRes * 3);
  const tmp = [0];
  let min = Infinity;
  let max = -Infinity;
  forEachPixel(r.heightRes, r.size, (i, j, x, z) => {
    let h = sample(x, z, tmp)[0];
    if (name === 'far') h = Math.max(h, -2);
    min = Math.min(min, h);
    max = Math.max(max, h);
    const v = Math.max(0, Math.min(65535, Math.round((h + enc.offset) * enc.scale)));
    const o = (j * r.heightRes + i) * 3;
    raw[o] = v >> 8;
    raw[o + 1] = v & 255;
  });
  console.log(`  range ${min.toFixed(1)}m .. ${max.toFixed(1)}m`);
  await sharp(raw, { raw: { width: r.heightRes, height: r.heightRes, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `height_${name}.png`));
  return { min, max };
}

async function buildImagery(name) {
  const r = REGIONS[name];
  console.log(`imagery/${name}`);
  const sample = await buildMosaic('usgsImagery', r.imageZoom, r.size * 1.02);
  const raw = Buffer.alloc(r.imageRes * r.imageRes * 3);
  const rgb = [0, 0, 0];
  forEachPixel(r.imageRes, r.size, (i, j, x, z) => {
    sample(x, z, rgb);
    const o = (j * r.imageRes + i) * 3;
    raw[o] = rgb[0];
    raw[o + 1] = rgb[1];
    raw[o + 2] = rgb[2];
  });
  await sharp(raw, { raw: { width: r.imageRes, height: r.imageRes, channels: 3 } })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(OUT, `imagery_${name}.jpg`));
}

async function writeMeta(extra = {}) {
  const file = path.join(OUT, 'meta.json');
  let meta = {};
  try {
    meta = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {}
  meta = { ...meta, center: CENTER, regions: REGIONS, heightEncoding: HEIGHT_ENCODING, ...extra };
  await fs.writeFile(file, JSON.stringify(meta, null, 2));
}

const steps = {
  async height() {
    const ranges = {};
    for (const name of Object.keys(REGIONS)) ranges[name] = await buildHeight(name);
    await writeMeta({ heightRanges: ranges });
  },
  async imagery() {
    for (const name of Object.keys(REGIONS)) await buildImagery(name);
  },
  async landcover() {
    const { size } = REGIONS.mid;
    const res = 2048;
    console.log('landcover/mid');
    const classes = await buildLandcover(size, res, path.resolve('.cache/cdl'));
    const counts = {};
    for (const v of classes) counts[v] = (counts[v] || 0) + 1;
    const names = Object.fromEntries(Object.entries(LC).map(([k, v]) => [v, k]));
    for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${names[k].padEnd(12)} ${((100 * n) / classes.length).toFixed(1)}%`);
    }
    await sharp(Buffer.from(classes), { raw: { width: res, height: res, channels: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'landcover.png'));
    await writeMeta({ landcover: { size, res, classes: LC } });
  },
  async derived() {
    for (const name of ['inner', 'mid']) {
      console.log(`ao/${name}`);
      const r = REGIONS[name];
      const file = path.join(OUT, `height_${name}.png`);
      const { h, N, raw, channels } = await readHeight(file, HEIGHT_ENCODING[name]);
      const ao = horizonAO(h, N, r.size / N);
      const outBuf = Buffer.alloc(N * N * 3);
      for (let i = 0; i < N * N; i++) {
        outBuf[i * 3] = raw[i * channels];
        outBuf[i * 3 + 1] = raw[i * channels + 1];
        outBuf[i * 3 + 2] = Math.round(ao[i] * 255);
      }
      await sharp(outBuf, { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file + '.tmp');
      await fs.rename(file + '.tmp', file);
    }

    console.log('canopy/inner');
    const lc = await sharp(path.join(OUT, 'landcover.png')).raw().toBuffer({ resolveWithObject: true });
    const lcRes = lc.info.width;
    const res = 1024;
    const inner = REGIONS.inner.size;
    const treeClasses = new Set([LC.GRASS, LC.WOODLAND]);
    const mask = await canopyMask(path.join(OUT, 'imagery_inner.jpg'), res, (i, j) => {
      const x = -inner / 2 + ((i + 0.5) / res) * inner;
      const z = -inner / 2 + ((j + 0.5) / res) * inner;
      const li = Math.floor((x / REGIONS.mid.size + 0.5) * lcRes);
      const lj = Math.floor((z / REGIONS.mid.size + 0.5) * lcRes);
      return treeClasses.has(lc.data[(lj * lcRes + li) * lc.info.channels]);
    });
    await sharp(Buffer.from(mask), { raw: { width: res, height: res, channels: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'canopy_inner.png'));
  },
  async trees() {
    console.log('trees/buttes');
    const lc = await sharp(path.join(OUT, 'landcover.png')).raw().toBuffer({ resolveWithObject: true });
    const lcRes = lc.info.width;
    const ok = new Set([LC.GRASS, LC.WOODLAND, LC.WETLAND, LC.HAY, LC.OTHER, LC.FALLOW, LC.URBAN_OPEN]);
    const size = TREE_ZONE;
    const trees = await detectTrees({
      size,
      cell: 2.5,
      zoom: 16,
      allow: (x, z) => {
        const li = Math.floor((x / REGIONS.mid.size + 0.5) * lcRes);
        const lj = Math.floor((z / REGIONS.mid.size + 0.5) * lcRes);
        return ok.has(lc.data[(lj * lcRes + li) * lc.info.channels]);
      },
    });
    // 6 bytes per tree: uint16 x, uint16 z (over the zone), uint8 radius*20, uint8 darkness*255.
    const buf = Buffer.alloc(trees.length * 6);
    trees.forEach(([x, z, r, d], k) => {
      buf.writeUInt16LE(Math.round(((x / size) + 0.5) * 65535), k * 6);
      buf.writeUInt16LE(Math.round(((z / size) + 0.5) * 65535), k * 6 + 2);
      buf.writeUInt8(Math.min(255, Math.round(r * 20)), k * 6 + 4);
      buf.writeUInt8(Math.min(255, Math.round(d * 255)), k * 6 + 5);
    });
    await fs.writeFile(path.join(OUT, 'trees.bin'), buf);
    console.log(`  ${trees.length} trees, ${(buf.length / 1024).toFixed(0)} KB`);
    await writeMeta({ trees: { size, count: trees.length } });
  },
  async osm() {
    console.log('osm/mid');
    const osm = await buildOsm(REGIONS.mid.size, path.resolve('.cache/osm'));
    for (const [k, v] of Object.entries(osm)) console.log(`  ${k.padEnd(10)} ${v.length}`);
    await fs.writeFile(path.join(OUT, 'osm.json'), JSON.stringify(osm));
  },
  async marysville() {
    console.log('town/marysville');
    const town = await buildMarysville(path.resolve('.cache/osm'));
    for (const k of ['buildings', 'bridges', 'walks', 'spots']) console.log(`  ${k.padEnd(10)} ${town[k].length}`);
    const tagged = town.buildings.filter((b) => b.t).length;
    console.log(`  ${tagged} buildings with mapped heights, ${town.buildings.filter((b) => b.id).map((b) => b.id).join(', ')}`);
    await fs.writeFile(path.join(OUT, 'marysville.json'), JSON.stringify(town));

    // Full-resolution orthophoto over town (USGS tops out at z16 here, ~1.7 m per pixel).
    const res = 3072;
    const sample = await buildMosaic('usgsImagery', 16, TOWN.size * 1.02, TOWN.x, TOWN.z);
    const raw = Buffer.alloc(res * res * 3);
    const rgb = [0, 0, 0];
    const step = TOWN.size / res;
    for (let j = 0; j < res; j++) {
      const z = TOWN.z - TOWN.size / 2 + (j + 0.5) * step;
      for (let i = 0; i < res; i++) {
        sample(TOWN.x - TOWN.size / 2 + (i + 0.5) * step, z, rgb);
        const o = (j * res + i) * 3;
        raw[o] = rgb[0];
        raw[o + 1] = rgb[1];
        raw[o + 2] = rgb[2];
      }
    }
    await sharp(raw, { raw: { width: res, height: res, channels: 3 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(OUT, 'imagery_marysville.jpg'));
    await writeMeta({ town: { name: TOWN.name, center: town.center, size: TOWN.size, imageRes: res } });
  },
};

const wanted = process.argv.slice(2);
await fs.mkdir(OUT, { recursive: true });
for (const [name, fn] of Object.entries(steps)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}
await writeMeta();
