import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { LC } from '../world/meta';
import type { RoadIndex, RoadHit } from '../world/roadIndex';
import { TRACK, WHEELBASE, WHEEL_R } from './carModel';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, then reverse when stopped)
  steer: number; // -1..1, + = left
  handbrake: number;
  boost: number;
}

export type ObstacleQuery = (x: number, z: number, radius: number) => { nx: number; nz: number; depth: number } | null;

export const emptyDriveInput = (): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 });

export interface Surface {
  name: string;
  /** What the HUD calls it once the weather has had its way. */
  label: string;
  grip: number; // friction coefficient
  roll: number; // rolling resistance (fraction of g)
  top: number; // practical top speed (m/s)
  rough: number; // body shake
}

const PAVED: Surface = { name: 'paved', label: 'paved', grip: 1.0, roll: 0.012, top: 42, rough: 0.02 };
const GRAVEL: Surface = { name: 'gravel', label: 'gravel', grip: 0.75, roll: 0.03, top: 30, rough: 0.25 };
const FIELD: Surface = { name: 'grass', label: 'grass', grip: 0.68, roll: 0.06, top: 24, rough: 0.55 };
const ORCHARD: Surface = { name: 'orchard', label: 'orchard', grip: 0.62, roll: 0.08, top: 18, rough: 0.75 };
const MUD: Surface = { name: 'mud', label: 'mud', grip: 0.38, roll: 0.22, top: 9, rough: 0.4 };
const WATER: Surface = { name: 'water', label: 'water', grip: 0.3, roll: 0.7, top: 3, rough: 0.2 };

/**
 * Weather on a surface: rain makes pavement slick (aquaplaning on standing water
 * at speed) and turns fields to mud; snow cuts grip to packed-snow levels and
 * drags at the tyres off-road.
 */
function weathered(s: Surface, wet: number, snow: number, speed: number): Surface {
  if (wet < 0.02 && snow < 0.02) return s;
  let { grip, roll, top, rough, label } = s;
  const paved = s === PAVED;
  if (s === FIELD || s === ORCHARD) {
    grip *= 1 - 0.35 * wet;
    roll += 0.1 * wet;
    top *= 1 - 0.35 * wet;
    if (wet > 0.5) label = s === FIELD ? 'muddy grass' : 'muddy orchard';
  } else if (s === GRAVEL) {
    grip *= 1 - 0.12 * wet;
    roll += 0.02 * wet;
  } else if (paved) {
    grip *= 1 - 0.28 * wet;
    if (wet > 0.3) label = 'wet road';
    if (wet > 0.6) grip *= 1 - THREE.MathUtils.clamp((Math.abs(speed) - 24) / 18, 0, 0.55) * ((wet - 0.6) / 0.4);
  }
  if (snow > 0.05 && s !== WATER) {
    grip *= 1 - (paved ? 0.62 : 0.5) * snow;
    roll += (paved ? 0.02 : 0.09) * snow;
    top *= 1 - (paved ? 0.3 : 0.45) * snow;
    rough *= 1 - 0.5 * snow;
    if (snow > 0.3) label = paved ? 'snowy road' : s === MUD ? 'slush' : 'snow';
  }
  return { name: s.name, label, grip, roll, top, rough };
}

const G = 9.81;
const GEARS = [0, 8, 15, 23, 32, 60];

function approach(v: number, t: number, rate: number, dt: number) {
  const d = t - v;
  const s = rate * dt;
  return Math.abs(d) <= s ? t : v + Math.sign(d) * s;
}

/** Arcade pickup dynamics on the heightfield. */
export class CarPhysics {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  psi = 0;
  /** Signed forward speed (m/s). */
  speed = 0;
  steerAngle = 0;
  wheelSpin = 0;
  gear = 1;
  rpm = 0.2;
  /** Suspension: body pitch/roll (rad) and heave (m) on top of the terrain pose. */
  bodyPitch = 0;
  bodyRoll = 0;
  heave = 0;
  braking = 0;
  slip = 0;
  /** Ground type under the truck, and how it behaves in today's weather. */
  base: Surface = PAVED;
  surface: Surface = PAVED;
  /** Ground wetness and snow cover 0..1 (fed from the environment). */
  wet = 0;
  snow = 0;
  road: RoadHit | null = null;
  /** Speed of the latest collision (m/s), decaying; drives shake and sound. */
  impact = 0;
  /** Set for one frame when a new collision happens. */
  crashed = 0;
  obstacles?: ObstacleQuery;
  private pitchV = 0;
  private rollV = 0;
  private surfaceT = 0;
  private accel = 0;
  private latAccel = 0;
  private bumpPhase = 0;
  private roadLift = 0;
  private up = new THREE.Vector3(0, 1, 0);
  private limit: number;

  constructor(private hf: Heightfield, private roads: RoadIndex, worldSize: number) {
    this.limit = worldSize / 2 - 400;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.psi), 0, Math.cos(this.psi));
  }

  /** Places the car on the road nearest to (x, z), facing along it. */
  spawn(x: number, z: number, preferPsi?: number) {
    const hit = this.roads.find(x, z, 8000, (k) => k !== 'residential') ?? this.roads.find(x, z);
    let psi = preferPsi ?? 0;
    if (hit) {
      x = hit.x;
      z = hit.z;
      const a = Math.atan2(hit.dx, hit.dz);
      // Keep roughly the requested direction, and drive on the right.
      psi = preferPsi !== undefined && Math.cos(a - preferPsi) < 0 ? a + Math.PI : a;
      const rx = -Math.cos(psi), rz = Math.sin(psi);
      x += rx * Math.min(hit.halfWidth * 0.5, 2.2);
      z += rz * Math.min(hit.halfWidth * 0.5, 2.2);
    }
    this.pos.set(x, this.hf.height(x, z), z);
    this.psi = psi;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.steerAngle = 0;
    this.bodyPitch = this.bodyRoll = this.heave = 0;
    this.pitchV = this.rollV = 0;
    this.sampleSurface();
    this.roadLift = this.base === PAVED ? 0.15 : 0;
    this.updatePose(0);
  }

  private sampleSurface() {
    this.base = this.groundType();
    this.surface = weathered(this.base, this.wet, this.snow, this.speed);
  }

  private groundType(): Surface {
    const { x, z } = this.pos;
    this.road = this.roads.nearest(x, z, 25);
    if (this.road && this.road.dist < this.road.halfWidth + 0.6) return this.road.kind === 'track' ? GRAVEL : PAVED;
    const lc = this.hf.landcover(x, z);
    if (lc === LC.WATER) return WATER;
    if (lc === LC.RICE || lc === LC.WETLAND) return MUD;
    if (lc === LC.WALNUT || lc === LC.ALMOND || lc === LC.FRUIT) return ORCHARD;
    if (lc >= LC.URBAN_LOW && lc <= LC.URBAN_HIGH) return GRAVEL;
    return FIELD;
  }

  update(dt: number, inp: DriveInput) {
    this.impact = Math.max(0, this.impact - dt * 8);
    this.surfaceT -= dt;
    if (this.surfaceT <= 0) {
      this.sampleSurface();
      this.surfaceT = 0.1;
    }
    const s = this.surface;
    const f = this.forward;
    const r = new THREE.Vector3(-f.z, 0, f.x);
    let vf = this.vel.dot(f);
    let vr = this.vel.dot(r);

    // Steering: lock shrinks with speed so the car stays easy to place.
    const maxSteer = 0.6 / (1 + (vf * vf) / 160);
    const target = inp.steer * maxSteer;
    this.steerAngle = approach(this.steerAngle, target, (Math.abs(target) > Math.abs(this.steerAngle) ? 1.6 : 2.6) * maxSteer + 0.2, dt);

    // Longitudinal forces.
    const top = s.top * (1 + inp.boost * 0.3);
    let a = 0;
    if (inp.throttle > 0) {
      const thrust = (5.2 + inp.boost * 3.5) * Math.max(0, 1 - Math.max(vf, 0) / top);
      a += inp.throttle * thrust * Math.min(1, s.grip * 1.4);
    }
    this.braking = 0;
    if (inp.brake > 0) {
      if (vf > 0.6) {
        a -= inp.brake * 9.5 * s.grip;
        this.braking = inp.brake;
      } else {
        a -= inp.brake * 3.2 * Math.max(0, 1 + vf / 9);
      }
    }
    if (inp.throttle > 0 && vf < -0.6) {
      a += inp.throttle * 9 * s.grip;
      this.braking = inp.throttle;
    }
    if (inp.handbrake > 0) {
      a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 6 * s.grip * inp.handbrake);
      this.braking = Math.max(this.braking, inp.handbrake);
    }
    // Rolling resistance, drag, slope.
    // Automatic in park: hold on hills when stopped with no pedals pressed.
    const parked = inp.throttle < 0.02 && inp.brake < 0.02 && Math.abs(vf) < 1.0;
    const n = this.hf.normal(this.pos.x, this.pos.z, { x: 0, y: 1, z: 0 }, 3);
    if (!parked) a += G * (n.x * f.x + n.z * f.z);
    else a -= vf * 4;
    const resist = s.roll * G + 0.00042 * vf * vf;
    a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt + Math.abs(a), resist);
    vf += a * dt;
    if (parked && Math.abs(vf) < 0.15) vf = 0;
    this.accel = a;

    // Yaw from the bicycle model, capped by available grip (understeer).
    const handbrake = inp.handbrake > 0;
    const gripG = s.grip * G * (handbrake ? 1.25 : 1.0);
    let yawRate = (vf * Math.tan(this.steerAngle)) / WHEELBASE;
    const cap = gripG / Math.max(Math.abs(vf), 0.1);
    yawRate = THREE.MathUtils.clamp(yawRate, -cap, cap);
    this.psi += yawRate * dt;

    // Lateral grip pulls the velocity back in line with the new heading.
    const latGrip = gripG * (handbrake ? 0.25 : 1.0);
    const corr = Math.min(Math.abs(vr), latGrip * dt);
    vr -= Math.sign(vr) * corr;
    this.slip = Math.min(1, Math.abs(vr) / 4);
    this.latAccel = vf * yawRate;

    const nf = this.forward;
    const nr = new THREE.Vector3(-nf.z, 0, nf.x);
    this.vel.copy(nf).multiplyScalar(vf).addScaledVector(nr, vr);
    this.speed = vf;
    this.pos.addScaledVector(this.vel, dt);
    this.collide(nf);
    const L = this.limit;
    if (Math.abs(this.pos.x) > L || Math.abs(this.pos.z) > L) {
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -L, L);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -L, L);
      this.vel.multiplyScalar(0.2);
    }
    this.wheelSpin += (vf / WHEEL_R) * dt;

    // Automatic gearbox.
    const av = Math.abs(vf);
    while (this.gear < GEARS.length - 1 && av > GEARS[this.gear]) this.gear++;
    while (this.gear > 1 && av < GEARS[this.gear - 1] - 2) this.gear--;
    const lo = GEARS[this.gear - 1], hi = GEARS[this.gear];
    const rpmT = 0.2 + 0.7 * THREE.MathUtils.clamp((av - lo) / (hi - lo), 0, 1) * (0.6 + 0.4 * inp.throttle) + inp.throttle * 0.1;
    this.rpm += (rpmT - this.rpm) * (1 - Math.exp(-dt * 6));

    this.updatePose(dt);
  }

  private collide(f: THREE.Vector3) {
    if (!this.obstacles) return;
    for (const off of [1.45, -1.45]) {
      const hit = this.obstacles(this.pos.x + f.x * off, this.pos.z + f.z * off, 1.02);
      if (!hit) continue;
      this.pos.x += hit.nx * hit.depth;
      this.pos.z += hit.nz * hit.depth;
      const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
      if (vn < 0) {
        this.vel.x -= hit.nx * vn * 1.2;
        this.vel.z -= hit.nz * vn * 1.2;
        this.vel.multiplyScalar(0.85);
        if (-vn > 1.5 && -vn > this.impact * 0.5) this.crashed = -vn;
        this.impact = Math.max(this.impact, -vn);
      }
    }
  }

  private updatePose(dt: number) {
    const f = this.forward;
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const { x, z } = this.pos;
    const hw = WHEELBASE / 2, ht = TRACK / 2;
    const h = (sf: number, sr: number) => this.hf.height(x + f.x * sf + r.x * sr, z + f.z * sf + r.z * sr);
    const fl = h(hw, -ht), fr = h(hw, ht), rl = h(-hw, -ht), rr = h(-hw, ht);
    const ground = (fl + fr + rl + rr) / 4;
    const pitchSlope = (fl + fr - rl - rr) / 2 / WHEELBASE;
    const rollSlope = (fr + rr - fl - rl) / 2 / TRACK;

    if (dt > 0) {
      // Suspension: spring-damped body motion driven by accel, cornering and bumps.
      this.bumpPhase += Math.abs(this.speed) * dt;
      const rough = this.surface.rough * Math.min(1, Math.abs(this.speed) / 8);
      const bump = (Math.sin(this.bumpPhase * 1.7) * 0.6 + Math.sin(this.bumpPhase * 4.3 + 1) * 0.4) * rough;
      const pitchT = this.accel * 0.007 + bump * 0.012;
      const rollT = this.latAccel * 0.011 + bump * 0.008 * Math.sin(this.bumpPhase * 2.9);
      this.pitchV += ((pitchT - this.bodyPitch) * 90 - this.pitchV * 11) * dt;
      this.rollV += ((rollT - this.bodyRoll) * 70 - this.rollV * 9) * dt;
      this.bodyPitch += this.pitchV * dt;
      this.bodyRoll += this.rollV * dt;
      this.heave = bump * 0.02;
    }

    this.roadLift += ((this.base === PAVED ? 0.15 : 0) - this.roadLift) * Math.min(1, dt * 12);
    this.pos.y = ground + this.roadLift;
    const X = new THREE.Vector3(f.x, pitchSlope, f.z).normalize();
    const Z = new THREE.Vector3(r.x, rollSlope, r.z).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    Z.crossVectors(X, Y);
    this.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    this.up.copy(Y);
  }

  get groundUp() {
    return this.up;
  }

  /** Simulates with fixed sub-steps. */
  step(dt: number, inp: DriveInput) {
    const n = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < n; i++) this.update(dt / n, inp);
  }
}
