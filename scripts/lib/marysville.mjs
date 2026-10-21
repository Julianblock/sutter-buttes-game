// Marysville and Yuba City: the first town modelled building by building.

import { latLonToLocal } from './geo.mjs';

/**
 * Square zone (m) over Marysville, the Feather River bridges and Ellis Lake,
 * reaching west across the river to take in all of Yuba City.
 */
const CENTER = { lat: 39.144, lon: -121.5895 };
const MARYSVILLE = latLonToLocal(CENTER.lat, CENTER.lon);

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

// Marysville High School grounds (OSM way 1056310333); its buildings are unnamed.
const MHS = [[19994, 5617], [19685, 5649], [19675, 5640], [19662, 5525], [19615, 5530], [19610, 5527], [19601, 5441], [19580, 5358], [19549, 5274], [19549, 5264], [19578, 5228], [19578, 5208], [19572, 5142], [19578, 5106], [19590, 5082], [19729, 4891], [19758, 4867], [19775, 4862], [19846, 4854], [19866, 4875], [19868, 4896], [19879, 4953], [19922, 4944], [19930, 5020]];

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

export const MARYSVILLE_TOWN = {
  id: 'marysville',
  name: 'Marysville',
  x: MARYSVILLE.x - 2000,
  z: MARYSVILLE.z,
  size: 9400,
  core: CORE,
  oldTown: OLD_TOWN,
  campuses: [{ id: 'mhs', ring: MHS }],
  nameFix: NAME_FIX,
  landmarks: LANDMARKS,
};
