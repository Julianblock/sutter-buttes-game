import * as THREE from 'three';
import type { Controls } from '../birds/input';
import type { Heightfield } from '../world/heightfield';
import type { Water } from '../world/water';

const EYE = 1.62;
const RADIUS = 0.35;
const WALK = 1.5;
const RUN = 4.6;

export interface WalkObstacles {
  /** Pushes the walker's footprint out of walls. */
  push(p: { x: number; z: number }, r: number): void;
  trunk(x: number, z: number, r: number): { nx: number; nz: number; depth: number } | null;
}

/**
 * On foot, first person: WASD with mouse look (pointer lock), Shift to run.
 * Walls and tree trunks block, rivers deeper than the knees turn you back.
 */
export class Walker {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  enabled = false;
  speed = 0;
  /** Distance walked, for footsteps and head bob. */
  stride = 0;
  /** Seconds since the walker last turned to look behind (> 2.4 rad off the walking line). */
  lookBack = 0;
  onStep: (run: boolean, wet: boolean) => void = () => {};
  private vel = new THREE.Vector2();
  private bob = 0;
  private lastStep = 0;
  private finger = -1;
  private last = { x: 0, y: 0 };

  constructor(
    private controls: Controls,
    private el: HTMLElement,
    private hf: Heightfield,
    private water: Water,
    private obstacles: WalkObstacles[],
  ) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      if (e.pointerType === 'touch') {
        if (this.finger === -1) (this.finger = e.pointerId), (this.last = { x: e.clientX, y: e.clientY });
        return;
      }
      if (document.pointerLockElement !== el) el.requestPointerLock?.()?.catch?.(() => {});
    });
    addEventListener('pointerup', (e) => e.pointerId === this.finger && (this.finger = -1));
    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || e.pointerId !== this.finger) return;
      this.look((e.clientX - this.last.x) * 0.006, (e.clientY - this.last.y) * 0.006);
      this.last = { x: e.clientX, y: e.clientY };
    });
    addEventListener('mousemove', (e) => {
      if (this.enabled && document.pointerLockElement === el) this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
  }

  private look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy));
  }

  release() {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  spawn(x: number, z: number, yaw: number) {
    this.pos.set(x, this.hf.height(x, z), z);
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0);
    this.settle();
  }

  private settle() {
    for (const o of this.obstacles) o.push(this.pos, RADIUS);
  }

  update(dt: number, cam: THREE.PerspectiveCamera) {
    const k = this.controls.keys;
    const has = (...c: string[]) => c.some((x) => k.has(x));
    const t = this.controls.touch;
    let f = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - t.y;
    let s = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) + t.x;
    if (has('ArrowLeft')) this.yaw += dt * 1.8;
    if (has('ArrowRight')) this.yaw -= dt * 1.8;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      f -= dz(pad.axes[1] ?? 0);
      s += dz(pad.axes[0] ?? 0);
      this.look(dz(pad.axes[2] ?? 0) * dt * 2.6, dz(pad.axes[3] ?? 0) * dt * 2.0);
    }
    const len = Math.hypot(f, s);
    if (len > 1) (f /= len), (s /= len);
    const run = has('ShiftLeft', 'ShiftRight') || (pad?.buttons[10]?.pressed ?? false);
    const depth = this.depth(this.pos.x, this.pos.z);
    const max = (run ? RUN : WALK) * (depth > 0.3 ? 0.45 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * f + cos * s) * max, wz = (-cos * f - sin * s) * max;
    const a = 1 - Math.exp(-dt * (len > 0.05 ? 9 : 12));
    this.vel.x += (wx - this.vel.x) * a;
    this.vel.y += (wz - this.vel.y) * a;

    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.y * dt;
    // Knee-deep is the limit; past it the bank holds you back.
    if (this.depth(nx, nz) < 0.9 || this.depth(nx, nz) < depth) {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    for (const o of this.obstacles) {
      const hit = o.trunk(this.pos.x, this.pos.z, RADIUS);
      if (hit) (this.pos.x += hit.nx * hit.depth), (this.pos.z += hit.nz * hit.depth);
    }
    this.settle();
    this.pos.y = this.hf.roadHeight(this.pos.x, this.pos.z, -sin, -cos, this.pos.y);
    this.speed = this.vel.length();

    this.stride += this.speed * dt;
    const period = run ? 1.5 : 1.35;
    if (this.stride - this.lastStep > period * 0.5) {
      this.lastStep = this.stride;
      this.onStep(run, depth > 0.05);
    }
    const moving = Math.min(1, this.speed / WALK);
    this.bob = Math.sin((this.stride / period) * Math.PI * 2) * 0.035 * moving * (run ? 1.6 : 1);
    const moveYaw = Math.atan2(-this.vel.x, -this.vel.y);
    const off = Math.abs(Math.atan2(Math.sin(this.yaw - moveYaw), Math.cos(this.yaw - moveYaw)));
    this.lookBack = this.speed > 0.6 && off > 2.4 ? 0 : this.lookBack + dt;

    const ground = Math.max(this.pos.y, this.waterTop(this.pos.x, this.pos.z) - 0.6);
    cam.position.set(this.pos.x, ground + EYE + this.bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, Math.sin((this.stride / period) * Math.PI) * 0.004 * moving, 'YXZ');
    cam.fov = 70;
    cam.near = 0.1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private waterTop(x: number, z: number) {
    const w = this.water.sample(x, z);
    return w.mask > 0.3 ? w.level : -Infinity;
  }

  private depth(x: number, z: number) {
    return Math.max(0, this.waterTop(x, z) - this.hf.height(x, z));
  }
}
