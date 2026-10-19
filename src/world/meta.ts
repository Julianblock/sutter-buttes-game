export interface RegionSpec {
  size: number;
  heightRes: number;
  imageRes: number;
}

export interface HeightEncoding {
  offset: number;
  scale: number;
}

export type RegionName = 'inner' | 'mid' | 'far';

export interface WorldMeta {
  center: { lat: number; lon: number };
  regions: Record<RegionName, RegionSpec>;
  heightEncoding: Record<RegionName, HeightEncoding>;
  landcover: { size: number; res: number; classes: Record<string, number> };
  trees?: { size: number; count: number };
  /** Detailed town zone (Marysville), with its own orthophoto. */
  town?: { name: string; center: [number, number]; size: number; imageRes: number };
}

export interface TownBuilding {
  /** Kind code from TownData.kinds. */
  k: number;
  /** Wall height (m) from the ground to the eave or parapet. */
  h: number;
  /** Storeys. */
  l: number;
  /** Roof form from TownData.roofs. */
  r: number;
  /** Footprint ring x0, z0, x1, z1… wound counter-clockwise in x/z. */
  p: number[];
  /** 1 when height or storeys come from OSM tags rather than estimates. */
  t?: number;
  n?: string;
  /** Landmark id for hand-built details. */
  id?: string;
  c?: string;
  /** Inside the historic downtown core. */
  d?: number;
}

export interface TownBridge {
  k: 'road' | 'rail' | 'oldrail' | 'foot';
  n: string;
  ref: string;
  loc: string;
  w: number;
  lanes: number;
  layer: number;
  boardwalk: number;
  pts: number[];
}

export interface TownData {
  name: string;
  center: [number, number];
  size: number;
  core: [number, number][];
  kinds: Record<string, number>;
  roofs: Record<string, number>;
  buildings: TownBuilding[];
  bridges: TownBridge[];
  walks: { k: string; pts: number[] }[];
  spots: { n: string; k: string; x: number; z: number }[];
}

export const LC = {
  OTHER: 0,
  RICE: 1,
  WALNUT: 2,
  ALMOND: 3,
  FRUIT: 4,
  GRASS: 5,
  WETLAND: 6,
  WATER: 7,
  URBAN_OPEN: 8,
  URBAN_LOW: 9,
  URBAN_MED: 10,
  URBAN_HIGH: 11,
  WOODLAND: 12,
  ROWCROP: 13,
  FALLOW: 14,
  HAY: 15,
} as const;

export interface OsmRoad {
  name: string;
  kind: string;
  lanes: number;
  oneway?: number;
  /** OSM tracktype 1 (solid gravel) … 5 (faint two-rut), 0 when untagged. */
  grade?: number;
  pts: number[];
}

export interface OsmData {
  roads: OsmRoad[];
  waterways: { name: string; kind: string; pts: number[] }[];
  waterAreas: { name: string; pts: number[] }[];
  buildings: [number, number, number, number, number][];
  power: { pts: number[] }[];
  peaks: { name: string; x: number; z: number; ele: number | null }[];
  places: { name: string; x: number; z: number; kind: string }[];
  masts: { name: string; x: number; z: number; height: number | null }[];
  cemeteries: { name: string; pts: number[] }[];
}
