import fs from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import { fromArrayBuffer } from 'geotiff';
import { localToLatLon } from './geo.mjs';

// USDA NASS Cropland Data Layer, delivered in CONUS Albers (EPSG:5070).
const ALBERS = '+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
const toAlbers = proj4('EPSG:4326', ALBERS);

// Game land-cover classes (stored in the red channel of landcover.png).
export const LC = {
  OTHER: 0,
  RICE: 1,
  WALNUT: 2,
  ALMOND: 3,
  FRUIT: 4, // peaches, prunes, plums, cherries, olives...
  GRASS: 5, // annual grassland / pasture (the Buttes)
  WETLAND: 6,
  WATER: 7,
  URBAN_OPEN: 8,
  URBAN_LOW: 9,
  URBAN_MED: 10,
  URBAN_HIGH: 11,
  WOODLAND: 12, // oak woodland, shrub, riparian forest
  ROWCROP: 13, // tomatoes, sunflowers, corn, wheat, beans...
  FALLOW: 14,
  HAY: 15, // alfalfa, clover, hay
};

const CDL_TO_LC = new Map([
  [3, LC.RICE],
  [76, LC.WALNUT],
  [74, LC.WALNUT], // pecans
  [75, LC.ALMOND],
  [204, LC.ALMOND], // pistachios
  ...[66, 67, 68, 69, 72, 77, 210, 211, 212, 217, 218, 220, 223].map((c) => [c, LC.FRUIT]),
  [176, LC.GRASS],
  [195, LC.WETLAND],
  [190, LC.WOODLAND],
  [111, LC.WATER],
  [121, LC.URBAN_OPEN],
  [122, LC.URBAN_LOW],
  [123, LC.URBAN_MED],
  [124, LC.URBAN_HIGH],
  ...[141, 142, 143, 152].map((c) => [c, LC.WOODLAND]),
  ...[36, 37, 58, 59].map((c) => [c, LC.HAY]),
  ...[61, 131].map((c) => [c, LC.FALLOW]),
]);

function classify(cdl) {
  if (CDL_TO_LC.has(cdl)) return CDL_TO_LC.get(cdl);
  if (cdl === 0) return LC.OTHER;
  return LC.ROWCROP;
}

async function downloadCdl(bbox, cacheDir) {
  for (const year of [2025, 2024, 2023]) {
    const file = path.join(cacheDir, `cdl_${year}.tif`);
    try {
      return await fs.readFile(file);
    } catch {}
    const api = `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year=${year}&bbox=${bbox.join(',')}`;
    const xml = await (await fetch(api)).text();
    const url = xml.match(/<returnURL>(.*?)<\/returnURL>/)?.[1];
    if (!url) continue;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, buf);
    console.log(`  CDL ${year}: ${(buf.length / 1e6).toFixed(1)}MB`);
    return buf;
  }
  throw new Error('No CDL year available');
}

/** Returns a Uint8Array (res*res) of game land-cover classes over a square region. */
export async function buildLandcover(size, res, cacheDir) {
  const h = size / 2;
  const corners = [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ].map(([x, z]) => {
    const ll = localToLatLon(x, z);
    return toAlbers.forward([ll.lon, ll.lat]);
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const bbox = [Math.min(...xs) - 500, Math.min(...ys) - 500, Math.max(...xs) + 500, Math.max(...ys) + 500].map(Math.round);

  const buf = await downloadCdl(bbox, cacheDir);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const image = await tiff.getImage();
  const [raster] = await image.readRasters();
  const W = image.getWidth();
  const H = image.getHeight();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();

  const out = new Uint8Array(res * res);
  const step = size / res;
  for (let j = 0; j < res; j++) {
    const z = -h + (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const x = -h + (i + 0.5) * step;
      const ll = localToLatLon(x, z);
      const [ax, ay] = toAlbers.forward([ll.lon, ll.lat]);
      const px = Math.floor((ax - ox) / rx);
      const py = Math.floor((ay - oy) / ry);
      const v = px >= 0 && py >= 0 && px < W && py < H ? raster[py * W + px] : 0;
      out[j * res + i] = classify(v);
    }
  }
  return out;
}
