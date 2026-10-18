import type { MoonPref, Season, TimePreset, Weather } from '../world/environment';

export interface CustomColors {
  back?: string;
  belly?: string;
  head?: string;
  tail?: string;
}

export interface GameSettings {
  bird: string;
  palette: number;
  custom: CustomColors;
  season: Season;
  time: TimePreset;
  weather: Weather;
  moon: MoonPref;
  timeFlow: number;
  invertPitch: boolean;
  units: 'imperial' | 'metric';
  truck: string;
}

const KEY = 'sutter-buttes-settings-v1';

export const DEFAULT_SETTINGS: GameSettings = {
  bird: 'redtail',
  palette: 0,
  custom: {},
  season: 'spring',
  time: 'golden',
  weather: 'clear',
  moon: 'full',
  timeFlow: 0,
  invertPitch: false,
  units: 'imperial',
  truck: 'cherry',
};

export function loadSettings(params: URLSearchParams): GameSettings {
  let s: GameSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = { ...s, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt storage */
  }
  const p = (k: string) => params.get(k);
  if (p('bird')) s.bird = p('bird')!;
  if (p('palette')) s.palette = Number(p('palette'));
  if (p('season')) s.season = p('season') as Season;
  if (p('time')) s.time = p('time') as TimePreset;
  if (p('weather')) s.weather = p('weather') as Weather;
  if (p('moon')) s.moon = p('moon') as MoonPref;
  return s;
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable */
  }
}
