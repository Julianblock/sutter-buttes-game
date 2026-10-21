// Princeton, Colusa County: a river village of a few hundred people on the
// west bank of the Sacramento, 23 km northwest of the Buttes.

import { latLonToLocal } from './geo.mjs';

// The post office corner on Prince Street, the centre of the village.
const CENTER = latLonToLocal(39.4035, -122.0108);

export const PRINCETON_TOWN = {
  id: 'princeton',
  name: 'Princeton',
  x: CENTER.x,
  z: CENTER.z,
  size: 3600,
  // OSM maps only a handful of buildings here; the rest come from Microsoft's footprints.
  msQuadkey: '023010030',
  registry: true,
  extraQuery: (bbox) => `node["amenity"~"^(school|post_office|fire_station|townhall|library|community_centre)$"](${bbox});`,
  landmarks: [
    { id: 'pr-church', re: /saint joseph catholic/i, fidelity: 'OSM footprint; white gable church massing, no street-level reference reviewed' },
    { id: 'pr-fire', re: /princeton fire/i, fidelity: 'OSM footprint; generic station massing' },
    { id: 'pr-post', re: /princeton post office/i, fidelity: 'OSM point matched to the ML footprint under it; generic massing' },
    { id: 'pr-elem', re: /princeton elementary/i, fidelity: 'OSM point matched to the nearest ML footprint; campus layout from footprints only' },
    { id: 'pr-high', re: /princeton junior-senior high/i, fidelity: 'OSM point matched to the nearest ML footprint; campus layout from footprints only' },
  ],
};
