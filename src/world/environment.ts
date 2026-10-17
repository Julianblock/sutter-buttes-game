import * as THREE from 'three';
import { G } from '../render/globals';
import { seasonUniforms } from '../render/terrain';
import {
  celestialMatrix,
  julianDate,
  moonPhase,
  moonRaDec,
  pacificDate,
  raDecToVector,
  sunRaDec,
} from '../sky/astro';

export type Season = 'winter' | 'almond' | 'spring' | 'summer' | 'fall';
export type TimePreset =
  | 'night'
  | 'predawn'
  | 'sunrise'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'golden'
  | 'sunset'
  | 'dusk';
export type Weather = 'crisp' | 'clear' | 'hazy' | 'partly' | 'overcast' | 'tulefog';
export type MoonPref = 'full' | 'quarter' | 'new' | 'actual';

export const MOONS: Record<MoonPref, { label: string }> = {
  full: { label: 'Full Moon' },
  quarter: { label: 'Half Moon' },
  new: { label: 'New Moon (Milky Way)' },
  actual: { label: 'Real Calendar' },
};

export const SEASONS: Record<Season, { label: string; month: number; day: number; blurb: string }> = {
  winter: { label: 'Winter', month: 1, day: 14, blurb: 'Green hills, flooded rice, snow geese by the tens of thousands' },
  almond: { label: 'Almond Bloom', month: 2, day: 22, blurb: 'Orchards in white blossom around the Buttes' },
  spring: { label: 'Spring', month: 4, day: 6, blurb: 'Poppies and lupine, lush emerald slopes' },
  summer: { label: 'Summer', month: 7, day: 12, blurb: 'Golden grass, green rice, heat shimmer' },
  fall: { label: 'Fall', month: 10, day: 18, blurb: 'Rice harvest, walnut gold, first migrants arrive' },
};

export const TIMES: Record<TimePreset, { label: string }> = {
  night: { label: 'Night' },
  predawn: { label: 'Blue Hour (Dawn)' },
  sunrise: { label: 'Sunrise' },
  morning: { label: 'Morning' },
  midday: { label: 'Midday' },
  afternoon: { label: 'Afternoon' },
  golden: { label: 'Golden Hour' },
  sunset: { label: 'Sunset' },
  dusk: { label: 'Dusk' },
};

/** `wind` is mean surface wind speed (m/s). */
export const WEATHERS: Record<Weather, { label: string; mie: number; cloud: number; fog: number; fogTop: number; wind: number }> = {
  crisp: { label: 'Crystal Clear (after rain)', mie: 0.45, cloud: 0.12, fog: 0, fogTop: -1000, wind: 6.5 },
  clear: { label: 'Clear', mie: 1.5, cloud: 0.04, fog: 0, fogTop: -1000, wind: 3.5 },
  hazy: { label: 'Valley Haze', mie: 4.0, cloud: 0.0, fog: 0, fogTop: -1000, wind: 1.3 },
  partly: { label: 'Scattered Clouds', mie: 1.3, cloud: 0.5, fog: 0, fogTop: -1000, wind: 4.5 },
  overcast: { label: 'Overcast', mie: 2.2, cloud: 0.97, fog: 0, fogTop: -1000, wind: 5.0 },
  tulefog: { label: 'Tule Fog', mie: 1.8, cloud: 0.0, fog: 0.011, fogTop: 135, wind: 0.4 },
};

// Month keyframes (Jan..Dec) for vegetation state in the Sacramento Valley.
const K = {
  green: [0.9, 1, 1, 1, 0.6, 0.15, 0, 0, 0, 0.05, 0.35, 0.75],
  oakLeaf: [0, 0, 0.3, 0.9, 1, 1, 1, 1, 1, 0.9, 0.6, 0.2],
  flowers: [0, 0.1, 0.8, 1, 0.3, 0, 0, 0, 0, 0, 0, 0],
  wetFlood: [1, 1, 0.8, 0.5, 0.3, 0.2, 0.1, 0.1, 0.3, 0.6, 0.9, 1],
  riceFlood: [1, 0.9, 0.4, 0, 0, 0, 0, 0, 0, 0.1, 0.6, 0.95],
  riceSprout: [0, 0, 0, 0.6, 1, 0.2, 0, 0, 0, 0, 0, 0],
  riceGreen: [0, 0, 0, 0, 0.1, 0.8, 1, 1, 0.5, 0, 0, 0],
  riceGold: [0, 0.1, 0.6, 0.4, 0, 0, 0, 0, 0.5, 0.9, 0.4, 0.05],
  bare: [1, 0.6, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.85],
  almond: [0, 0.95, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  fruit: [0, 0.1, 0.9, 0.1, 0, 0, 0, 0, 0, 0, 0, 0],
  autumn: [0, 0, 0, 0, 0, 0, 0, 0.1, 0.3, 0.8, 0.7, 0.1],
  snowLine: [1300, 1300, 1600, 2000, 2500, 3000, 3300, 3400, 3300, 2700, 1900, 1400],
  geese: [1, 0.9, 0.4, 0, 0, 0, 0, 0, 0, 0.5, 0.95, 1],
};

function monthly(keys: number[], monthF: number): number {
  const m = monthF - 0.5;
  const i0 = ((Math.floor(m) % 12) + 12) % 12;
  const i1 = (i0 + 1) % 12;
  const t = m - Math.floor(m);
  return keys[i0] + (keys[i1] - keys[i0]) * t;
}

const RAD = Math.PI / 180;

export class Environment {
  season: Season = 'summer';
  time: TimePreset = 'golden';
  weather: Weather = 'clear';
  year = 2026;
  /** Local wall-clock hours (fractional). */
  hours = 18;
  timeFlow = 0; // game seconds per real second (0 = frozen)
  latitude = 39.205;
  longitude = -121.815;
  sunAltitude = 0;
  exposure = 0.3;
  geese = 0;
  private windT = 0;
  private sunVec = new THREE.Vector3();
  private moonVec = new THREE.Vector3();

  get month() {
    return SEASONS[this.season].month;
  }
  get day() {
    return SEASONS[this.season].day;
  }

  /** Preferred lunar phase; shifts the astronomical date up to ±15 days. */
  moon: MoonPref = 'full';
  private dayShift = 0;

  date(hours = this.hours) {
    return pacificDate(this.year, this.month, this.day + this.dayShift, hours);
  }

  private chooseMoonDay() {
    this.dayShift = 0;
    if (this.moon === 'actual') return;
    const target = this.moon === 'full' ? 1 : this.moon === 'quarter' ? 0.5 : 0;
    let best = Infinity;
    for (let d = -15; d <= 15; d++) {
      const jd = julianDate(pacificDate(this.year, this.month, this.day + d, 23));
      const ph = moonPhase(jd);
      // Prefer a waxing quarter so the moon is up in the evening.
      const score = Math.abs(ph.illum - target) + (this.moon === 'quarter' && !ph.waxing ? 0.3 : 0);
      if (score < best) {
        best = score;
        this.dayShift = d;
      }
    }
  }

  sunDirAt(hours: number, out = new THREE.Vector3()) {
    const jd = julianDate(this.date(hours));
    const m = celestialMatrix(jd, this.latitude, this.longitude);
    return raDecToVector(sunRaDec(jd), out).applyMatrix3(m).normalize();
  }

  /** Finds the local hour at which the sun reaches an altitude (degrees). */
  hourForAltitude(altDeg: number, rising: boolean): number {
    const target = Math.sin(altDeg * RAD);
    const v = new THREE.Vector3();
    let prev = this.sunDirAt(rising ? 0 : 12, v).y;
    for (let m = 1; m <= 12 * 60; m++) {
      const h = (rising ? 0 : 12) + m / 60;
      const y = this.sunDirAt(h, v).y;
      if (rising ? prev < target && y >= target : prev > target && y <= target) return h;
      prev = y;
    }
    return rising ? 6 : 18;
  }

  hoursForPreset(p: TimePreset): number {
    switch (p) {
      case 'night':
        return this.hourForAltitude(-18, false) + 1.5;
      case 'predawn':
        return this.hourForAltitude(-5, true);
      case 'sunrise':
        return this.hourForAltitude(1.5, true);
      case 'morning':
        return this.hourForAltitude(1.5, true) + 2.2;
      case 'midday':
        return (this.hourForAltitude(0, true) + this.hourForAltitude(0, false)) / 2;
      case 'afternoon':
        return this.hourForAltitude(0, false) - 3;
      case 'golden':
        return this.hourForAltitude(7, false);
      case 'sunset':
        return this.hourForAltitude(1.0, false);
      case 'dusk':
        return this.hourForAltitude(-4.5, false);
    }
  }

  setPreset(p: TimePreset) {
    this.chooseMoonDay();
    this.time = p;
    this.hours = this.hoursForPreset(p);
  }

  /** Pushes the current state into the global uniforms. */
  apply(dt: number) {
    if (this.timeFlow) this.hours = (this.hours + (dt * this.timeFlow) / 3600 + 24) % 24;

    const jd = julianDate(this.date());
    const m = celestialMatrix(jd, this.latitude, this.longitude, G.uCelestial.value);
    raDecToVector(sunRaDec(jd), this.sunVec).applyMatrix3(m).normalize();
    raDecToVector(moonRaDec(jd), this.moonVec).applyMatrix3(m).normalize();
    G.uSunDir.value.copy(this.sunVec);
    G.uMoonDir.value.copy(this.moonVec);
    const phase = moonPhase(jd);
    G.uMoonIllum.value = phase.illum;
    G.uMoonPhaseAngle.value = phase.angle;

    const sunAlt = Math.asin(this.sunVec.y) / RAD;
    this.sunAltitude = sunAlt;
    const moonUp = THREE.MathUtils.smoothstep(this.moonVec.y, -0.02, 0.05);
    // Moonlight is boosted far above reality so night play reads like "day for night".
    G.uMoonScale.value = 9e-5 * (0.15 + 0.85 * phase.illum) * moonUp;
    G.uNight.value = THREE.MathUtils.smoothstep(-sunAlt, 2, 10);

    const w = WEATHERS[this.weather];
    G.uMieScale.value = w.mie;
    G.uCloudCover.value = w.cloud;
    G.uFogDensity.value = w.fog;
    G.uFogTop.value = w.fogTop;

    // Surface wind: post-frontal north wind after rain and in winter, the
    // southwesterly Delta breeze on summer days. Strength and direction wander.
    this.windT += dt;
    const t = this.windT;
    const summer = Math.max(0, Math.cos(((this.month - 7) / 12) * Math.PI * 2));
    const north = this.weather === 'crisp' ? 1 : 1 - summer;
    const from = THREE.MathUtils.lerp(-2.36, 0.15, north) + 0.25 * Math.sin(t * 0.021) + 0.1 * Math.sin(t * 0.077);
    const speed = w.wind * (0.85 + 0.2 * Math.sin(t * 0.033) + 0.12 * Math.sin(t * 0.13 + 1.3));
    // 'from' is the bearing the wind blows from (0 = north); it blows toward the opposite.
    G.uWind.value.set(-Math.sin(from) * speed, Math.cos(from) * speed);

    const mf = this.month + (this.day - 1) / 30;
    G.uYearPhase.value = (mf - 1) / 12;
    seasonUniforms.uVeg.value.set(monthly(K.green, mf), monthly(K.oakLeaf, mf), monthly(K.flowers, mf), monthly(K.wetFlood, mf));
    seasonUniforms.uRice.value.set(monthly(K.riceFlood, mf), monthly(K.riceSprout, mf), monthly(K.riceGreen, mf), monthly(K.riceGold, mf));
    seasonUniforms.uOrchard.value.set(monthly(K.bare, mf), monthly(K.almond, mf), monthly(K.fruit, mf), monthly(K.autumn, mf));
    seasonUniforms.uSnowLine.value = monthly(K.snowLine, mf);
    this.geese = monthly(K.geese, mf);

    this.exposure = this.computeExposure(sunAlt, G.uMoonScale.value, w.cloud);
  }

  private computeExposure(sunAlt: number, moonScale: number, cloud: number): number {
    const keys: [number, number][] = [
      [-90, 900],
      [-18, 900],
      [-12, 160],
      [-8, 30],
      [-4, 4.5],
      [0, 1.0],
      [5, 0.42],
      [12, 0.27],
      [30, 0.2],
      [90, 0.18],
    ];
    let e = keys[keys.length - 1][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [a0, e0] = keys[i];
      const [a1, e1] = keys[i + 1];
      if (sunAlt >= a0 && sunAlt <= a1) {
        const t = (sunAlt - a0) / (a1 - a0);
        e = Math.exp(Math.log(e0) + (Math.log(e1) - Math.log(e0)) * t);
        break;
      }
    }
    if (sunAlt < -10) e *= THREE.MathUtils.lerp(1.6, 0.55, Math.min(1, moonScale / 9e-5));
    if (sunAlt > 0) e *= 1 + cloud * 0.9;
    return e;
  }
}
