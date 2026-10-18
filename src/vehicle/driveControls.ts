import type { Controls } from '../birds/input';
import { emptyDriveInput, type DriveInput } from './car';

/** Driving input on top of the shared key state, plus shooter-style mouse look. */
export class DriveControls {
  readonly input: DriveInput = emptyDriveInput();
  enabled = false;
  /** Accumulated mouse look since the last read (rad). */
  lookDX = 0;
  lookDY = 0;
  private dragging = false;

  constructor(private controls: Controls, private el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.dragging = true;
      if (document.pointerLockElement !== el) el.requestPointerLock?.()?.catch?.(() => {});
    });
    addEventListener('pointerup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === el || this.dragging) {
        this.lookDX += e.movementX * 0.0022;
        this.lookDY += e.movementY * 0.0022;
      }
    });
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  release() {
    if (this.locked) document.exitPointerLock();
  }

  update(dt: number): DriveInput {
    const k = this.controls.keys;
    const has = (...c: string[]) => c.some((x) => k.has(x));
    let throttle = has('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = has('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = has('Space') ? 1 : 0;
    let boost = has('ShiftLeft', 'ShiftRight', 'KeyR') ? 1 : 0;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9);
      steer -= dz(pad.axes[0] ?? 0);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake = Math.max(handbrake, pad.buttons[0]?.pressed ? 1 : 0);
      boost = Math.max(boost, pad.buttons[5]?.pressed ? 1 : 0);
      this.lookDX += dz(pad.axes[2] ?? 0) * dt * 2.5;
      this.lookDY += dz(pad.axes[3] ?? 0) * dt * 2.0;
    }

    const i = this.input;
    steer = Math.max(-1, Math.min(1, steer));
    // Keys ease the wheel in and let it spring back quickly.
    const sr = 1 - Math.exp(-dt * (Math.abs(steer) > Math.abs(i.steer) && Math.sign(steer) === Math.sign(i.steer || steer) ? 3.2 : 7));
    i.steer += (steer - i.steer) * sr;
    i.throttle += (throttle - i.throttle) * (1 - Math.exp(-dt * 8));
    i.brake += (brake - i.brake) * (1 - Math.exp(-dt * 10));
    i.handbrake = handbrake;
    i.boost += (boost - i.boost) * (1 - Math.exp(-dt * 5));
    if (i.throttle < 0.01) i.throttle = 0;
    if (i.brake < 0.01) i.brake = 0;
    return i;
  }

  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return r;
  }
}
