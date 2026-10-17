// Local tangent-plane coordinates centred on the Sutter Buttes.
// x = metres east, z = metres south (three.js convention: -z is north).

export const CENTER = { lat: 39.205, lon: -121.815 };

const phi = (CENTER.lat * Math.PI) / 180;
export const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

export function localToLatLon(x, z) {
  return {
    lat: CENTER.lat - z / M_PER_DEG_LAT,
    lon: CENTER.lon + x / M_PER_DEG_LON,
  };
}

export function latLonToLocal(lat, lon) {
  return {
    x: (lon - CENTER.lon) * M_PER_DEG_LON,
    z: -(lat - CENTER.lat) * M_PER_DEG_LAT,
  };
}

/** Global Web Mercator pixel coordinates at a zoom level (256px tiles). */
export function latLonToMercatorPx(lat, lon, zoom) {
  const scale = 256 * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    px: ((lon + 180) / 360) * scale,
    py: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

/** Bounding box (lat/lon) of a square region of `size` metres centred at the origin. */
export function regionBounds(size) {
  const h = size / 2;
  const nw = localToLatLon(-h, -h);
  const se = localToLatLon(h, h);
  return { north: nw.lat, south: se.lat, west: nw.lon, east: se.lon };
}
