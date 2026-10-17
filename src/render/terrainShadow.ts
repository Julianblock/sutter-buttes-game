import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { G } from './globals';
import { terrainCommon } from './shaders/terrainCommon';
import type { WorldTextures } from '../world/textures';

const SIZE = 50000;
const RES = 2048;

const frag = /* glsl */ `
${terrainCommon}
uniform vec3 uLight;
uniform float uSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 xz = (vUv - 0.5) * uSize;
  float h0 = terrainHeight(xz);
  vec2 d = normalize(uLight.xz + vec2(1e-6));
  float tanE = uLight.y / max(length(uLight.xz), 1e-4);
  float hmax = -1000.0;
  float t = 12.0;
  for (int i = 0; i < 110; i++) {
    vec2 p = xz + d * t;
    float h = terrainHeight(p) - t * tanE;
    hmax = max(hmax, h);
    if (h0 + 0.0 < hmax - 400.0) break;
    t *= 1.075;
    if (t > 45000.0) break;
  }
  outColor = vec4(hmax, 0.0, 0.0, 1.0);
}
`;

export class TerrainShadow {
  private target = new THREE.WebGLRenderTarget(RES, RES, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  private quad: FullScreenQuad;
  private light = { value: new THREE.Vector3(0, 1, 0) };
  private last = new THREE.Vector3(0, -2, 0);

  constructor(private renderer: THREE.WebGLRenderer, tex: WorldTextures, regionSizes: [number, number, number]) {
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: frag,
        uniforms: {
          uHInner: { value: tex.heightInner },
          uHMid: { value: tex.heightMid },
          uHFar: { value: tex.heightFar },
          uRegionSize: { value: new THREE.Vector3(...regionSizes) },
          uLight: this.light,
          uSize: { value: SIZE },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
    G.uTerrainShadow.value = this.target.texture;
    G.uTerrainShadowSize.value = SIZE;
  }

  /** Recomputes the shadow heights when the dominant light has moved noticeably. */
  update(force = false) {
    const sun = G.uSunDir.value;
    const L = sun.y > -0.02 ? sun : G.uMoonDir.value;
    const dir = this.light.value.copy(L);
    if (dir.y < 0.003) dir.y = 0.003;
    dir.normalize();
    if (!force && dir.angleTo(this.last) < 0.003) return;
    this.last.copy(dir);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(prev);
  }
}
