import * as THREE from 'three';
import type { Terrain } from './terrain';
import { waterFragment, waterVertex } from './shaders/waterShader';

/** Rivers, sloughs and ponds: a second pass over the terrain's quadtree at the water level. */
export class WaterSurface {
  readonly mesh: THREE.Mesh;

  constructor(terrain: Terrain) {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      uniforms: terrain.material.uniforms,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(terrain.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
  }
}
