import * as THREE from 'three';
import type { FlightModel } from './flight';
import type { Heightfield } from '../world/heightfield';

export type CameraMode = 'chase' | 'far' | 'side' | 'head' | 'cinematic';
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'side', 'head', 'cinematic'];

function damp(rate: number, dt: number) {
  return 1 - Math.exp(-rate * dt);
}

/** Spring-damped chase camera with free-look orbit, zoom and cinematic modes. */
export class ChaseCamera {
  mode: CameraMode = 'chase';
  zoom = 1;
  orbitYaw = 0;
  orbitPitch = 0;
  private dragging = false;
  private idle = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private roll = 0;
  private fov = 60;
  private init = false;
  private cineAnchor = new THREE.Vector3();
  private cineTimer = 0;
  shake = 0;

  constructor(private cam: THREE.PerspectiveCamera, private hf: Heightfield, el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    });
    addEventListener('pointerup', () => (this.dragging = false));
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= e.movementX * 0.005;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + e.movementY * 0.004, -1.2, 1.3);
      this.idle = 0;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), 0.35, 6);
      },
      { passive: true },
    );
  }

  cycle() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.cineTimer = 0;
  }

  update(dt: number, bird: FlightModel, birdObj: THREE.Object3D) {
    const span = bird.species.shape.wingspan;
    const fwd = bird.forward;
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) flat.set(Math.sin(bird.psi), 0, Math.cos(bird.psi));
    flat.normalize();
    const right = new THREE.Vector3(-flat.z, 0, flat.x);
    this.idle += dt;
    if (!this.dragging && this.idle > 1.5) {
      this.orbitYaw *= 1 - damp(1.2, dt);
      this.orbitPitch *= 1 - damp(1.2, dt);
    }

    const target = birdObj.position.clone();
    let desired = new THREE.Vector3();
    let lookAt = target.clone();
    let follow = 5;
    let rollFollow = 0.25;
    let fov = 58 + THREE.MathUtils.clamp((bird.speed - 10) * 0.35, 0, 22);

    if (this.mode === 'head') {
      const q = birdObj.quaternion;
      const off = new THREE.Vector3(0, bird.species.shape.headSize * 0.9, bird.species.shape.length * 0.42).applyQuaternion(q);
      desired.copy(target).add(off);
      lookAt.copy(desired).addScaledVector(fwd, 50);
      follow = 40;
      rollFollow = 0.8;
      fov = 72 + THREE.MathUtils.clamp((bird.speed - 10) * 0.3, 0, 18);
    } else if (this.mode === 'cinematic') {
      this.cineTimer -= dt;
      const d0 = this.cineAnchor.distanceTo(target);
      if (this.cineTimer <= 0 || d0 > 220 + span * 40) {
        // Drop a fixed camera ahead of the bird, off to one side.
        const ahead = Math.max(bird.speed, 6) * 5;
        const side = (Math.random() < 0.5 ? -1 : 1) * (12 + span * 10);
        this.cineAnchor.copy(target).addScaledVector(flat, ahead).addScaledVector(right, side);
        const gh = this.hf.height(this.cineAnchor.x, this.cineAnchor.z);
        this.cineAnchor.y = Math.max(target.y + (Math.random() - 0.4) * 10, gh + 3);
        this.cineTimer = 9;
        this.pos.copy(this.cineAnchor);
      }
      desired.copy(this.cineAnchor);
      follow = 100;
      rollFollow = 0;
      fov = THREE.MathUtils.clamp(2 * Math.atan((span * 6) / (2 * Math.max(d0, 1))) * THREE.MathUtils.RAD2DEG, 8, 60);
    } else {
      let dist = span * 3.2 + 1.2;
      let height = span * 0.55;
      if (this.mode === 'far') {
        dist = span * 9 + 6;
        height = span * 2.0;
      }
      if (this.mode === 'side') {
        dist = span * 3.5 + 1.5;
        height = span * 0.2;
      }
      dist *= this.zoom * (1 + THREE.MathUtils.clamp(bird.speed / 120, 0, 0.35));
      let yaw = this.orbitYaw + (this.mode === 'side' ? Math.PI / 2 : 0);
      // Look into turns a little.
      yaw += bird.phi * 0.25;
      const pitch = this.orbitPitch + Math.atan2(height, dist) - (bird.state === 'flying' ? bird.gamma * 0.4 : 0);
      const back = flat.clone().multiplyScalar(-1);
      back.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      desired.copy(target).addScaledVector(back, dist * Math.cos(pitch));
      desired.y += dist * Math.sin(pitch);
      lookAt.copy(target).addScaledVector(fwd, span * 1.5);
      follow = this.mode === 'far' ? 3 : 6;
    }

    if (!this.init) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.init = true;
    }
    this.pos.lerp(desired, damp(follow, dt));
    this.look.lerp(lookAt, damp(follow * 2.5, dt));
    // Stay above terrain.
    const gh = this.hf.height(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 1.2) this.pos.y = gh + 1.2;

    this.roll += (-bird.phi * rollFollow - this.roll) * damp(4, dt);
    this.fov += (fov - this.fov) * damp(2.5, dt);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
    this.cam.position.copy(this.pos);
    if (this.shake > 0) {
      this.cam.position.x += (Math.random() - 0.5) * this.shake;
      this.cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.up.set(0, 1, 0);
    this.cam.up.copy(this.up);
    this.cam.lookAt(this.look);
    this.cam.rotateZ(this.roll);
    this.cam.updateMatrixWorld();
  }
}
