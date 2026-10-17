import * as THREE from 'three';
import { G } from './globals';

const SIZE = 2048;

/**
 * Sun/moon shadow map for nearby casters (trees, bird, wildlife). Casters render
 * a depth variant of their own shader that writes the light-space depth used by
 * nearShadow(), so the result is independent of the main depth conventions.
 */
export class ShadowMap {
  readonly scene = new THREE.Scene();
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.OrthographicCamera;
  extent = 640;
  range = 1600;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private center = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  private proj = new THREE.Matrix4();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, this.range);
    G.uShadowMap.value = this.target.texture;
  }

  /** Adds a caster that shares a geometry with a visible mesh. */
  addCaster(geometry: THREE.BufferGeometry, material: THREE.Material, follow?: THREE.Object3D) {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    if (follow) m.onBeforeRender = () => m.matrixWorld.copy(follow.matrixWorld);
    this.scene.add(m);
    return m;
  }

  update(renderer: THREE.WebGLRenderer, focus: THREE.Vector3) {
    const L = G.uSunDir.value.y > -0.02 ? G.uSunDir.value : G.uMoonDir.value;
    if (L.y < 0.03) {
      G.uShadowOn.value = 0;
      return;
    }
    this.lightDir.copy(L).normalize();
    const e = this.extent / 2;
    // Light-space basis; snap the focus to whole texels to stop shimmering.
    const up = Math.abs(this.lightDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, this.lightDir).normalize();
    const top = new THREE.Vector3().crossVectors(this.lightDir, right);
    const texel = this.extent / SIZE;
    const u = Math.round(focus.dot(right) / texel) * texel;
    const v = Math.round(focus.dot(top) / texel) * texel;
    const w = focus.dot(this.lightDir);
    this.center.set(0, 0, 0).addScaledVector(right, u).addScaledVector(top, v).addScaledVector(this.lightDir, w);
    const cam = this.camera;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = this.range;
    cam.position.copy(this.center).addScaledVector(this.lightDir, this.range * 0.6);
    cam.up.copy(top);
    cam.lookAt(this.center);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    // Standard (non reversed) ortho projection for the lookup matrix.
    this.proj.makeOrthographic(-e, e, e, -e, 1, this.range);
    G.uShadowMatrix.value.multiplyMatrices(this.bias, this.proj).multiply(cam.matrixWorldInverse);
    G.uShadowOn.value = 1;

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
  }
}
