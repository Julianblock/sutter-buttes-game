import * as THREE from 'three';
import { G } from '../render/globals';
import type { Environment, MoonPref, TimePreset, Weather } from '../world/environment';

/**
 * Nightmare mode: the same valley, same streets, same buildings, on a night
 * that has gone wrong. Purely an overlay; switching it off restores the sky,
 * weather and life exactly as they were.
 */
export class Nightmare {
  active = false;
  /** Eased 0..1 blend; the shaders read it through G.uNightmare. */
  level = 0;
  private saved: { time: TimePreset; weather: Weather; moon: MoonPref; timeFlow: number } | null = null;
  /** Things that live only in the waking world (traffic, pedestrians). */
  private hidden: THREE.Object3D[] = [];
  onChange: (on: boolean) => void = () => {};

  constructor(private env: Environment, hidden: (THREE.Object3D | null | undefined)[]) {
    this.hidden = hidden.filter((o): o is THREE.Object3D => !!o);
  }

  set(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    const env = this.env;
    if (on) {
      this.saved = { time: env.time, weather: env.weather, moon: env.moon, timeFlow: env.timeFlow };
      env.moon = 'new';
      env.timeFlow = 0;
      env.setPreset('night');
      env.setWeather('tulefog');
    } else if (this.saved) {
      env.moon = this.saved.moon;
      env.timeFlow = this.saved.timeFlow;
      env.setPreset(this.saved.time);
      env.setWeather(this.saved.weather);
      this.saved = null;
    }
    this.onChange(on);
  }

  toggle() {
    this.set(!this.active);
  }

  /** After env.apply(): bend the night further than nature would. `ground` is the terrain under the camera. */
  apply(dt: number, ground: number) {
    this.level += ((this.active ? 1 : 0) - this.level) * (1 - Math.exp(-dt * 0.9));
    if (Math.abs(this.level - (this.active ? 1 : 0)) < 0.002) this.level = this.active ? 1 : 0;
    const k = this.level;
    G.uNightmare.value = k;
    for (const o of this.hidden) o.visible = k < 0.5;
    if (k <= 0) return;
    // Dead calm: the rice and the oaks stop moving.
    G.uWind.value.multiplyScalar(1 - 0.94 * k);
    // A starless, moonless murk.
    G.uMoonScale.value *= 1 - 0.85 * k;
    G.uMieScale.value = THREE.MathUtils.lerp(G.uMieScale.value, 3.2, k);
    // Ground fog that pools a few metres deep along the streets and fields.
    G.uFogDensity.value = THREE.MathUtils.lerp(G.uFogDensity.value, 0.0075, k);
    G.uFogTop.value = THREE.MathUtils.lerp(G.uFogTop.value, ground + 22, k);
    this.env.exposure *= 1 - 0.45 * k;
  }
}
