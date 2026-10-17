import * as THREE from 'three';
import { G } from '../render/globals';
import { skyFragment, skyVertex } from './skyShader';

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly starBrightness = { value: 0.002 };

  constructor() {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { ...G, uStarBrightness: this.starBrightness },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material);
    this.mesh.scale.setScalar(600000);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  update(camera: THREE.Camera, exposure: number) {
    this.mesh.position.copy(camera.position);
    // Keep stars perceptually constant regardless of the night exposure boost.
    this.starBrightness.value = (0.9 / exposure) * THREE.MathUtils.smoothstep(G.uNight.value, 0.3, 1.0);
  }
}
