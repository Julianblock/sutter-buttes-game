import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../render/globals';
import { merge, StrutBuilder, withPart } from '../world/geom';
import { CAR_PART as P, carFragment, carVertex, glassFragment } from './carShader';

/**
 * Local frame: +x forward, +y up, +z to the right of the driver, origin on the
 * ground midway between the axles.
 */
export const WHEELBASE = 3.5;
export const TRACK = 1.72;
export const WHEEL_R = 0.4;
/** Driver's eye in the local frame (left-hand drive). */
export const EYE = new THREE.Vector3(-0.28, 1.5, -0.42);

export const PAINTS: { id: string; name: string; hex: number }[] = [
  { id: 'cherry', name: 'Cherry red', hex: 0xb01c1a },
  { id: 'ranch', name: 'Ranch blue', hex: 0x2a5482 },
  { id: 'white', name: 'Oxford white', hex: 0xd8d8d2 },
  { id: 'forest', name: 'Forest green', hex: 0x2c5236 },
  { id: 'tan', name: 'Desert tan', hex: 0xa08860 },
  { id: 'black', name: 'Black', hex: 0x121214 },
  { id: 'silver', name: 'Silver', hex: 0x8e9196 },
];

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, part: number) {
  return withPart(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), part);
}

/** Box from min/max corners. */
function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, part: number) {
  return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, part);
}

function arch(pts: THREE.Vector2[], cx: number) {
  const cy = WHEEL_R, r = 0.5, bottom = 0.45;
  const a0 = Math.asin((bottom - cy) / r);
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI - a0 - ((Math.PI - 2 * a0) * i) / 14;
    pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
}

/** Extrudes a side profile across the body; caps stay flat, sides are smoothed. */
function extrudeProfile(pts: THREE.Vector2[], width: number, part: number) {
  const b = 0.05;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: width - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b * 0.6,
    bevelSegments: 3,
    curveSegments: 8,
  }).translate(0, 0, -(width - 2 * b) / 2);
  const pos = g.attributes.position.array as Float32Array;
  const nrm = g.attributes.normal.array as Float32Array;
  const out: THREE.BufferGeometry[] = [];
  for (const grp of g.groups) {
    const sub = new THREE.BufferGeometry();
    sub.setAttribute('position', new THREE.BufferAttribute(pos.slice(grp.start * 3, (grp.start + grp.count) * 3), 3));
    if (grp.materialIndex === 0) {
      sub.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(grp.start * 3, (grp.start + grp.count) * 3), 3));
      out.push(withPart(sub, part));
    } else {
      const m = mergeVertices(sub, 1e-4);
      m.computeVertexNormals();
      out.push(withPart(m, part));
    }
  }
  return merge(out);
}

/** Outward-facing quad (two triangles) relative to `center`. */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, center: THREE.Vector3, part: number) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
  const flip = n.dot(new THREE.Vector3().subVectors(a, center)) < 0;
  const v = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
  const g = new THREE.BufferGeometry().setFromPoints(v);
  g.computeVertexNormals();
  return withPart(g, part);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Cab greenhouse corners (belt line and roof), +z side; mirrored for -z.
const BF = V(1.0, 1.26, 0.97), BR = V(-0.75, 1.26, 0.97);
const TF = V(0.12, 1.88, 0.84), TR = V(-0.66, 1.88, 0.84);
const mz = (v: THREE.Vector3) => V(v.x, v.y, -v.z);

function bodyGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // Front clip: fenders and hood.
  const front: THREE.Vector2[] = [new THREE.Vector2(1.0, 0.45)];
  arch(front, WHEELBASE / 2);
  front.push(
    new THREE.Vector2(2.72, 0.45), new THREE.Vector2(2.82, 0.55), new THREE.Vector2(2.85, 0.8),
    new THREE.Vector2(2.83, 1.05), new THREE.Vector2(2.72, 1.16), new THREE.Vector2(2.2, 1.21),
    new THREE.Vector2(1.0, 1.26),
  );
  parts.push(extrudeProfile(front, 2.0, P.PAINT));
  // Bed sides and floor.
  const rear: THREE.Vector2[] = [new THREE.Vector2(-2.8, 0.55), new THREE.Vector2(-2.74, 0.45)];
  arch(rear, -WHEELBASE / 2);
  rear.push(new THREE.Vector2(-0.76, 0.45), new THREE.Vector2(-0.76, 0.86), new THREE.Vector2(-2.8, 0.86));
  parts.push(extrudeProfile(rear, 2.0, P.PAINT));
  for (const s of [-1, 1]) {
    parts.push(span(-2.8, -0.8, 0.84, 1.25, s * 0.94, s * 1.0, P.PAINT)); // bed wall
    parts.push(span(-2.8, -0.8, 1.23, 1.27, s * 0.92, s * 1.01, P.TRIM)); // bed rail cap
    parts.push(span(-0.74, 1.0, 0.47, 1.25, s * 0.965, s * 1.0, P.PAINT)); // door skin
    parts.push(span(-0.72, 0.98, 0.6, 1.22, s * 0.9, s * 0.965, P.INTERIOR)); // door card
    parts.push(span(0.25, 0.4, 1.06, 1.1, s * 1.0, s * 1.02, P.CHROME)); // handle
    parts.push(span(-2.88, -2.82, 0.9, 1.2, s * 0.84, s * 0.98, P.TAILLIGHT));
    parts.push(span(2.83, 2.9, 0.86, 1.02, s * 0.6, s * 0.92, P.HEADLIGHT));
    parts.push(span(2.8, 2.86, 0.62, 0.7, s * 0.7, s * 0.9, P.TRIM)); // fog lamp bezel
    // Mirrors.
    parts.push(box(0.1, 0.2, 0.24, 0.84, 1.42, s * 1.15, P.TRIM));
    parts.push(span(0.785, 0.79, 1.34, 1.5, s * 1.05, s * 1.25, P.MIRROR));
    parts.push(box(0.08, 0.05, 0.12, 0.9, 1.33, s * 1.03, P.TRIM));
    // Running boards.
    parts.push(span(-0.7, 0.95, 0.36, 0.42, s * 0.98, s * 1.12, P.TRIM));
  }
  parts.push(span(-2.82, -2.74, 0.6, 1.25, -1.0, 1.0, P.PAINT)); // tailgate
  parts.push(span(-2.86, -2.82, 1.02, 1.08, -0.15, 0.15, P.CHROME));
  parts.push(span(-0.82, -0.72, 0.45, 1.27, -0.97, 0.97, P.PAINT)); // cab back
  parts.push(span(-2.75, -0.82, 0.86, 0.88, -0.94, 0.94, P.TRIM)); // bed liner
  parts.push(span(2.84, 2.9, 0.78, 1.04, -0.58, 0.58, P.TRIM)); // grille
  for (let i = 0; i < 4; i++) parts.push(span(2.9, 2.92, 0.81 + i * 0.065, 0.83 + i * 0.065, -0.56, 0.56, P.CHROME));
  parts.push(span(2.84, 3.0, 0.48, 0.74, -1.0, 1.0, P.CHROME)); // front bumper
  parts.push(span(-3.0, -2.84, 0.5, 0.72, -1.0, 1.0, P.CHROME)); // rear bumper
  parts.push(span(-2.6, 2.6, 0.32, 0.46, -0.72, 0.72, P.TRIM)); // frame rails
  parts.push(span(1.05, 2.6, 1.255, 1.27, -0.04, 0.04, P.TRIM)); // hood crease

  // Greenhouse: pillars, roof, window surrounds.
  const st = new StrutBuilder();
  for (const s of [1, -1]) {
    const f = s > 0 ? (v: THREE.Vector3) => v : mz;
    st.strut(f(BF), f(TF), 0.045, P.PAINT, 6); // A pillar
    st.strut(f(BR), f(TR), 0.06, P.PAINT, 6); // C pillar
    st.strut(f(V(-0.1, 1.26, 0.97)), f(V(-0.27, 1.88, 0.84)), 0.04, P.TRIM, 6); // B pillar
    st.strut(f(TF), f(TR), 0.03, P.TRIM, 6);
    st.strut(f(BF), f(BR), 0.02, P.TRIM, 6);
  }
  st.strut(BF, mz(BF), 0.03, P.TRIM, 6);
  st.strut(TF, mz(TF), 0.03, P.TRIM, 6);
  st.strut(BR, mz(BR), 0.025, P.TRIM, 6);
  st.strut(TR, mz(TR), 0.025, P.TRIM, 6);
  parts.push(st.build());
  parts.push(span(-0.7, 0.16, 1.875, 1.93, -0.87, 0.87, P.PAINT)); // roof
  parts.push(span(-0.66, 0.1, 1.855, 1.876, -0.83, 0.83, P.HEADLINER));

  // Cabin.
  parts.push(span(-0.72, 1.0, 0.5, 0.62, -0.9, 0.9, P.DASH)); // floor
  const dash = [[1.0, 0.85], [1.0, 1.22], [0.86, 1.235], [0.72, 1.2], [0.63, 1.11], [0.62, 0.85]].map(([x, y]) => new THREE.Vector2(x, y));
  parts.push(extrudeProfile(dash, 1.84, P.DASH));
  parts.push(span(0.57, 0.68, 1.15, 1.25, -0.64, -0.2, P.DASH)); // binnacle hood
  parts.push(span(0.615, 0.62, 1.03, 1.15, -0.6, -0.24, P.GAUGES)); // instruments
  parts.push(span(0.58, 0.66, 0.62, 1.0, -0.13, 0.13, P.DASH)); // console
  parts.push(span(0.575, 0.58, 0.88, 0.94, -0.1, 0.1, P.GAUGES)); // radio
  parts.push(span(-0.62, -0.08, 0.62, 0.86, -0.86, 0.86, P.INTERIOR)); // seat cushion
  const back = new THREE.BoxGeometry(0.14, 0.68, 1.72).rotateZ(-0.2).translate(-0.62, 1.18, 0);
  parts.push(withPart(back, P.INTERIOR));
  for (const s of [-1, 1]) parts.push(span(-0.76, -0.64, 1.5, 1.7, s * 0.3, s * 0.58, P.INTERIOR));
  parts.push(span(0.27, 0.29, 1.69, 1.76, -0.13, 0.13, P.TRIM)); // rear-view mirror
  parts.push(span(0.265, 0.27, 1.7, 1.75, -0.12, 0.12, P.MIRROR));
  parts.push(span(0.29, 0.31, 1.75, 1.84, -0.015, 0.015, P.TRIM));
  return merge(parts);
}

function glassGeometry() {
  const c = V(0.1, 1.55, 0);
  const inset = (v: THREE.Vector3) => v.clone().lerp(c, 0.01);
  const bf = inset(BF), br = inset(BR), tf = inset(TF), tr = inset(TR);
  return merge([
    quad(bf, mz(bf), mz(tf), tf, c, 0),
    quad(bf, tf, tr, br, c, 0),
    quad(mz(bf), mz(br), mz(tr), mz(tf), c, 0),
    quad(br, tr, mz(tr), mz(br), c, 0),
  ]);
}

function wheelGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(withPart(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 28, 1).rotateX(Math.PI / 2), P.TIRE));
  parts.push(withPart(new THREE.CylinderGeometry(0.27, 0.27, 0.285, 24, 1).rotateX(Math.PI / 2), P.CHROME));
  parts.push(withPart(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12, 1).rotateX(Math.PI / 2), P.TRIM));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.16, 0.035, 0.29).translate(0.15, 0, 0).rotateZ(a);
    parts.push(withPart(g, P.TRIM));
  }
  return merge(parts);
}

function steeringGeometry() {
  // Rim around the local x axis (the column), facing the driver at -x.
  const parts: THREE.BufferGeometry[] = [];
  parts.push(withPart(new THREE.TorusGeometry(0.19, 0.022, 10, 40).rotateY(Math.PI / 2), P.DASH));
  parts.push(withPart(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 16).rotateZ(Math.PI / 2), P.DASH));
  const st = new StrutBuilder();
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const d = V(0, -Math.cos(a), Math.sin(a));
    st.strut(d.clone().multiplyScalar(0.05), d.clone().multiplyScalar(0.18), 0.014, P.DASH, 5);
  }
  parts.push(st.build());
  return merge(parts);
}

export interface Wheel {
  steer: THREE.Group;
  spin: THREE.Mesh;
  front: boolean;
  side: number;
}

/** The player's pickup: body, cabin, glass, steerable spinning wheels. */
export class CarModel {
  readonly object = new THREE.Group();
  /** Pitch/roll body group (suspension); the root carries position and yaw. */
  readonly body = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly shadowMaterial: THREE.ShaderMaterial;
  readonly glassMaterial: THREE.ShaderMaterial;
  readonly bodyGeo = bodyGeometry();
  readonly wheelGeo = wheelGeometry();
  readonly wheels: Wheel[] = [];
  readonly steering = new THREE.Group();
  private bodyMesh: THREE.Mesh;

  constructor() {
    const uniforms = {
      ...G,
      uPaint: { value: new THREE.Color(PAINTS[0].hex) },
      uLampOn: { value: 0 },
      uBrake: { value: 0 },
      uSpeedFrac: { value: 0 },
      uRpmFrac: { value: 0 },
      uCarSnow: { value: 0 },
      uWiperPhase: { value: 0 },
      uWiperT: { value: 1.4 },
      uWiperOn: { value: 0 },
      uWiperAngle: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: carVertex,
      fragmentShader: carFragment,
      uniforms,
      side: THREE.DoubleSide,
    });
    this.shadowMaterial = this.material.clone();
    this.shadowMaterial.uniforms = uniforms;
    this.shadowMaterial.defines = { SHADOW_PASS: '' };
    this.glassMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: carVertex,
      fragmentShader: glassFragment,
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    this.object.add(this.body);
    this.bodyMesh = new THREE.Mesh(this.bodyGeo, this.material);
    this.bodyMesh.frustumCulled = false;
    this.body.add(this.bodyMesh);
    const glass = new THREE.Mesh(glassGeometry(), this.glassMaterial);
    glass.renderOrder = 10;
    glass.frustumCulled = false;
    this.body.add(glass);

    for (const front of [true, false])
      for (const side of [-1, 1]) {
        const steer = new THREE.Group();
        steer.position.set(((front ? 1 : -1) * WHEELBASE) / 2, WHEEL_R, (side * TRACK) / 2);
        const spin = new THREE.Mesh(this.wheelGeo, this.material);
        spin.frustumCulled = false;
        steer.add(spin);
        this.object.add(steer);
        this.wheels.push({ steer, spin, front, side });
      }

    const mount = new THREE.Group();
    mount.position.set(0.4, 1.1, EYE.z);
    mount.rotation.z = -0.45;
    const column = withPart(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10).rotateZ(Math.PI / 2).translate(0.17, 0, 0), P.DASH);
    const colMesh = new THREE.Mesh(merge([column]), this.material);
    colMesh.frustumCulled = false;
    mount.add(colMesh);
    const wheel = new THREE.Mesh(steeringGeometry(), this.material);
    wheel.frustumCulled = false;
    this.steering.add(wheel);
    mount.add(this.steering);
    this.body.add(mount);
  }

  /** Snow lying on the truck, 0..1; negative until first settled. */
  private snow = -1;

  /**
   * Weather on the truck: wipers run whenever it's raining or snowing, and snow
   * piles up when parked, blows off at speed, and melts in rain or sun.
   */
  weather(dt: number, speed: number) {
    const u = this.material.uniforms;
    const rain = G.uRain.value;
    const fall = G.uSnowFall.value;
    if (this.snow < 0) this.snow = G.uSnowCover.value * 0.8;
    const blow = Math.max(0, Math.abs(speed) - 8) * 0.02;
    const melt = rain * 0.05 + (fall > 0.02 ? 0 : 0.004);
    this.snow = THREE.MathUtils.clamp(this.snow + (fall / 50 - blow - melt) * dt, 0, 1);
    u.uCarSnow.value = this.snow;

    const precip = rain + fall * 0.6;
    const on = precip > 0.04;
    const parked = u.uWiperAngle.value < 0.02;
    if (on || !parked) {
      // Faster sweeps in heavier rain; finish the stroke before parking.
      u.uWiperT.value = THREE.MathUtils.lerp(2.4, 1.05, Math.min(1, precip));
      const before = u.uWiperPhase.value;
      let ph = before + dt / u.uWiperT.value;
      if (!on && Math.floor(ph) > Math.floor(before)) ph = Math.floor(ph);
      u.uWiperPhase.value = ph;
    }
    u.uWiperOn.value = on ? 1 : 0;
    u.uWiperAngle.value = 1.75 * (0.5 - 0.5 * Math.cos(u.uWiperPhase.value * Math.PI * 2));
  }

  setPaint(hex: number) {
    (this.material.uniforms.uPaint.value as THREE.Color).setHex(hex).convertSRGBToLinear();
  }

  /** Registers the body and wheels as shadow casters. */
  addShadows(addCaster: (g: THREE.BufferGeometry, m: THREE.Material, follow?: THREE.Object3D) => THREE.Mesh) {
    const casters = [addCaster(this.bodyGeo, this.shadowMaterial, this.bodyMesh)];
    for (const w of this.wheels) casters.push(addCaster(this.wheelGeo, this.shadowMaterial, w.spin));
    return casters;
  }

  /**
   * @param steer road-wheel angle (rad, + = left)
   * @param spin  accumulated wheel rotation (rad)
   */
  update(steer: number, spin: number, brake: number, headOn: number, speedFrac: number, rpmFrac: number) {
    for (const w of this.wheels) {
      w.steer.rotation.y = w.front ? steer : 0;
      w.spin.rotation.z = -spin;
    }
    this.steering.rotation.x = -steer * 8;
    const u = this.material.uniforms;
    u.uBrake.value = brake;
    u.uLampOn.value = headOn;
    u.uSpeedFrac.value = speedFrac;
    u.uRpmFrac.value = rpmFrac;
  }
}
