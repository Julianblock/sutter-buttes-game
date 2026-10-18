import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import type { CarPhysics } from './car';
import { EYE, type CarModel } from './carModel';

export type DriveView = 'cockpit' | 'hood' | 'chase';
export const DRIVE_VIEWS: DriveView[] = ['cockpit', 'chase', 'hood'];

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** First-person cockpit with free head look, plus hood and chase views. */
export class DriveCamera {
  view: DriveView = 'cockpit';
  yaw = 0;
  pitch = -0.04;
  private idle = 0;
  private head = new THREE.Vector3();
  private headV = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private chaseLook = new THREE.Vector3();
  private init = false;
  private fov = 72;
  private lastVel = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera, private hf: Heightfield) {}

  cycle() {
    this.view = DRIVE_VIEWS[(DRIVE_VIEWS.indexOf(this.view) + 1) % DRIVE_VIEWS.length];
    this.init = false;
  }

  reset() {
    this.init = false;
    this.yaw = 0;
    this.pitch = -0.04;
    this.head.set(0, 0, 0);
    this.headV.set(0, 0, 0);
  }

  update(dt: number, car: CarPhysics, model: CarModel, look: { dx: number; dy: number }) {
    const moved = Math.abs(look.dx) + Math.abs(look.dy) > 1e-5;
    this.yaw -= look.dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -1.0, 0.75);
    this.idle = moved ? 0 : this.idle + dt;
    const lim = this.view === 'chase' ? Math.PI : 2.4;
    this.yaw = THREE.MathUtils.clamp(this.yaw, -lim, lim);
    if (this.idle > 1.2 && Math.abs(car.speed) > 2) {
      this.yaw *= 1 - damp(1.5, dt);
      this.pitch += (-0.04 - this.pitch) * damp(1.5, dt);
    }

    const speed = Math.abs(car.speed);
    const cam = this.cam;
    if (this.view === 'chase') {
      const f = car.forward;
      const back = f.clone().multiplyScalar(-1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const dist = 7.2 + speed * 0.04;
      const el = 0.2 - this.pitch * 0.6;
      const desired = car.pos.clone().addScaledVector(back, dist * Math.cos(el));
      desired.y += 1.3 + dist * Math.sin(el);
      const gh = this.hf.height(desired.x, desired.z) + 1.0;
      if (desired.y < gh) desired.y = gh;
      const lookAt = car.pos.clone().addScaledVector(f, 3).add(new THREE.Vector3(0, 1.3, 0));
      if (!this.init) {
        this.chasePos.copy(desired);
        this.chaseLook.copy(lookAt);
        this.init = true;
      }
      this.chasePos.lerp(desired, damp(6, dt));
      this.chaseLook.lerp(lookAt, damp(14, dt));
      cam.position.copy(this.chasePos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.chaseLook);
      this.setFov(62 + Math.min(speed * 0.25, 12), dt);
      cam.near = 0.25;
    } else {
      // Head sways against the car's acceleration on a soft spring.
      if (dt > 0) {
        const acc = car.vel.clone().sub(this.lastVel).divideScalar(dt);
        this.lastVel.copy(car.vel);
        const inv = model.object.quaternion.clone().invert();
        acc.applyQuaternion(inv);
        const target = new THREE.Vector3(-acc.x * 0.006, 0, -acc.z * 0.006).clampLength(0, 0.08);
        this.headV.addScaledVector(target.sub(this.head), 60 * dt).multiplyScalar(Math.exp(-dt * 9));
        this.head.addScaledVector(this.headV, dt);
      }
      const local = this.view === 'hood' ? new THREE.Vector3(1.6, 1.55, 0) : EYE.clone().add(this.head);
      model.body.updateWorldMatrix(true, false);
      cam.position.copy(local).applyMatrix4(model.body.matrixWorld);
      const bodyQ = new THREE.Quaternion();
      model.body.getWorldQuaternion(bodyQ);
      // Keep the horizon a bit steadier than the cab, like a real neck does.
      const level = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.psi - Math.PI / 2);
      bodyQ.slerp(level, 0.35);
      const turnLook = this.view === 'cockpit' ? car.steerAngle * 0.5 : 0;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, -Math.PI / 2 + this.yaw + turnLook, 0, 'YXZ'));
      cam.quaternion.copy(bodyQ).multiply(q);
      cam.up.set(0, 1, 0);
      this.setFov((this.view === 'hood' ? 66 : 74) + Math.min(speed * 0.18, 10), dt);
      cam.near = 0.08;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private setFov(f: number, dt: number) {
    this.fov += (f - this.fov) * damp(3, dt);
    this.cam.fov = this.fov;
  }
}
