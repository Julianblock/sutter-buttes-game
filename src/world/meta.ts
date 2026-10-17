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
}
