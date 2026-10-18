import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import { wireFragment, wireVertex } from '../render/shaders/wireShader';
import type { Heightfield } from './heightfield';
import { LC, type OsmData } from './meta';
import type { RoadIndex } from './roadIndex';
import { roadSpec } from './roads';

const postVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
flat out float vSeed;

void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(m) * normal);
  vLocal = position;
  vSeed = fract(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.71);
  vec2 dc = w.xz - uCamPos.xz;
  w.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const postFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform float uSteel;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
flat in float vSeed;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  vec3 alb;
  float rough;
  if (uSteel > 0.5) {
    // Green-painted steel T-post, rusting through.
    float rust = smoothstep(0.45, 0.8, vnoise3(vLocal * vec3(40.0, 9.0, 40.0) + vSeed * 20.0));
    alb = mix(vec3(0.07, 0.11, 0.07), vec3(0.2, 0.1, 0.05), rust);
    rough = 0.6;
  } else {
    // Split cedar weathered silver-grey, darker in the grain and near the ground.
    float grain = vnoise(vec2(atan(vLocal.x, vLocal.z) * 3.0, vLocal.y * 1.5) + vSeed * 9.0);
    float streak = vnoise(vec2(atan(vLocal.x, vLocal.z) * 12.0, vLocal.y * 0.4));
    alb = vec3(0.3, 0.28, 0.25) * (0.7 + 0.35 * grain) * (0.75 + 0.3 * streak);
    alb *= mix(0.55, 1.0, smoothstep(0.0, 0.35, vLocal.y + 0.15));
    alb *= 0.85 + 0.3 * vSeed;
    rough = 0.9;
  }
  float shadow = shadowAt(vWorld + n * 0.03, 0.0008);
  vec3 col = shadeSurface(alb, n, vWorld, 1.0, rough, shadow);
  outColor = vec4(applyAtmosphere(col, vWorld), 1.0);
}
`;

const TILE = 300;
const SPACING = 3.6;
const STRANDS = [0.42, 0.68, 0.94, 1.2];
const FENCED = new Set<number>([LC.GRASS, LC.HAY, LC.FALLOW, LC.WOODLAND, LC.OTHER, LC.WALNUT, LC.ALMOND, LC.FRUIT, LC.ROWCROP]);
const KINDS = new Set(['tertiary', 'unclassified', 'secondary', 'primary']);

interface Tile {
  cx: number;
  cz: number;
  group: THREE.Group;
}

interface Build {
  wood: THREE.Matrix4[];
  steel: THREE.Matrix4[];
  spans: number[];
}

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Barbed-wire ranch fences with cedar and steel posts along rural roads. */
export class Fences {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  private wireMat: THREE.ShaderMaterial;
  count = 0;

  constructor(osm: OsmData, hf: Heightfield, roads: RoadIndex, radius = 9000) {
    const builds = new Map<number, Build>();
    const key = (x: number, z: number) => Math.floor(x / TILE) * 10007 + Math.floor(z / TILE);
    const tileOf = (x: number, z: number) => {
      const k = key(x, z);
      let b = builds.get(k);
      if (!b) builds.set(k, (b = { wood: [], steel: [], spans: [] }));
      return b;
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();

    for (const road of osm.roads) {
      if (!KINDS.has(road.kind)) continue;
      const half = roadSpec(road).half;
      const off = half + 2.6;
      const p = road.pts;
      // Previous post per side, so spans only join unbroken runs.
      const last: ({ x: number; y: number; z: number } | null)[] = [null, null];
      let carry = 0;
      let k = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        let s = carry;
        for (; s < len; s += SPACING, k++) {
          const cx = ax + dx * s, cz = az + dz * s;
          if (Math.abs(cx) > radius || Math.abs(cz) > radius) {
            last[0] = last[1] = null;
            continue;
          }
          for (let side = 0; side < 2; side++) {
            const sg = side ? 1 : -1;
            const x = cx - dz * off * sg, z = cz + dx * off * sg;
            const seed = hash(x * 0.013 + z * 0.029);
            let ok = FENCED.has(hf.landcover(x, z)) && seed > 0.015;
            if (ok) {
              const near = roads.nearest(x, z, off + 2);
              // Another road (crossing or driveway) nearer than this one: leave a gap.
              if (near && near.dist < near.halfWidth + 1.8) ok = false;
            }
            if (!ok) {
              last[side] = null;
              continue;
            }
            const y = hf.height(x, z);
            const wood = k % 4 === 0;
            e.set((seed - 0.5) * 0.06, seed * 6.28, (hash(seed * 7.1) - 0.5) * 0.06);
            q.setFromEuler(e);
            pos.set(x, y, z);
            m.compose(pos, q, one);
            const b = tileOf(x, z);
            (wood ? b.wood : b.steel).push(m.clone());
            const prev = last[side];
            if (prev && Math.hypot(prev.x - x, prev.z - z) < SPACING * 1.8) {
              for (const h of STRANDS) b.spans.push(prev.x, prev.y + h, prev.z, x, y + h, z);
            }
            last[side] = { x, y, z };
            this.count++;
          }
        }
        carry = s - len;
      }
    }

    const mat = (steel: boolean) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: postVertex,
        fragmentShader: postFragment,
        uniforms: { ...G, uSteel: { value: steel ? 1 : 0 } },
      });
    const woodMat = mat(false);
    const steelMat = mat(true);
    const woodGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.55, 7, 1).translate(0, 1.55 / 2 - 0.15, 0);
    const steelGeo = new THREE.BoxGeometry(0.035, 1.4, 0.05).translate(0, 0.62, 0);
    this.wireMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: wireVertex,
      fragmentShader: wireFragment,
      uniforms: { ...G, uPixelAngle: { value: 0.001 }, uFar: { value: 320 }, uWireColor: { value: new THREE.Vector3(0.2, 0.2, 0.19) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const SEG = 4;
    const strip: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      strip.push(i / SEG, -1, i / SEG, 1);
      if (i < SEG) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const stripAttr = new THREE.Float32BufferAttribute(strip, 2);
    const posAttr = new THREE.Float32BufferAttribute(new Float32Array((SEG + 1) * 6), 3);

    for (const b of builds.values()) {
      const group = new THREE.Group();
      for (const [list, geo, material] of [[b.wood, woodGeo, woodMat], [b.steel, steelGeo, steelMat]] as const) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, material, list.length);
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.frustumCulled = false;
        group.add(im);
      }
      const n = b.spans.length / 6;
      if (n) {
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', posAttr);
        geo.setAttribute('aStrip', stripAttr);
        geo.setIndex(index);
        const a0 = new Float32Array(n * 4);
        const a1 = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const s = i * 6;
          a0.set([b.spans[s], b.spans[s + 1], b.spans[s + 2], 0.03], i * 4);
          a1.set([b.spans[s + 3], b.spans[s + 4], b.spans[s + 5], 0.0012], i * 4);
        }
        geo.setAttribute('aP0', new THREE.InstancedBufferAttribute(a0, 4));
        geo.setAttribute('aP1', new THREE.InstancedBufferAttribute(a1, 4));
        geo.instanceCount = n;
        const wires = new THREE.Mesh(geo, this.wireMat);
        wires.frustumCulled = false;
        wires.renderOrder = 5;
        group.add(wires);
      }
      const anyM = (b.wood[0] ?? b.steel[0]).elements;
      group.visible = false;
      this.group.add(group);
      this.tiles.push({ cx: anyM[12], cz: anyM[14], group });
    }
  }

  update(cam: THREE.PerspectiveCamera, groundH: number, heightPx: number) {
    this.wireMat.uniforms.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / heightPx;
    const agl = cam.position.y - groundH;
    const R = agl > 350 ? 0 : 700;
    for (const t of this.tiles) {
      t.group.visible = Math.hypot(t.cx - cam.position.x, t.cz - cam.position.z) < R + TILE;
    }
  }
}
