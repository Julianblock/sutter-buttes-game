import type { HorrorState } from './smilers';
import { mulberry } from './smilers';

export interface DirectorInput {
  /** Nightmare blend 0..1. */
  nightmare: number;
  /** On foot (the full hunt); flying or driving only gets watched from afar. */
  walking: boolean;
  /** Inside a detailed town. */
  inTown: boolean;
  /** 0..1, how close to a haunted building (1 = at the door). */
  haunt: number;
  /** 0 day .. 1 full night. */
  darkness: number;
  speed: number;
  running: boolean;
  /** Seconds since the player last looked back over their shoulder. */
  lookBack: number;
  /** Figures in view right now. */
  visible: number;
  /** Nearest figure (m). */
  nearest: number;
}

export type AmbientEvent = 'bang' | 'creak' | 'knock' | 'whisper' | 'silence' | 'footsteps';

/**
 * Paces the horror. Tension (0..100) climbs with darkness, being in town,
 * nearing a haunted house, running, looking back and seeing them, and is
 * spent by big moments; after each it enforces a quiet spell.
 */
export class HorrorDirector {
  tension = 0;
  state: HorrorState = 'DORMANT';
  /** How many figures to keep out. */
  count = 0;
  /** Seconds of enforced calm left after a climax. */
  cooldown = 0;
  /** Recent intensity, decays over a minute or so. */
  recent = 0;
  /** Seconds in the current state. */
  stateT = 0;
  onAmbient: (e: AmbientEvent, k: number) => void = () => {};
  private nextAmbient = 6;
  private rnd = mulberry(0xd1ec7);

  /** The figures got you, or you got away. */
  resolve(escaped: boolean) {
    this.tension = escaped ? 30 : 8;
    this.cooldown = escaped ? 35 : 50;
    this.recent = 1;
    this.set('OBSERVING');
  }

  private set(s: HorrorState) {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
  }

  update(dt: number, i: DirectorInput) {
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recent *= Math.exp(-dt / 70);
    if (i.nightmare < 0.5) {
      this.tension = Math.max(0, this.tension - dt * 20);
      this.set('DORMANT');
      this.count = 0;
      return;
    }

    // Pressure in, relief out.
    let rise = 0.35 + 0.5 * i.darkness;
    if (i.inTown) rise += 0.5;
    rise += 2.2 * i.haunt;
    if (i.running) rise += 0.8;
    if (i.lookBack < 1.5) rise += 1.2;
    rise += 1.1 * Math.min(4, i.visible);
    if (i.nearest < 6) rise += 1.5;
    rise *= 1 - 0.6 * this.recent;
    if (this.cooldown > 0) rise = -1.5;
    if (!i.walking) rise = Math.min(rise, 30 - this.tension);
    this.tension = Math.max(0, Math.min(100, this.tension + rise * dt));

    if (this.state === 'PURSUIT' || this.state === 'SURROUNDING') return this.ambient(dt, i);
    const t = this.tension;
    // Hysteresis: a state holds for at least a few seconds before it eases back.
    const hold = this.stateT < 6;
    let next: HorrorState;
    if (!i.walking) next = 'OBSERVING';
    else if (t >= 72 && this.cooldown <= 0) next = 'PURSUIT';
    else if (t >= 44) next = 'GATHERING';
    else if (t >= 18) next = 'FOLLOWING';
    else next = 'OBSERVING';
    const rank = ['DORMANT', 'OBSERVING', 'FOLLOWING', 'GATHERING', 'PURSUIT', 'SURROUNDING'];
    if (!hold || rank.indexOf(next) > rank.indexOf(this.state)) {
      if (next === 'PURSUIT') this.onAmbient('silence', 1);
      this.set(next);
    }
    this.count =
      this.state === 'OBSERVING' ? (t < 8 ? 1 : 2) : this.state === 'FOLLOWING' ? 2 + Math.floor((t - 18) / 13) : this.state === 'GATHERING' ? 4 + Math.floor((t - 44) / 7) : 7;
    if (!i.walking) this.count = Math.min(this.count, 3);
    this.ambient(dt, i);
  }

  /** Pursuit begins; the figures report back via caught() or the escape. */
  get hunting() {
    return this.state === 'PURSUIT' || this.state === 'SURROUNDING';
  }

  caught() {
    if (this.state === 'PURSUIT') this.set('SURROUNDING');
  }

  /** Bangs, knocks and creaks from the town around you, rarer when you are calm. */
  private ambient(dt: number, i: DirectorInput) {
    this.nextAmbient -= dt;
    if (this.nextAmbient > 0) return;
    const calm = this.cooldown > 0 ? 2.5 : 1;
    this.nextAmbient = (5 + 22 * (1 - this.tension / 100)) * calm * (0.6 + this.rnd() * 0.8);
    const r = this.rnd();
    const e: AmbientEvent = i.inTown
      ? r < 0.25 ? 'bang' : r < 0.5 ? 'creak' : r < 0.7 ? 'knock' : r < 0.88 ? 'whisper' : 'footsteps'
      : r < 0.4 ? 'creak' : r < 0.7 ? 'whisper' : 'bang';
    this.onAmbient(e, 0.4 + 0.6 * (this.tension / 100));
  }
}
