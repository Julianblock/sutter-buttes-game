import { emptyInput, type FlightInput } from './flight';

/** Keyboard + gamepad controls, smoothed into analogue flight input. */
export class Controls {
  keys = new Set<string>();
  invertPitch = false;
  readonly input: FlightInput = emptyInput();
  private pressed = new Set<string>();
  private padTakeoff = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** True once per key press. */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  update(dt: number): FlightInput {
    const k = this.keys;
    const axis = (neg: string[], pos: string[]) => (pos.some((c) => k.has(c)) ? 1 : 0) - (neg.some((c) => k.has(c)) ? 1 : 0);
    let pitch = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    if (this.invertPitch) pitch = -pitch;
    let roll = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let yaw = axis(['KeyE'], ['KeyQ']);
    let flap = k.has('Space') ? 1 : 0;
    let tuck = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0;
    let brake = k.has('ControlLeft') || k.has('KeyB') || k.has('KeyF') ? 1 : 0;
    let boost = k.has('KeyR') ? 1 : 0;
    let takeoff = this.consume('Space');

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      roll += dz(pad.axes[0] ?? 0);
      pitch += (this.invertPitch ? -1 : 1) * dz(pad.axes[1] ?? 0);
      yaw -= dz(pad.axes[2] ?? 0) * 0.5;
      flap = Math.max(flap, pad.buttons[0]?.pressed ? 1 : 0, pad.buttons[7]?.value ?? 0);
      tuck = Math.max(tuck, pad.buttons[6]?.value ?? 0, pad.buttons[1]?.pressed ? 1 : 0);
      brake = Math.max(brake, pad.buttons[2]?.pressed ? 1 : 0, pad.buttons[4]?.pressed ? 1 : 0);
      boost = Math.max(boost, pad.buttons[5]?.pressed ? 1 : 0);
      const a = !!pad.buttons[0]?.pressed;
      if (a && !this.padTakeoff) takeoff = true;
      this.padTakeoff = a;
    }

    const i = this.input;
    const s = 1 - Math.exp(-dt * 7);
    i.pitch += (Math.max(-1, Math.min(1, pitch)) - i.pitch) * s;
    // Keys ease the bank in, so a tap is a gentle correction and a hold a full turn.
    const rs = 1 - Math.exp(-dt * (Math.abs(roll) > Math.abs(i.roll) ? 2.2 : 6));
    i.roll += (Math.max(-1, Math.min(1, roll)) - i.roll) * rs;
    i.yaw += (Math.max(-1, Math.min(1, yaw)) - i.yaw) * s;
    i.flap = flap;
    i.tuck += (tuck - i.tuck) * (1 - Math.exp(-dt * 4));
    i.brake += (brake - i.brake) * (1 - Math.exp(-dt * 6));
    i.boost += (boost - i.boost) * (1 - Math.exp(-dt * 5));
    i.takeoff = takeoff;
    return i;
  }
}
