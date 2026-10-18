import type { Heightfield } from '../world/heightfield';
import type { RoadIndex } from '../world/roadIndex';
import { CarPhysics, type DriveInput } from './car';
import { CarModel } from './carModel';

/** The drivable pickup: physics plus its visible model. */
export class Vehicle {
  readonly model = new CarModel();
  readonly physics: CarPhysics;
  /** null = automatic (on at dusk, night and in fog). */
  headlights: boolean | null = null;
  private head = 0;

  constructor(hf: Heightfield, roads: RoadIndex, worldSize: number) {
    this.physics = new CarPhysics(hf, roads, worldSize);
    this.model.object.visible = false;
  }

  get object() {
    return this.model.object;
  }

  spawn(x: number, z: number, psi?: number) {
    this.physics.spawn(x, z, psi);
    this.model.object.visible = true;
    this.sync(0, 0, false);
  }

  place(x: number, z: number, psi: number) {
    this.physics.place(x, z, psi);
    this.model.object.visible = true;
    this.sync(0, 0, false);
  }

  step(dt: number, inp: DriveInput) {
    this.physics.step(dt, inp);
  }

  /** Auto headlights: at night, and in fog, rain or snow (wipers on, lights on). */
  headlightsWanted(night: number, murky: boolean) {
    return this.headlights ?? (night > 0.25 || murky);
  }

  sync(dt: number, night: number, wanted: boolean) {
    const p = this.physics;
    this.head += ((wanted ? 1 : 0) - this.head) * Math.min(1, dt * 12 || 1);
    const o = this.model.object;
    o.position.copy(p.pos);
    o.quaternion.copy(p.quaternion);
    this.model.body.position.y = p.heave;
    this.model.body.rotation.set(p.bodyRoll, 0, p.bodyPitch);
    this.model.update(p.steerAngle, p.wheelSpin, p.braking, this.head * (0.4 + 0.6 * night), Math.min(1, Math.abs(p.speed) / 54), p.rpm);
    o.updateMatrixWorld(true);
  }

  get headOn() {
    return this.head;
  }
}
