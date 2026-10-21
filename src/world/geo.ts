// The local tangent plane the data was built in (scripts/lib/geo.mjs):
// x = metres east, z = metres south of the Sutter Buttes.

export const CENTER = { lat: 39.205, lon: -121.815 };

const phi = (CENTER.lat * Math.PI) / 180;
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

export function localToLatLon(x: number, z: number) {
  return { lat: CENTER.lat - z / M_PER_DEG_LAT, lon: CENTER.lon + x / M_PER_DEG_LON };
}

export function latLonToLocal(lat: number, lon: number) {
  return { x: (lon - CENTER.lon) * M_PER_DEG_LON, z: -(lat - CENTER.lat) * M_PER_DEG_LAT };
}

export function formatLatLon(x: number, z: number) {
  const { lat, lon } = localToLatLon(x, z);
  return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
}
