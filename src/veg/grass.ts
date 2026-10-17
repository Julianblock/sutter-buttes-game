import * as THREE from 'three';
import { G } from '../render/globals';
import { grassFragment, grassVertex } from '../render/shaders/grassShader';
import { seasonUniforms } from '../render/terrain';
import type { Heightfield } from '../world/heightfield';

const BLADES = 6;

function clumpGeometry(): THREE.InstancedBufferGeometry {
  // Tapered blade: three segments narrowing to a point.
  const rows = [
    [0, 1],
    [0.4, 0.85],
    [0.75, 0.55],
  ];
  const pos: number[] = [];
  const blade: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const o = pos.length / 3;
    for (const [y, w] of rows) {
      pos.push(-0.5 * w, y, 0, 0.5 * w, y, 0);
      blade.push(b, b);
    }
    pos.push(0, 1, 0);
    blade.push(b);
    for (let r = 0; r < rows.length - 1; r++) {
      const a = o + r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = o + (rows.length - 1) * 2;
    index.push(a, a + 1, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 1));
  g.setIndex(index);
  return g;
}

/** Sward height by month (m): green-up after the rains, tall wild oats in spring, cured through summer. */
const SWARD = [0.22, 0.3, 0.45, 0.6, 0.65, 0.6, 0.55, 0.5, 0.48, 0.42, 0.18, 0.18];

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  spacing: number;
  n: number;
}

/**
 * Blade-level grass on the Buttes' open grassland, drawn in two camera-centred
 * rings snapped to a world grid so clumps stay put as the camera moves.
 */
export class Grass {
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private hf: Heightfield;
  maxAgl = 160;

  constructor(terrainUniforms: Record<string, THREE.IUniform>, hf: Heightfield) {
    this.hf = hf;
    const geo = clumpGeometry();
    const shared = {
      uHInner: terrainUniforms.uHInner,
      uHMid: terrainUniforms.uHMid,
      uHFar: terrainUniforms.uHFar,
      uImgInner: terrainUniforms.uImgInner,
      uImgMid: terrainUniforms.uImgMid,
      uMaskA: terrainUniforms.uMaskA,
      uRegionSize: terrainUniforms.uRegionSize,
      uLcSize: terrainUniforms.uLcSize,
      uVeg: seasonUniforms.uVeg,
    };
    // Inner: fine clumps to ~55 m. Outer: coarse, wider-bladed clumps to ~120 m.
    const specs = [
      { spacing: 0.42, n: 260, fadeIn: [-1, 0], fadeOut: [40, 54] },
      { spacing: 1.2, n: 200, fadeIn: [40, 54], fadeOut: [85, 118] },
    ];
    for (const s of specs) {
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: grassVertex,
        fragmentShader: grassFragment,
        uniforms: {
          ...G,
          ...shared,
          uOrigin: { value: new THREE.Vector2() },
          uSpacing: { value: s.spacing },
          uN: { value: s.n },
          uFadeIn: { value: new THREE.Vector2(...s.fadeIn) },
          uFadeOut: { value: new THREE.Vector2(...s.fadeOut) },
          uGrassH: { value: 0.5 },
        },
        side: THREE.DoubleSide,
      });
      const g = geo.clone() as THREE.InstancedBufferGeometry;
      g.instanceCount = s.n * s.n;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, spacing: s.spacing, n: s.n });
    }
  }

  update(cam: THREE.Vector3, month: number) {
    const agl = cam.y - this.hf.height(cam.x, cam.z);
    const on = agl < this.maxAgl;
    const m = ((month % 12) + 12) % 12;
    const i = Math.floor(m);
    const h = THREE.MathUtils.lerp(SWARD[i], SWARD[(i + 1) % 12], m - i);
    for (const r of this.rings) {
      r.mesh.visible = on;
      r.mat.uniforms.uOrigin.value.set(Math.floor(cam.x / r.spacing) * r.spacing, Math.floor(cam.z / r.spacing) * r.spacing);
      r.mat.uniforms.uGrassH.value = h;
    }
  }
}
