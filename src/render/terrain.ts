import * as THREE from 'three';
import { G } from './globals';
import { terrainFragment, terrainVertex } from './shaders/terrainShader';
import type { WorldTextures } from '../world/textures';

const GRID = 32;
const ROOT_SIZE = 524288;
const MIN_SIZE = 64;
const MAX_NODES = 4096;
const R_EFF = 7310000;

export const seasonUniforms = {
  uVeg: { value: new THREE.Vector4(0, 1, 0, 0) },
  uRice: { value: new THREE.Vector4(0, 0, 1, 0) },
  uOrchard: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSnowLine: { value: 3000 },
};

function patchGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const verts = new Float32Array((GRID + 1) * (GRID + 1) * 3);
  let k = 0;
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      verts[k++] = i / GRID;
      verts[k++] = 0;
      verts[k++] = j / GRID;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i;
      const b = a + 1;
      const c = a + GRID + 1;
      const d = c + 1;
      // Alternate the diagonal for a more isotropic triangulation.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  const node = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 4), 4);
  node.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aNode', node);
  geo.instanceCount = 0;
  return geo;
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private frustum = new THREE.Frustum();
  private box = new THREE.Box3();
  private projView = new THREE.Matrix4();
  private camPos = new THREE.Vector3();
  private count = 0;
  lodK = 2.2;
  nodeCount = 0;

  constructor(tex: WorldTextures, regionSizes: [number, number, number], lcSize: number) {
    this.geo = patchGeometry();
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      uniforms: {
        ...G,
        ...seasonUniforms,
        uHInner: { value: tex.heightInner },
        uHMid: { value: tex.heightMid },
        uHFar: { value: tex.heightFar },
        uImgInner: { value: tex.imgInner },
        uImgMid: { value: tex.imgMid },
        uImgFar: { value: tex.imgFar },
        uImgTown: { value: tex.imgTown },
        uTown: { value: tex.town },
        uMaskA: { value: tex.maskA },
        uMaskB: { value: tex.maskB },
        uRegionSize: { value: new THREE.Vector3(...regionSizes) },
        uLcSize: { value: lcSize },
        uGridDim: { value: GRID },
        uLodK: { value: this.lodK },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'terrain';
  }

  get geometry() {
    return this.geo;
  }

  get material() {
    return this.mesh.material as THREE.ShaderMaterial;
  }

  update(camera: THREE.PerspectiveCamera) {
    this.material.uniforms.uLodK.value = this.lodK;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem, camera.reversedDepth);
    this.camPos.copy(camera.position);
    this.count = 0;
    const h = ROOT_SIZE / 2;
    this.select(-h, -h, ROOT_SIZE);
    const attr = this.geo.getAttribute('aNode') as THREE.InstancedBufferAttribute;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, this.count * 4);
    attr.needsUpdate = true;
    this.geo.instanceCount = this.count;
    this.nodeCount = this.count;
  }

  private select(x0: number, z0: number, size: number) {
    const c = this.camPos;
    const inValley = Math.max(Math.abs(x0 + size / 2), Math.abs(z0 + size / 2)) - size / 2 < 26000;
    const maxY = inValley ? 700 : 3700;
    const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size));
    const dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
    const farDist = Math.hypot(Math.max(Math.abs(x0 - c.x), Math.abs(x0 + size - c.x)), Math.max(Math.abs(z0 - c.z), Math.abs(z0 + size - c.z)));
    const minY = -10 - (farDist * farDist) / (2 * R_EFF);
    this.box.min.set(x0, minY, z0);
    this.box.max.set(x0 + size, maxY, z0 + size);
    if (!this.frustum.intersectsBox(this.box)) return;
    const dy = Math.max(minY - c.y, 0, c.y - maxY);
    const d = Math.hypot(dx, dy, dz);
    if (size > MIN_SIZE && d < size * this.lodK) {
      const s = size / 2;
      this.select(x0, z0, s);
      this.select(x0 + s, z0, s);
      this.select(x0, z0 + s, s);
      this.select(x0 + s, z0 + s, s);
      return;
    }
    if (this.count >= MAX_NODES) return;
    const arr = (this.geo.getAttribute('aNode') as THREE.InstancedBufferAttribute).array as Float32Array;
    const o = this.count * 4;
    arr[o] = x0;
    arr[o + 1] = z0;
    arr[o + 2] = size;
    arr[o + 3] = Math.log2(size / MIN_SIZE);
    this.count++;
  }
}
