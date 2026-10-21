import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { Heightfield } from '../world/heightfield';
import type { RoadIndex } from '../world/roadIndex';
import { insidePoly, type Town } from '../world/town';
import { FICTION_NOTICE, HAUNTS_PER_TOWN, HAUNT_NAMES, HAUNT_SEED, HOLLOW_HOUSE, SIGNS } from './fiction';
import { mulberry } from './smilers';

/** Texture atlas: 4 x 4 cells of 256 x 128 px. Signs, a face, drawings. */
const CELL = { face: 6, draw0: 7, draw1: 8, draw2: 9, paper: 10 };

function atlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const cell = (i: number) => [(i % 4) * 256, Math.floor(i / 4) * 128] as const;
  SIGNS.forEach((text, i) => {
    const [x, y] = cell(i);
    g.fillStyle = i % 2 ? '#d8cfb8' : '#c9b48a';
    g.fillRect(x, y, 256, 128);
    // Rust and rot.
    for (let k = 0; k < 160; k++) {
      g.fillStyle = `rgba(${90 + Math.random() * 60},${50 + Math.random() * 30},20,${Math.random() * 0.25})`;
      g.beginPath();
      g.arc(x + Math.random() * 256, y + Math.random() * 128, Math.random() * 9, 0, 7);
      g.fill();
    }
    g.strokeStyle = '#3a1e14';
    g.lineWidth = 6;
    g.strokeRect(x + 6, y + 6, 244, 116);
    g.fillStyle = i < 3 ? '#8a1408' : '#1a1410';
    const words = text.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [text];
    const size = lines.length > 1 ? 34 : text.length > 9 ? 36 : 46;
    g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, j) => g.fillText(l, x + 128, y + 64 + (j - (lines.length - 1) / 2) * (size + 4)));
  });
  // A pale smiling face pressed to the glass.
  {
    const [x, y] = cell(CELL.face);
    g.fillStyle = '#000';
    g.fillRect(x, y, 256, 128);
    const grd = g.createRadialGradient(x + 128, y + 64, 6, x + 128, y + 64, 56);
    grd.addColorStop(0, '#d8d4cb');
    grd.addColorStop(0.75, '#a9a59c');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x + 128, y + 64, 46, 56, 0, 0, 7);
    g.fill();
    g.fillStyle = '#050303';
    g.beginPath();
    g.moveTo(x + 86, y + 70);
    g.quadraticCurveTo(x + 128, y + 128, x + 170, y + 70);
    g.quadraticCurveTo(x + 128, y + 96, x + 86, y + 70);
    g.fill();
    g.fillStyle = '#e9e4cf';
    for (let k = 0; k < 12; k++) g.fillRect(x + 96 + k * 6, y + 78 + Math.abs(k - 5.5) * -1.6, 3, 7);
    g.fillStyle = '#000';
    g.fillRect(x + 110, y + 44, 7, 6);
    g.fillRect(x + 139, y + 44, 7, 6);
  }
  // Crayon drawings of small figures with big smiles, on scraps of paper.
  for (const [n, i] of [[1, CELL.draw0], [3, CELL.draw1], [7, CELL.draw2]] as const) {
    const [x, y] = cell(i);
    g.fillStyle = '#e8e0cc';
    g.fillRect(x, y, 256, 128);
    for (let k = 0; k < n; k++) {
      const cx = x + 30 + ((k + 0.5) / n) * 196, cy = y + 74;
      g.strokeStyle = '#111';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - 16, cy + 40);
      g.lineTo(cx, cy - 16);
      g.lineTo(cx + 16, cy + 40);
      g.closePath();
      g.stroke();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(cx, cy - 26, 13, 0, 7);
      g.fill();
      g.strokeStyle = '#b01010';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy - 28, 9, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    g.fillStyle = '#b01010';
    g.font = '700 16px "Comic Sans MS", cursive';
    g.fillText(n === 7 ? 'all of us' : n === 3 ? 'we see you' : 'me', x + 18, y + 22);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uNightmare;
in vec3 color;
in vec4 aMat;   // texture 0/1, emission, flicker seed, face (shown only now and then)
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
flat out vec4 vMat;
void main() {
  vec3 world = position;
  // Everything here belongs to the nightmare; it sinks out of existence when it ends.
  world.y -= (1.0 - smoothstep(0.3, 0.9, uNightmare)) * 400.0;
  vWorld = world;
  vNormal = normal;
  vColor = color;
  vUv = uv;
  vMat = aMat;
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform sampler2D uAtlas;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
flat in vec4 vMat;
out vec4 outColor;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = vColor;
  if (vMat.x > 0.5) albedo *= texture(uAtlas, vUv).rgb;
  albedo *= 0.55 * (0.85 + 0.3 * vnoise(vWorld.xz * 3.0 + vWorld.y * 5.0));
  if (vMat.w > 0.5) {
    // The face in the window: there for a few seconds, then gone.
    float on = smoothstep(0.82, 0.9, sin(uTime * 0.21 + vMat.z * 13.0) * sin(uTime * 0.077 + vMat.z * 3.0) + 0.5);
    if (on < 0.02) discard;
    albedo *= on;
  }
  vec3 col = shadeSurface(albedo, n, vWorld, 1.0, 0.85, 1.0) / uInvExposure;
  // Interiors put the torch a metre from a wall; roll the highlight off instead of clipping it.
  col = col / (1.0 + col * 0.9) * uInvExposure;
  if (vMat.y > 0.0) {
    float f = 0.75 + 0.25 * sin(uTime * 11.0 + vMat.z * 7.0) * sin(uTime * 4.3 + vMat.z);
    col += vColor * vMat.y * f * uInvExposure * 0.4;
  }
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  mat: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, mat: number[], uv: [number, number, number, number] = [0, 0, 0, 0]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const [u0, v0, u1, v1] = uv;
    const corners: [THREE.Vector3, number, number][] = [[a, u0, v1], [b, u1, v1], [c, u1, v0], [d, u0, v0]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [p, u, v] = corners[i];
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(u, v);
      this.mat.push(...mat);
    }
  }
  /** Box centred at (x, y0..y0+h, z), turned `ang` about y. */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, ang: number, color: THREE.Color, mat = [0, 0, 0, 0]) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (u: number, v: number, y: number) => new THREE.Vector3(x + u * c - v * s, y, z + u * s + v * c);
    const hw = w / 2, hd = d / 2, y1 = y0 + h;
    const q = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, dd: THREE.Vector3) => this.quad(a, b, cc, dd, color, mat);
    q(P(-hw, hd, y0), P(hw, hd, y0), P(hw, hd, y1), P(-hw, hd, y1));
    q(P(hw, -hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y1), P(hw, -hd, y1));
    q(P(hw, hd, y0), P(hw, -hd, y0), P(hw, -hd, y1), P(hw, hd, y1));
    q(P(-hw, -hd, y0), P(-hw, hd, y0), P(-hw, hd, y1), P(-hw, -hd, y1));
    q(P(-hw, hd, y1), P(hw, hd, y1), P(hw, -hd, y1), P(-hw, -hd, y1));
  }
  /** Board between two points (a plank or beam). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, nOut: THREE.Vector3, color: THREE.Color) {
    const along = new THREE.Vector3().subVectors(b, a);
    const side = new THREE.Vector3().crossVectors(along, nOut).normalize().multiplyScalar(w / 2);
    const off = nOut.clone().multiplyScalar(t);
    this.quad(a.clone().sub(side).add(off), b.clone().sub(side).add(off), b.clone().add(side).add(off), a.clone().add(side).add(off), color, [0, 0, 0, 0]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.computeBoundingSphere();
    return g;
  }
}

const cellUV = (i: number): [number, number, number, number] => {
  const x = (i % 4) / 4, y = Math.floor(i / 4) / 4;
  return [x, y, x + 0.25, y + 0.25];
};

export interface Haunt {
  name: string;
  town: string;
  x: number;
  z: number;
  /** The invented walk-in building. */
  interior?: boolean;
  fiction: true;
}

/** Wall segments that only stand while the nightmare does. */
class Walls {
  segs: number[] = [];
  on = false;
  add(ax: number, az: number, bx: number, bz: number) {
    this.segs.push(ax, az, bx, bz);
  }
  push(p: { x: number; z: number }, r: number) {
    if (!this.on) return;
    const l = this.segs;
    for (let i = 0; i < l.length; i += 4) {
      const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / (ex * ex + ez * ez || 1)));
      const dx = p.x - (ax + ex * t), dz = p.z - (az + ez * t);
      const d = Math.hypot(dx, dz);
      if (d >= r || d < 1e-6) continue;
      p.x += (dx / d) * (r - d);
      p.z += (dz / d) * (r - d);
    }
  }
  near(x: number, z: number, r: number) {
    if (!this.on) return false;
    const l = this.segs;
    for (let i = 0; i < l.length; i += 4) {
      const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < r) return true;
    }
    return false;
  }
  clear(ax: number, az: number, bx: number, bz: number) {
    if (!this.on) return true;
    const l = this.segs;
    for (let i = 0; i < l.length; i += 4) {
      const cx = l[i], cz = l[i + 1], dx = l[i + 2], dz = l[i + 3];
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
      const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
      if (d1 * d2 < 0 && d3 * d4 < 0) return false;
    }
    return true;
  }
}

/**
 * Haunted houses: boards over the doors, an open door with candlelight
 * inside, warning signs in the yard, a face at a window now and then; and
 * the Hollow House, a fictional shack you can walk into.
 */
export class Haunts {
  readonly mesh: THREE.Mesh;
  readonly list: Haunt[] = [];
  readonly walls = new Walls();
  readonly notice = FICTION_NOTICE;
  /** The Hollow House's resident: sits in the corner, watching the door. */
  resident: { x: number; z: number; heading: number } | null = null;

  constructor(towns: Town[], hf: Heightfield, roads: RoadIndex) {
    const geo = new Geo();
    const wood = new THREE.Color('#5a4632');
    const darkWood = new THREE.Color('#3a2c20');
    const post = new THREE.Color('#4a3a2c');
    const black = new THREE.Color('#050404');
    const candle = new THREE.Color('#ffb060');
    const white = new THREE.Color('#ffffff');
    let nameIdx = 0, signIdx = 0;
    for (const town of towns) {
      const count = HAUNTS_PER_TOWN[town.name] ?? 0;
      if (!count) continue;
      const rnd = mulberry(HAUNT_SEED[town.name] ?? 1);
      // Anonymous detached houses only: no names, no landmarks, no businesses.
      const pool = town.data.buildings.filter((b) => !b.n && !b.id && (b.k === 0 || b.k === 6) && !b.d);
      const picked: { x: number; z: number }[] = [];
      for (let tries = 0; tries < 400 && picked.length < count; tries++) {
        const b = pool[Math.floor(rnd() * pool.length)];
        if (!b) break;
        const ring: [number, number][] = [];
        for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
        let cx = 0, cz = 0;
        for (const [x, z] of ring) (cx += x), (cz += z);
        cx /= ring.length;
        cz /= ring.length;
        if (!town.covers(cx, cz)) continue;
        if (Math.hypot(cx - town.cx, cz - town.cz) > (town.name === 'Princeton' ? 650 : 1800)) continue;
        if (picked.some((p) => Math.hypot(p.x - cx, p.z - cz) < 120)) continue;
        const road = roads.nearest(cx, cz, 60);
        if (!road) continue;
        // The wall that faces the street.
        let best = -Infinity, wa: [number, number] = ring[0], wb: [number, number] = ring[1], nx = 0, nz = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length];
          const ex = c[0] - a[0], ez = c[1] - a[1];
          const el = Math.hypot(ex, ez);
          if (el < 3) continue;
          let ox = ez / el, oz = -ex / el;
          const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
          if (insidePoly(ring, mx + ox * 0.5, mz + oz * 0.5)) (ox = -ox), (oz = -oz);
          const tx = road.x - mx, tz = road.z - mz;
          const score = (ox * tx + oz * tz) / (Math.hypot(tx, tz) || 1) + el * 0.02;
          if (score > best) (best = score), (wa = a), (wb = c), (nx = ox), (nz = oz);
        }
        picked.push({ x: cx, z: cz });
        const variant = picked.length - 1;
        const name = HAUNT_NAMES[nameIdx++ % HAUNT_NAMES.length];
        this.list.push({ name, town: town.name, x: cx, z: cz, fiction: true });

        const mx = (wa[0] + wb[0]) / 2, mz = (wa[1] + wb[1]) / 2;
        const tx = (wb[0] - wa[0]), tz = (wb[1] - wa[1]);
        const tl = Math.hypot(tx, tz);
        const ux = tx / tl, uz = tz / tl;
        const y = hf.height(mx, mz);
        const out = new THREE.Vector3(nx, 0, nz);
        const at = (u: number, h: number, o = 0.06) => new THREE.Vector3(mx + ux * u + nx * o, y + h, mz + uz * u + nz * o);
        // The door: open on darkness and candlelight, or boarded across.
        const open = variant % 2 === 0;
        geo.quad(at(-0.5, 0), at(0.5, 0), at(0.5, 2.1), at(-0.5, 2.1), black, [0, 0, 0, 0]);
        if (open) {
          geo.quad(at(-0.15, 0.7, 0.04), at(0.15, 0.7, 0.04), at(0.15, 1.0, 0.04), at(-0.15, 1.0, 0.04), candle, [0, 0.6, rnd() * 10, 0]);
          // The door itself, hanging open into the yard.
          const hinge = at(0.5, 0, 0.06);
          const swing = new THREE.Vector3(ux * Math.cos(1.1) + nx * Math.sin(1.1), 0, uz * Math.cos(1.1) + nz * Math.sin(1.1));
          const p0 = hinge.clone(), p1 = hinge.clone().addScaledVector(swing, 0.95);
          geo.quad(p0, p1, p1.clone().setY(y + 2.05), p0.clone().setY(y + 2.05), darkWood, [0, 0, 0, 0]);
        } else {
          geo.beam(at(-0.6, 0.15), at(0.6, 1.95), 0.18, 0.1, out, wood);
          geo.beam(at(0.6, 0.15), at(-0.6, 1.95), 0.18, 0.12, out, wood);
          for (const h of [0.6, 1.3]) geo.beam(at(-0.65, h), at(0.65, h), 0.2, 0.14, out, wood);
        }
        // A face at the window beside the door, now and then.
        const fu = tl / 2 > 2.6 ? 1.9 : -1.6;
        geo.quad(at(fu - 0.22, 1.25, 0.08), at(fu + 0.22, 1.25, 0.08), at(fu + 0.22, 1.69, 0.08), at(fu - 0.22, 1.69, 0.08), white, [1, 0, rnd() * 10, 1], [cellUV(CELL.face)[0] + 0.0625, cellUV(CELL.face)[1], cellUV(CELL.face)[2] - 0.0625, cellUV(CELL.face)[3]]);
        // Warning sign in the yard, facing the street.
        const sx = mx + nx * 3.2 + ux * 2.2, sz = mz + nz * 3.2 + uz * 2.2;
        const sy = hf.height(sx, sz);
        const lean = (rnd() - 0.5) * 0.25;
        geo.box(sx, sy, sz, 0.09, 1.25, 0.09, Math.atan2(ux, uz), post);
        const S = (u: number, h: number) => new THREE.Vector3(sx + ux * u + nx * 0.06, sy + h + u * lean, sz + uz * u + nz * 0.06);
        geo.quad(S(-0.5, 0.95), S(0.5, 0.95), S(0.5, 1.45), S(-0.5, 1.45), white, [1, 0, 0, 0], cellUV(signIdx++ % SIGNS.length));
      }
    }

    // The Hollow House: an invented shack on an empty lot near Princeton's centre.
    const pr = towns.find((t) => t.name === HOLLOW_HOUSE.town);
    if (pr) {
      const rnd = mulberry(0x401107);
      for (let tries = 0; tries < 2000; tries++) {
        const a = rnd() * Math.PI * 2, r = 60 + rnd() * 380;
        const x = pr.cx + Math.cos(a) * r, z = pr.cz + Math.sin(a) * r;
        const road = roads.nearest(x, z, 40);
        if (!road || road.dist < 12 || road.dist > 28) continue;
        if (pr.data.buildings.some((b) => Math.hypot(b.p[0] - x, b.p[1] - z) < 30 && insideOrNear(b.p, x, z, 12))) continue;
        // Front faces the road.
        const fx = (road.x - x) / road.dist, fz = (road.z - z) / road.dist;
        this.hollow(geo, x, z, fx, fz, hf, { wood, darkWood, black, candle, white });
        this.list.push({ name: HOLLOW_HOUSE.name, town: pr.name, x, z, interior: true, fiction: true });
        break;
      }
    }

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { ...G, uAtlas: { value: atlas() } },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo.build(), material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'haunts';
  }

  /** Builds the shack; its walls (with a doorway) join the collision set. */
  private hollow(geo: Geo, x: number, z: number, fx: number, fz: number, hf: Heightfield, c: Record<string, THREE.Color>) {
    const { w, d, h } = HOLLOW_HOUSE;
    // Local frame: v toward the road (front), u to the right.
    const ux = -fz, uz = fx;
    const y0 = hf.height(x, z) - 0.2;
    const P = (u: number, v: number, y: number) => new THREE.Vector3(x + ux * u + fx * v, y0 + y, z + uz * u + fz * v);
    const hw = w / 2, hd = d / 2, door = 0.6;
    const siding = new THREE.Color('#6d6a60');
    const wall = (u0: number, v0: number, u1: number, v1: number, top = h) => {
      geo.quad(P(u0, v0, 0), P(u1, v1, 0), P(u1, v1, top), P(u0, v0, top), siding, [0, 0, 0, 0]);
      const a = P(u0, v0, 0), b = P(u1, v1, 0);
      this.walls.add(a.x, a.z, b.x, b.z);
    };
    wall(-hw, -hd, hw, -hd);
    wall(hw, -hd, hw, hd);
    wall(-hw, hd, -hw, -hd);
    // Front wall with the doorway (no door, just the dark).
    wall(hw, hd, door, hd);
    wall(-door, hd, -hw, hd);
    geo.quad(P(door, hd, 2.1), P(-door, hd, 2.1), P(-door, hd, h), P(door, hd, h), siding, [0, 0, 0, 0]);
    // Gable roof, sagging and holed.
    const ridge = h + 1.6;
    const roof = new THREE.Color('#3b3833');
    geo.quad(P(-hw - 0.3, -hd - 0.3, h - 0.1), P(-hw - 0.3, hd + 0.3, h - 0.1), P(0, hd + 0.3, ridge), P(0, -hd - 0.3, ridge - 0.25), roof, [0, 0, 0, 0]);
    geo.quad(P(hw + 0.3, hd + 0.3, h - 0.1), P(hw + 0.3, -hd - 0.3, h - 0.1), P(0, -hd - 0.3, ridge - 0.25), P(0, hd + 0.3, ridge), roof, [0, 0, 0, 0]);
    geo.quad(P(-hw, hd, h), P(hw, hd, h), P(0, hd, ridge), P(0, hd, ridge), siding, [0, 0, 0, 0]);
    geo.quad(P(hw, -hd, h), P(-hw, -hd, h), P(0, -hd, ridge - 0.25), P(0, -hd, ridge - 0.25), siding, [0, 0, 0, 0]);
    // Floor.
    geo.quad(P(-hw, -hd, 0.22), P(hw, -hd, 0.22), P(hw, hd, 0.22), P(-hw, hd, 0.22), c.darkWood, [0, 0, 0, 0]);
    // Inside: a table, an overturned chair, candles, the drawings.
    const ang = Math.atan2(ux, uz);
    const T = P(0.6, -1.2, 0.22);
    geo.box(T.x, T.y + 0.72, T.z, 1.4, 0.06, 0.8, ang, c.wood);
    for (const [a, b] of [[-0.6, -0.33], [0.6, -0.33], [-0.6, 0.33], [0.6, 0.33]]) {
      const L = P(0.6 + a, -1.2 + b, 0.22);
      geo.box(L.x, L.y, L.z, 0.06, 0.72, 0.06, ang, c.wood);
    }
    const C = P(-1.0, 0.4, 0.22);
    geo.box(C.x, C.y, C.z, 0.45, 0.45, 0.06, ang + 0.6, c.darkWood);
    geo.box(C.x, C.y + 0.05, C.z, 0.06, 0.06, 0.9, ang + 0.6, c.darkWood);
    for (const [u, v] of [[0.3, -1.1], [0.9, -1.3], [1.05, -1.0]]) {
      const p = P(u, v, 0.22 + 0.78);
      geo.box(p.x, p.y, p.z, 0.05, 0.12, 0.05, ang, new THREE.Color('#e8e0c8'));
      geo.box(p.x, p.y + 0.12, p.z, 0.02, 0.03, 0.02, ang, c.candle, [0, 3, u * 9 + v, 0]);
    }
    // Drawings pinned to the back wall.
    [CELL.draw0, CELL.draw1, CELL.draw2, CELL.draw1, CELL.draw2].forEach((cell, i) => {
      const u0 = -hw + 0.5 + i * 0.95, y = 1.2 + (i % 2) * 0.35;
      geo.quad(P(u0, -hd + 0.03, y), P(u0 + 0.7, -hd + 0.03, y), P(u0 + 0.7, -hd + 0.03, y + 0.35), P(u0, -hd + 0.03, y + 0.35), c.white, [1, 0, 0, 0], cellUV(cell));
    });
    const R = P(-hw + 0.7, -hd + 0.7, 0.22);
    this.resident = { x: R.x, z: R.z, heading: Math.atan2(fx + ux * 0.3, fz + uz * 0.3) };
  }

  /** 0..1 how near the closest haunt is (1 = at the door). */
  proximity(x: number, z: number) {
    let best = 0;
    for (const h of this.list) best = Math.max(best, 1 - Math.hypot(h.x - x, h.z - z) / 45);
    return Math.max(0, best);
  }

  nearest(x: number, z: number) {
    let best: Haunt | null = null, bd = Infinity;
    for (const h of this.list) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < bd) (bd = d), (best = h);
    }
    return best ? { haunt: best, dist: bd } : null;
  }

  update(level: number) {
    this.walls.on = level > 0.5;
    this.mesh.visible = level > 0.02;
  }
}

function insideOrNear(p: number[], x: number, z: number, r: number) {
  for (let i = 0; i < p.length; i += 2) if (Math.hypot(p[i] - x, p[i + 1] - z) < r) return true;
  const ring: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) ring.push([p[i], p[i + 1]]);
  return insidePoly(ring, x, z);
}
