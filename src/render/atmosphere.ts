import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { G } from './globals';
import { atmosphereCommon } from './shaders/atmosphereCommon';

const vert = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const transmittanceFrag = /* glsl */ `
${atmosphereCommon}
in vec2 vUv;
out vec4 outColor;
void main() {
  float r, mu;
  transmittanceRMu(vUv, r, mu);
  float d = distanceToTop(r, mu);
  const int STEPS = 48;
  vec3 od = vec3(0.0);
  float dt = d / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * dt;
    float rr = sqrt(r * r + t * t + 2.0 * r * mu * t);
    od += extinctionAt(rr - R_GROUND) * dt;
  }
  outColor = vec4(exp(-od), 1.0);
}
`;

const skyViewFrag = /* glsl */ `
${atmosphereCommon}
uniform sampler2D uTransmittanceLUT;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform float uLightScale;
in vec2 vUv;
out vec4 outColor;

vec3 transmittanceToTop(float r, float mu) {
  return texture(uTransmittanceLUT, transmittanceUV(r, mu)).rgb;
}

void main() {
  float r = R_GROUND + max(uCamPos.y, 1.0) + 2.0;
  float vHorizon = sqrt(r * r - R_GROUND * R_GROUND);
  float beta = acos(vHorizon / r);
  float zenithHorizon = PI - beta;
  float vza;
  if (vUv.y < 0.5) {
    float c = 1.0 - 2.0 * vUv.y;
    vza = zenithHorizon * (1.0 - c * c);
  } else {
    float c = vUv.y * 2.0 - 1.0;
    vza = zenithHorizon + beta * c * c;
  }
  float lightViewCos = 1.0 - 2.0 * vUv.x * vUv.x;

  float sunZenithCos = uLightDir.y;
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - sunZenithCos * sunZenithCos)), sunZenithCos, 0.0);
  float sinV = sin(vza);
  float az = acos(clamp(lightViewCos, -1.0, 1.0));
  vec3 dir = vec3(sinV * cos(az), cos(vza), sinV * sin(az));

  float mu = dir.y;
  float tMax = hitsGround(r, mu) ? distanceToGround(r, mu) : distanceToTop(r, mu);
  tMax = min(tMax, 400000.0);

  const int STEPS = 32;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float cosTheta = dot(dir, sunDir);
  float phR = rayleighPhase(cosTheta);
  float phM = miePhase(cosTheta, 0.76);
  float prevT = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + 0.3) / float(STEPS);
    float t = tMax * f * f;
    float dt = t - prevT;
    prevT = t;
    vec3 p = vec3(0.0, r, 0.0) + dir * t;
    float pr = length(p);
    float h = pr - R_GROUND;
    vec3 up = p / pr;
    float sunMu = dot(up, sunDir);
    vec3 Tsun = hitsGround(pr, sunMu) ? vec3(0.0) : transmittanceToTop(pr, sunMu);
    vec3 scatR = RAYLEIGH_SCAT * rayleighDensity(h);
    float scatM = MIE_SCAT * uMieScale * mieDensity(h);
    vec3 ext = extinctionAt(h);
    // Cheap multiple scattering: isotropic light proportional to the sunlit fraction.
    // Tinted by the (reddened) sunlight reaching this altitude so dusk glows warm.
    vec3 Tdiff = transmittanceToTop(pr, max(sunMu, 0.08));
    vec3 ms = (scatR + scatM) * 0.06 * mix(Tdiff, vec3(dot(Tdiff, vec3(0.333))), 0.35) * smoothstep(-0.16, 0.06, sunMu);
    vec3 S = (scatR * phR + scatM * phM) * Tsun + ms;
    vec3 sampleT = exp(-ext * dt);
    vec3 Sint = (S - S * sampleT) / max(ext, vec3(1e-9));
    L += T * Sint;
    T *= sampleT;
  }
  outColor = vec4(L * SUN_ILLUMINANCE * uLightScale, 1.0);
}
`;

const ambientFrag = /* glsl */ `
${atmosphereCommon}
uniform sampler2D uSkyViewLUT;
uniform sampler2D uMoonViewLUT;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonScale;
in vec2 vUv;
out vec4 outColor;

vec3 skyRadiance(vec3 dir, float r) {
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  vec2 mh = normalize(uMoonDir.xz + vec2(1e-5, 0.0));
  vec2 dh = normalize(dir.xz + vec2(0.0, 1e-5));
  vec3 s = texture(uSkyViewLUT, skyViewUV(r, dir.y, dot(dh, sh))).rgb;
  vec3 m = texture(uMoonViewLUT, skyViewUV(r, dir.y, dot(dh, mh))).rgb;
  return s + m * uMoonScale;
}

// Texel 0: irradiance on an upward-facing surface. Texel 1: average horizon radiance.
void main() {
  float r = R_GROUND + max(uCamPos.y, 1.0) + 2.0;
  vec3 E = vec3(0.0);
  vec3 H = vec3(0.0);
  const int NA = 16;
  const int NE = 8;
  for (int a = 0; a < NA; a++) {
    float phi = (float(a) + 0.5) / float(NA) * 2.0 * PI;
    for (int e = 0; e < NE; e++) {
      float ce = (float(e) + 0.5) / float(NE);
      float se = sqrt(1.0 - ce * ce);
      vec3 dir = vec3(se * cos(phi), ce, se * sin(phi));
      E += skyRadiance(dir, r) * ce;
    }
    H += skyRadiance(normalize(vec3(cos(phi), 0.02, sin(phi))), r);
  }
  E *= 2.0 * PI / float(NA * NE);
  H /= float(NA);
  outColor = vec4(vUv.x < 0.5 ? E : H, 1.0);
}
`;

function target(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new FullScreenQuad(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );
}

export class Atmosphere {
  private transmittance = target(256, 64);
  private sunView = target(192, 108);
  private moonView = target(192, 108);
  private ambient = target(2, 1);
  private skyPass: FullScreenQuad;
  private lightDir = { value: new THREE.Vector3() };
  private lightScale = { value: 1 };
  private ambientPass: FullScreenQuad;

  constructor(private renderer: THREE.WebGLRenderer) {
    const tPass = pass(transmittanceFrag, { uMieScale: G.uMieScale });
    renderer.setRenderTarget(this.transmittance);
    tPass.render(renderer);
    renderer.setRenderTarget(null);
    tPass.dispose();

    G.uTransmittanceLUT.value = this.transmittance.texture;
    G.uSkyViewLUT.value = this.sunView.texture;
    G.uMoonViewLUT.value = this.moonView.texture;
    G.uAmbientLUT.value = this.ambient.texture;
    this.ambient.texture.minFilter = THREE.NearestFilter;
    this.ambient.texture.magFilter = THREE.NearestFilter;

    this.skyPass = pass(skyViewFrag, {
      uTransmittanceLUT: G.uTransmittanceLUT,
      uCamPos: G.uCamPos,
      uMieScale: G.uMieScale,
      uLightDir: this.lightDir,
      uLightScale: this.lightScale,
    });
    this.ambientPass = pass(ambientFrag, {
      uSkyViewLUT: G.uSkyViewLUT,
      uMoonViewLUT: G.uMoonViewLUT,
      uCamPos: G.uCamPos,
      uSunDir: G.uSunDir,
      uMoonDir: G.uMoonDir,
      uMoonScale: G.uMoonScale,
      uMieScale: G.uMieScale,
    });
  }

  /** Re-renders the haze-dependent transmittance LUT (call when weather changes). */
  rebuildTransmittance() {
    const tPass = pass(transmittanceFrag, { uMieScale: G.uMieScale });
    this.renderer.setRenderTarget(this.transmittance);
    tPass.render(this.renderer);
    tPass.dispose();
    this.renderer.setRenderTarget(null);
  }

  update() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.lightDir.value.copy(G.uSunDir.value);
    this.lightScale.value = 1;
    r.setRenderTarget(this.sunView);
    this.skyPass.render(r);
    this.lightDir.value.copy(G.uMoonDir.value);
    this.lightScale.value = 1;
    r.setRenderTarget(this.moonView);
    this.skyPass.render(r);
    r.setRenderTarget(this.ambient);
    this.ambientPass.render(r);
    r.setRenderTarget(prev);
  }
}
