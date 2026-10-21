import * as THREE from 'three';
import { HorrorDirector, type AmbientEvent, type DirectorInput } from './director';
import { FlowField } from './nav';
import { Nightmare } from './nightmare';
import { Smilers, type SmilerEvent, type SmilerWorld } from './smilers';

export interface HorrorSound {
  smiler(e: SmilerEvent, x: number, y: number, z: number, k: number): void;
  ambient(e: AmbientEvent, k: number, x: number, y: number, z: number): void;
}

/**
 * Nightmare mode's moving parts: the figures, their pathfinding, the
 * director pacing them, and the circle you have to break out of.
 */
export class Horror {
  readonly smilers: Smilers;
  readonly director = new HorrorDirector();
  readonly flow: FlowField;
  /** Walking speed multiplier the circle imposes (1 = free). */
  slow = 1;
  sound: HorrorSound | null = null;
  private veil = document.createElement('div');
  private blackout = 0;
  private wake = false;
  private player = { x: 0, z: 0, speed: 0 };

  constructor(
    readonly nightmare: Nightmare,
    world: SmilerWorld,
  ) {
    this.flow = new FlowField(112, world.blocked);
    this.smilers = new Smilers(world, this.flow);
    this.smilers.onEvent = (e, x, y, z, k) => this.sound?.smiler(e, x, y, z, k);
    this.smilers.onCaught = () => {
      if (this.director.state !== 'PURSUIT') return;
      this.director.caught();
      const r = this.smilers.ring;
      r.x = this.player.x;
      r.z = this.player.z;
      r.t = 0;
      r.open = false;
      r.gap = Math.random() * Math.PI * 2;
    };
    this.director.onAmbient = (e, k) => {
      // Somewhere off to the side, 15..40 m away.
      const a = Math.random() * Math.PI * 2, d = 15 + Math.random() * 25;
      this.sound?.ambient(e, k, this.player.x + Math.sin(a) * d, 0, this.player.z + Math.cos(a) * d);
    };
    this.veil.className = 'veil';
  }

  get root() {
    return this.veil;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, input: Omit<DirectorInput, 'visible' | 'nearest' | 'nightmare'> & { x: number; z: number; ground: number }) {
    this.player.x = input.x;
    this.player.z = input.z;
    this.player.speed = input.speed;
    const d = this.director;
    d.update(dt, { ...input, nightmare: this.nightmare.level, visible: this.smilers.observedCount, nearest: this.smilers.nearest });
    const sm = this.smilers;
    sm.state = d.state;
    sm.want = d.count;
    if (d.state !== 'DORMANT' && input.walking) this.flow.update(dt, input.x, input.z);

    this.slow = 1;
    if (d.state === 'SURROUNDING') {
      const r = sm.ring;
      r.t += dt;
      sm.want = Math.max(sm.want, 7);
      if (r.t < 4.5) {
        // Caught in the circle: legs like lead while they laugh.
        this.slow = 0.22;
      } else if (r.t < 9) {
        if (!r.open) this.sound?.ambient('silence', 1, input.x, 0, input.z);
        r.open = true;
        if (Math.hypot(input.x - r.x, input.z - r.z) > 6.5) {
          d.resolve(true);
          sm.state = d.state;
        }
      } else if (!this.wake) {
        this.wake = true;
        this.blackout = 0.0001;
      }
    }
    // Lights out; you come to, alone.
    if (this.blackout > 0) {
      this.blackout += dt;
      if (this.blackout > 1.6 && this.wake) {
        this.wake = false;
        sm.clear();
        d.resolve(false);
        sm.state = d.state;
      }
      if (this.blackout > 4) this.blackout = 0;
    }
    const veil = this.blackout > 0 ? Math.min(1, this.blackout / 1.2, (4 - this.blackout) / 1.5) : 0;
    this.veil.style.opacity = veil.toFixed(3);
    sm.update(dt, cam, this.player);
  }
}
