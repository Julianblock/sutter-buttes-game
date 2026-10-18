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
  private finger = -1;
  private last = { x: 0, y: 0 };

  constructor(private controls: Controls, private el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      if (e.pointerType === 'touch') {
        // Drag a finger across the view to look around.
        if (this.finger === -1) (this.finger = e.pointerId), (this.last = { x: e.clientX, y: e.clientY });
        return;
      }
      this.dragging = true;
      if (document.pointerLockElement !== el) el.requestPointerLock?.()?.catch?.(() => {});
    });
    const lift = (e: PointerEvent) => {
      if (e.pointerId === this.finger) this.finger = -1;
      else this.dragging = false;
    };
    addEventListener('pointerup', lift);
    addEventListener('pointercancel', lift);
    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerId !== this.finger) return;
      this.lookDX += (e.clientX - this.last.x) * 0.005;
      this.lookDY += (e.clientY - this.last.y) * 0.005;
      this.last = { x: e.clientX, y: e.clientY };
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled || this.finger !== -1) return;
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
    // Thumb-stick: sideways steers; pushing it up or down works the pedals too.
    const t = this.controls.touch;
    steer -= t.x;
    throttle = Math.max(throttle, Math.max(0, -t.y - 0.25) / 0.75);
    brake = Math.max(brake, Math.max(0, t.y - 0.25) / 0.75);

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
