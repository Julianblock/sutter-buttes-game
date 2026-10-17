import * as THREE from 'three';

// Low-precision solar/lunar ephemerides (Meeus, "Astronomical Algorithms").
// Accuracy is a fraction of a degree, which is plenty for lighting.

const RAD = Math.PI / 180;

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function norm360(x: number) {
  return ((x % 360) + 360) % 360;
}

/** Greenwich mean sidereal time in degrees. */
export function gmst(jd: number): number {
  const d = jd - 2451545.0;
  return norm360(280.46061837 + 360.98564736629 * d);
}

export interface RaDec {
  ra: number; // radians
  dec: number; // radians
}

function eclipticToEquatorial(lambda: number, beta: number, jd: number): RaDec {
  const T = (jd - 2451545.0) / 36525;
  const eps = (23.439291 - 0.0130042 * T) * RAD;
  const sl = Math.sin(lambda);
  const ra = Math.atan2(sl * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * sl);
  return { ra, dec };
}

export function sunEcliptic(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + 36000.76983 * T);
  const M = norm360(357.52911 + 35999.05029 * T) * RAD;
  const C =
    (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  return norm360(L0 + C) * RAD;
}

export function sunRaDec(jd: number): RaDec {
  return eclipticToEquatorial(sunEcliptic(jd), 0, jd);
}

export function moonEcliptic(jd: number): { lambda: number; beta: number } {
  const T = (jd - 2451545.0) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T);
  const D = norm360(297.8501921 + 445267.1114034 * T) * RAD;
  const M = norm360(357.5291092 + 35999.0502909 * T) * RAD;
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * RAD;
  const F = norm360(93.272095 + 483202.0175233 * T) * RAD;
  const lon =
    Lp +
    6.289 * Math.sin(Mp) +
    1.274 * Math.sin(2 * D - Mp) +
    0.658 * Math.sin(2 * D) +
    0.214 * Math.sin(2 * Mp) -
    0.186 * Math.sin(M) -
    0.114 * Math.sin(2 * F);
  const lat =
    5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) + 0.278 * Math.sin(Mp - F) + 0.173 * Math.sin(2 * D - F);
  return { lambda: norm360(lon) * RAD, beta: lat * RAD };
}

export function moonRaDec(jd: number): RaDec {
  const { lambda, beta } = moonEcliptic(jd);
  return eclipticToEquatorial(lambda, beta, jd);
}

/** Illuminated fraction of the moon (0 new .. 1 full) and whether it is waxing. */
export function moonPhase(jd: number): { illum: number; waxing: boolean; angle: number } {
  const sun = sunEcliptic(jd);
  const moon = moonEcliptic(jd).lambda;
  const elong = norm360((moon - sun) / RAD);
  const illum = (1 - Math.cos(elong * RAD)) / 2;
  return { illum, waxing: elong < 180, angle: elong * RAD };
}

/**
 * Rotation from the equatorial frame (x: vernal equinox, z: celestial pole)
 * into the local three.js frame (x east, y up, z south).
 */
export function celestialMatrix(jd: number, latDeg: number, lonDeg: number, out = new THREE.Matrix3()) {
  const lst = norm360(gmst(jd) + lonDeg) * RAD;
  const phi = latDeg * RAD;
  const sL = Math.sin(lst);
  const cL = Math.cos(lst);
  const sP = Math.sin(phi);
  const cP = Math.cos(phi);
  out.set(-sL, cL, 0, cP * cL, cP * sL, sP, sP * cL, sP * sL, -cP);
  return out;
}

export function raDecToVector(rd: RaDec, out = new THREE.Vector3()) {
  const c = Math.cos(rd.dec);
  return out.set(c * Math.cos(rd.ra), c * Math.sin(rd.ra), Math.sin(rd.dec));
}

/** Pacific time UTC offset (hours) honouring US daylight saving rules. */
export function pacificOffset(year: number, month: number, day: number): number {
  const firstSunday = (m0: number) => 1 + ((7 - new Date(Date.UTC(year, m0, 1)).getUTCDay()) % 7);
  const secondSundayMarch = firstSunday(2) + 7;
  const firstSundayNov = firstSunday(10);
  const m = month * 100 + day;
  const dst = m >= 300 + secondSundayMarch && m < 1100 + firstSundayNov;
  return dst ? -7 : -8;
}

/** Builds a Date for a local Pacific wall-clock time. */
export function pacificDate(year: number, month: number, day: number, hours: number): Date {
  const off = pacificOffset(year, month, day);
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + (hours - off) * 3600000;
  return new Date(ms);
}
