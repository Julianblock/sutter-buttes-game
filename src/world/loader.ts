import type { OsmData, RegionName, TownData, WorldMeta } from './meta';

const BASE = `${import.meta.env.BASE_URL}data/`;

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface HeightGrid {
  res: number;
  size: number;
  heights: Float32Array;
  ao: Float32Array;
}

export interface WorldData {
  meta: WorldMeta;
  heights: Record<RegionName, HeightGrid>;
  imagery: Record<RegionName, ImageBitmap>;
  landcover: Pixels;
  canopy: Pixels;
  osm: OsmData;
  town: { data: TownData; imagery: ImageBitmap } | null;
  towns: { data: TownData; imagery: ImageBitmap }[];
}

type Progress = (label: string, fraction: number) => void;

async function fetchBitmap(name: string): Promise<ImageBitmap> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Failed to load ${name}`);
  const blob = await res.blob();
  // Data images must not be colour-managed or the packed bytes get corrupted.
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function readPixels(bmp: ImageBitmap): Pixels {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' });
  return { width: bmp.width, height: bmp.height, data: img.data };
}

function decodeHeights(px: Pixels, size: number, enc: { offset: number; scale: number }, hasAO: boolean): HeightGrid {
  const n = px.width * px.height;
  const heights = new Float32Array(n);
  const ao = new Float32Array(n);
  const d = px.data;
  for (let i = 0; i < n; i++) {
    heights[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / enc.scale - enc.offset;
    ao[i] = hasAO ? d[i * 4 + 2] / 255 : 1;
  }
  return { res: px.width, size, heights, ao };
}

export async function loadWorld(onProgress: Progress): Promise<WorldData> {
  const meta: WorldMeta = await (await fetch(BASE + 'meta.json')).json();
  const regions: RegionName[] = ['inner', 'mid', 'far'];

  const jobs: [string, () => Promise<unknown>][] = [];
  const heights = {} as Record<RegionName, HeightGrid>;
  const imagery = {} as Record<RegionName, ImageBitmap>;
  let landcover!: Pixels;
  let canopy!: Pixels;
  let osm!: OsmData;

  for (const r of regions) {
    jobs.push([
      `Elevation · ${r}`,
      async () => {
        const px = readPixels(await fetchBitmap(`height_${r}.png`));
        heights[r] = decodeHeights(px, meta.regions[r].size, meta.heightEncoding[r], r !== 'far');
      },
    ]);
    jobs.push([
      `Aerial imagery · ${r}`,
      async () => {
        imagery[r] = await fetchBitmap(`imagery_${r}.jpg`);
      },
    ]);
  }
  jobs.push(['Crop & land cover', async () => (landcover = readPixels(await fetchBitmap('landcover.png')))]);
  jobs.push(['Oak canopy', async () => (canopy = readPixels(await fetchBitmap('canopy_inner.png')))]);
  jobs.push(['Roads & towns', async () => (osm = await (await fetch(BASE + 'osm.json')).json())]);
  let town: WorldData['town'] = null;
  if (meta.town) {
    jobs.push([
      `${meta.town.name}`,
      async () => {
        const [data, imagery] = await Promise.all([
          fetch(BASE + 'marysville.json').then((r) => r.json() as Promise<TownData>),
          fetchBitmap('imagery_marysville.jpg'),
        ]);
        town = { data, imagery };
      },
    ]);
  }
  const towns: WorldData['towns'] = [];
  for (const t of meta.towns ?? []) {
    jobs.push([
      t.name,
      async () => {
        const [data, imagery] = await Promise.all([fetch(BASE + `${t.id}.json`).then((r) => r.json() as Promise<TownData>), fetchBitmap(`imagery_${t.id}.jpg`)]);
        towns.push({ data, imagery });
      },
    ]);
  }

  let done = 0;
  await Promise.all(
    jobs.map(async ([label, fn]) => {
      await fn();
      done++;
      onProgress(label, done / jobs.length);
    }),
  );

  return { meta, heights, imagery, landcover, canopy, osm, town, towns };
}
