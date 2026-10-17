import * as THREE from 'three';
import type { Species } from './species';
import type { BirdPose } from './birdMesh';
import { defaultPose } from './birdMesh';
import type { AirField } from './air';
import type { Heightfield } from '../world/heightfield';

const g = 9.81;

export interface FlightInput {
  pitch: number; // -1 nose down .. +1 pull up
  roll: number; // -1 left .. +1 right
  yaw: number;
  flap: number; // 0..1
  tuck: number; // 0..1 dive
  brake: number; // 0..1 flare / airbrake
  takeoff: boolean;
}

export function emptyInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, brake: 0, takeoff: false };
}

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}
function approach(x: number, target: number, rate: number, dt: number) {
  return x + (target - x) * (1 - Math.exp(-rate * dt));
}

export type FlightState = 'flying' | 'perched';

/**
 * Point-mass flight dynamics with a species-specific drag polar:
 *   dV/dt = T - D - g sinγ,  dγ/dt = g/V (n cosφ - cosγ),  dψ/dt = -g n sinφ / (V cosγ)
 * Drag per unit mass D = a V² + b n² / V², minimal (= g/LD) at the best-glide speed.
 */
export class FlightModel {
  pos = new THREE.Vector3();
  speed = 12;
  gamma = 0; // flight path angle
  psi = 0; // heading (0 = +Z)
  phi = 0; // bank
  alpha = 0.05;
  load = 1;
  climbRate = 0;
  airLift = 0;
  state: FlightState = 'flying';
  flapPhase = 0;
  flapAmount = 0;
  pose: BirdPose = defaultPose();
  quaternion = new THREE.Quaternion();
  velocity = new THREE.Vector3();
  groundHeight = 0;
  agl = 100;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private walkSpeed = 0;
  private hopTimer = 0;
  private takeoffBoost = 0;
  private stallTimer = 0;
  private gammaRate = 0;

  constructor(public species: Species, private hf: Heightfield, private air: AirField) {}

  setSpecies(s: Species) {
    this.species = s;
  }

  get forward(): THREE.Vector3 {
    const cg = Math.cos(this.gamma);
    return new THREE.Vector3(Math.sin(this.psi) * cg, Math.sin(this.gamma), Math.cos(this.psi) * cg);
  }

  spawn(x: number, y: number, z: number, heading: number) {
    this.pos.set(x, y, z);
    this.psi = heading;
    this.gamma = 0;
    this.phi = 0;
    this.speed = this.species.flight.cruise;
    this.state = 'flying';
  }

  update(dt: number, inp: FlightInput) {
    this.groundHeight = this.hf.height(this.pos.x, this.pos.z);
    this.agl = this.pos.y - this.groundHeight;
    if (this.state === 'perched') this.updatePerched(dt, inp);
    else this.updateFlying(dt, inp);
    this.updatePose(dt, inp);
    const pitch = this.state === 'perched' ? -0.12 : this.gamma + this.alpha;
    this.euler.set(-pitch, this.psi, this.phi);
    this.quaternion.setFromEuler(this.euler);
  }

  /** Animates wings only (menu preview): gentle flapping bursts between glides. */
  animateOnly(dt: number, t: number) {
    this.speed = this.species.flight.cruise;
    this.state = 'flying';
    const burst = Math.sin(t * 0.7) > 0.35 ? 1 : 0;
    this.flapAmount = approach(this.flapAmount, burst, 4, dt);
    const inp = emptyInput();
    this.updatePose(dt, inp);
    this.euler.set(-0.04, this.psi, 0);
    this.quaternion.setFromEuler(this.euler);
  }

  private updateFlying(dt: number, inp: FlightInput) {
    const f = this.species.flight;
    const V = Math.max(this.speed, 0.5);
    const vs = f.stall;
    const LD = f.glideRatio;
    const vStar = f.cruise;
    // Drag polar coefficients; tucking trades induced for parasite drag (stoop).
    let a = g / (2 * LD * vStar * vStar);
    const aTuck = g / (f.maxDive * f.maxDive);
    a = a + (aTuck - a) * inp.tuck;
    a *= 1 + 3.5 * inp.brake;
    const b = (g * vStar * vStar) / (2 * LD) * (1 + inp.tuck * 2);

    // Bank: roll input drives roll rate; release levels the wings gently.
    const agility = f.climb * (1 + 0.6 * inp.tuck);
    const maxBank = f.soarer ? 1.15 : 1.25;
    const rollRate = 2.2 * agility;
    if (Math.abs(inp.roll) > 0.02) this.phi += inp.roll * rollRate * dt;
    else this.phi = approach(this.phi, 0, 1.1, dt);
    this.phi = clamp(this.phi, -maxBank, maxBank);

    // Load factor: neutral holds the path (coordinated turn), pitch input pulls.
    const nMax = Math.min(4.5, (V / vs) ** 2);
    const neutral = Math.cos(this.gamma) / Math.max(Math.cos(this.phi), 0.25);
    let n = neutral + inp.pitch * (inp.pitch > 0 ? 2.4 : 1.4) * agility;
    // Hands-off trim: settle toward best-glide speed on a shallow path, like a
    // trimmed glider (too slow → nose drops, too fast → zoom up).
    if (Math.abs(inp.pitch) < 0.02 && inp.tuck < 0.1) {
      const trim = clamp((0.9 * (V - vStar)) / vStar, -0.45, 0.45) - 0.5 * this.gamma - 0.6 * this.gammaRate;
      n += clamp(trim, -0.6, 0.6);
    }
    n += inp.brake * 0.6;
    const stalled = n > nMax;
    n = clamp(n, -1, nMax);
    this.load = n;
    this.stallTimer = stalled ? this.stallTimer + dt : 0;

    // Thrust from flapping; strongest at low speed, fading past cruise.
    const flapWanted = inp.flap > 0 || this.takeoffBoost > 0 ? Math.max(inp.flap, this.takeoffBoost > 0 ? 1 : 0) : 0;
    this.flapAmount = approach(this.flapAmount, flapWanted, 6, dt);
    let T = this.flapAmount * f.flapPower * clamp(1.6 - V / (vStar * 1.6), 0, 1.4);
    if (f.hover && inp.brake > 0.3 && inp.flap > 0) T += g * 0.4;
    this.takeoffBoost = Math.max(0, this.takeoffBoost - dt);

    const D = a * V * V + (b * n * n) / (V * V);
    const dV = T - D - g * Math.sin(this.gamma);
    this.speed = clamp(V + dV * dt, 0.5, f.maxDive * 1.15);

    let dGamma = (g / V) * (n * Math.cos(this.phi) - Math.cos(this.gamma));
    // Hovering kites/owls: flapping holds altitude at near-zero airspeed.
    if (f.hover && inp.flap > 0 && V < vs * 1.2) dGamma += (g / V) * this.flapAmount * 0.9;
    this.gamma = clamp(this.gamma + dGamma * dt, -1.45, 1.35);
    this.gammaRate = dGamma;
    const dPsi = (-g * n * Math.sin(this.phi)) / (V * Math.max(Math.cos(this.gamma), 0.2));
    this.psi += (dPsi + inp.yaw * 0.35) * dt;
    this.alpha = approach(this.alpha, clamp(0.04 + 0.12 * (n / Math.max(nMax, 0.3)), -0.1, 0.35), 5, dt);

    // Air mass motion: wind drift plus thermal / ridge lift.
    this.airLift = this.air.lift(this.pos.x, this.pos.y, this.pos.z);
    const fw = this.forward;
    this.velocity.copy(fw).multiplyScalar(this.speed);
    this.velocity.x += this.air.windX * 0.5;
    this.velocity.z += this.air.windZ * 0.5;
    this.velocity.y += this.airLift;
    this.pos.addScaledVector(this.velocity, dt);
    this.climbRate = approach(this.climbRate, this.velocity.y, 3, dt);

    // Ground contact.
    const ground = this.hf.height(this.pos.x, this.pos.z);
    const clearance = 0.12 + this.species.shape.legLen * 0.6;
    if (this.pos.y < ground + clearance) {
      const gentle = this.speed < f.stall * 1.9 && this.gamma > -0.5;
      this.pos.y = ground + clearance;
      if (gentle) {
        this.state = 'perched';
        this.speed = 0;
        this.gamma = 0;
        this.phi = 0;
        this.walkSpeed = 0;
      } else {
        // Glancing impact: bounce off and lose energy.
        this.gamma = 0.35;
        this.speed *= 0.55;
        this.phi *= 0.3;
      }
    }
    if (this.pos.y > 5200) {
      this.gamma = Math.min(this.gamma, -0.05);
    }
  }

  private updatePerched(dt: number, inp: FlightInput) {
    const f = this.species.flight;
    // Walk / turn on the ground.
    this.psi -= inp.roll * 1.8 * dt;
    const want = inp.pitch < -0.1 ? 0.9 : inp.pitch > 0.1 ? -0.35 : 0;
    this.walkSpeed = approach(this.walkSpeed, want * Math.sqrt(this.species.shape.length * 2), 6, dt);
    this.pos.x += Math.sin(this.psi) * this.walkSpeed * dt;
    this.pos.z += Math.cos(this.psi) * this.walkSpeed * dt;
    const ground = this.hf.height(this.pos.x, this.pos.z);
    this.pos.y = ground + 0.02 + this.species.shape.legLen * 0.9;
    this.hopTimer += dt * Math.abs(this.walkSpeed) * 6;
    this.velocity.set(0, 0, 0);
    this.climbRate = 0;
    if (inp.takeoff || inp.flap > 0.5) {
      this.state = 'flying';
      this.speed = f.stall * 1.05;
      this.gamma = 0.55;
      this.takeoffBoost = 1.6;
      this.pos.y += 0.3;
    }
  }

  private updatePose(dt: number, inp: FlightInput) {
    const f = this.species.flight;
    const p = this.pose;
    const sh = this.species.shape;
    if (this.state === 'perched') {
      p.flap = approach(p.flap, 0.15, 6, dt);
      p.wrist = approach(p.wrist, -0.1, 6, dt);
      p.fold = approach(p.fold, 1, 5, dt);
      p.sweep = approach(p.sweep, 0.1, 5, dt);
      p.twist = 0;
      p.tailSpread = approach(p.tailSpread, 0, 4, dt);
      p.tailPitch = approach(p.tailPitch, -0.55, 4, dt);
      p.tailTwist = 0;
      p.legsDown = approach(p.legsDown, 1, 6, dt);
      p.headYaw = Math.sin(this.hopTimer * 0.3 + performance.now() * 0.0007) * 0.5;
      p.bank = 0;
      return;
    }
    const speedFold = clamp((this.speed - f.cruise * 1.35) / (f.maxDive * 0.7 - f.cruise * 1.35), 0, 1);
    const fold = clamp(Math.max(speedFold * 0.55, inp.tuck * 0.92), 0, 0.95);
    const hz = f.flapHz * (1 + 0.35 * this.flapAmount * (this.speed < f.stall * 1.3 ? 1 : 0));
    if (this.flapAmount > 0.02) this.flapPhase += dt * hz * Math.PI * 2;
    else this.flapPhase = approach(this.flapPhase, Math.ceil(this.flapPhase / (Math.PI * 2)) * Math.PI * 2, 4, dt);
    const amp = (0.55 + 0.35 * clamp(sh.wingspan / 2, 0, 1)) * this.flapAmount;
    const ph = this.flapPhase;
    // Downstroke is faster than upstroke; hand lags the arm and partially folds up.
    const stroke = Math.sin(ph + 0.3 * Math.sin(ph));
    p.flap = amp * stroke * (1 - fold * 0.8) + 0.05 * this.flapAmount;
    p.wrist = -amp * 0.55 * Math.sin(ph - 0.9);
    const upFold = Math.max(0, Math.cos(ph)) * 0.35 * this.flapAmount * (f.soarer ? 0.6 : 1);
    p.fold = approach(p.fold, fold + upFold * (1 - fold), 10, dt);
    p.sweep = approach(p.sweep, -0.25 * inp.brake + 0.12 * speedFold, 6, dt);
    p.twist = approach(p.twist, 0.25 * inp.brake - 0.05 * this.flapAmount * Math.cos(ph), 6, dt);
    const slow = clamp(1 - (this.speed - f.stall) / (f.cruise - f.stall), 0, 1);
    p.tailSpread = approach(p.tailSpread, clamp(0.2 + slow * 0.7 + inp.brake * 0.6 - inp.tuck * 0.5, 0, 1), 5, dt);
    p.tailPitch = approach(p.tailPitch, -0.25 * inp.brake + 0.12 * inp.pitch, 6, dt);
    p.tailTwist = approach(p.tailTwist, -inp.roll * 0.35 - inp.yaw * 0.3, 6, dt);
    const nearGround = this.agl < 6 && this.speed < f.stall * 2;
    p.legsDown = approach(p.legsDown, nearGround || inp.brake > 0.5 ? 1 : 0, 4, dt);
    p.headYaw = approach(p.headYaw, inp.roll * 0.35 + inp.yaw * 0.3, 4, dt);
    p.bank = this.phi;
  }
}
