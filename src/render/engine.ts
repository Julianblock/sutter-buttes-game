import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { createGradePass } from './gradePass';

function supportsReversedDepth(): boolean {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const ok = !!gl?.getExtension('EXT_clip_control');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly exposurePass: ShaderPass;
  readonly grade: ShaderPass;
  pixelRatio = Math.min(window.devicePixelRatio, 2);

  constructor(canvas: HTMLCanvasElement) {
    const reversed = supportsReversedDepth();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      reversedDepthBuffer: reversed,
      logarithmicDepthBuffer: !reversed,
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 0.3;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 1500000);
    this.scene.add(this.camera);

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight).multiplyScalar(this.pixelRatio);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Exposure is applied before bloom so the bloom threshold is in display units.
    this.exposurePass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uExposure: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        // Clamp so a stray NaN/Inf pixel can never be smeared over the frame by bloom.
        'uniform sampler2D tDiffuse; uniform float uExposure; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure; c = clamp(c, vec3(0.0), vec3(64.0)); if (!(c.r + c.g + c.b < 1e6)) c = vec3(0.0); gl_FragColor = vec4(c, 1.0); }',
    });
    this.composer.addPass(this.exposurePass);
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.3, 0.6, 2.2);
    this.composer.addPass(this.bloom);
    this.grade = createGradePass();
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
  }

  render(exposure: number, night = 0, time = 0) {
    this.exposurePass.uniforms.uExposure.value = exposure;
    this.grade.uniforms.uNight.value = night;
    this.grade.uniforms.uTime.value = time % 100;
    this.renderer.toneMappingExposure = 1;
    this.composer.render();
  }
}
