import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';
import type { Palette } from './species';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in vec2 aUv;
in float aPart;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec2 vUv;
flat out int vPart;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  vUv = aUv;
  vPart = int(aPart + 0.5);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${lightingCommon}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec2 vUv;
flat in int vPart;
out vec4 outColor;

uniform vec3 cHead, cThroat, cBreast, cBelly, cBack, cCoverts, cSecondaries, cPrimaries;
uniform vec3 cUnderCoverts, cUnderFlight, cTail, cTailUnder, cBeak, cCere, cLegs, cEye, cSkin, cTailBand;
// x bellyBand, y barring, z tailBands, w wingtipDark
uniform vec4 uPat0;
// x trailingEdge, y patagial, z carpal, w rump
uniform vec4 uPat1;
// x mottle, y helmet, z skinHead, w crown
uniform vec4 uPat2;
// x wingPanel, y headT, z fingerStart, w scale (wingspan)
uniform vec4 uPat3;
uniform float uFade;

float featherFringe(vec2 p, float scale) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id);
  // Overlapping scalloped feathers: pale fringe along the feather tip.
  float d = length((f - vec2(0.5, 0.0)) * vec2(1.0, 0.8));
  return smoothstep(0.62, 0.78, d) * (0.6 + 0.4 * h);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec2 uv = vUv;
  vec3 albedo = cBack;
  float rough = 0.75;
  float sheen = 0.25;
  float thin = 0.0;
  float headT = uPat3.y;

  if (vPart == 0) {
    float t = uv.x;
    float a = uv.y;
    float ca = cos(a * 6.2831853);
    float ventral = smoothstep(0.15, -0.35, ca);
    float side = abs(sin(a * 6.2831853));
    if (t > 0.94) {
      // Facial disk (owl): pale face with a darker rim.
      float ring = smoothstep(0.985, 1.0, t);
      albedo = mix(cThroat, cBack, ring * 0.6);
    } else if (t > headT) {
      albedo = mix(cHead, cThroat, smoothstep(-0.05, -0.6, ca));
      // Falcon moustache / dark hood on the cheeks below the eye.
      float cheek = smoothstep(0.55, 0.85, side) * smoothstep(0.6, -0.2, ca) * smoothstep(headT + 0.02, headT + 0.08, t);
      albedo = mix(albedo, cHead * 0.45, uPat2.y * cheek);
      albedo = mix(albedo, cHead * 0.6, uPat2.y * 0.6 * smoothstep(0.2, 0.8, ca));
      // Bare skin (vultures) from the beak back.
      float bare = smoothstep(1.0 - uPat2.z * 1.4 - 0.02, 1.0 - uPat2.z * 1.4 + 0.02, (t - headT) / (1.0 - headT));
      albedo = mix(albedo, cSkin, bare);
      // Crown patch (crane).
      float crown = uPat2.w * smoothstep(0.35, 0.75, ca) * smoothstep(0.55, 0.7, (t - headT) / (1.0 - headT));
      albedo = mix(albedo, cSkin, crown);
      rough = mix(rough, 0.55, bare);
    } else {
      float nt = t / headT;
      vec3 under = mix(cBelly, cBreast, smoothstep(0.35, 0.75, nt));
      under = mix(under, cThroat, smoothstep(0.85, 1.0, nt));
      vec3 dors = mix(cBack, cHead, smoothstep(0.82, 1.0, nt));
      albedo = mix(dors, under, ventral);
      // Belly band: streaky dark band across the belly (red-tailed hawk).
      float band = uPat0.x * ventral * smoothstep(0.2, 0.32, nt) * smoothstep(0.58, 0.45, nt);
      float streak = smoothstep(0.35, 0.75, vnoise(vec2(a * 70.0, nt * 9.0)));
      albedo = mix(albedo, cBack * 0.8, band * streak);
      // Fine horizontal barring on the underparts.
      float bar = smoothstep(0.55, 0.85, sin(nt * 120.0 + vnoise(vec2(a * 40.0, nt * 30.0)) * 3.0));
      albedo = mix(albedo, albedo * 0.45, uPat0.y * ventral * bar * smoothstep(0.1, 0.3, nt));
      // Pale rump patch.
      float rump = uPat1.w * smoothstep(0.15, 0.05, nt) * (1.0 - ventral);
      albedo = mix(albedo, cBelly, rump);
      float fr = featherFringe(vec2(a * 8.0, nt * 2.2), 4.0);
      albedo *= 1.0 + (uPat2.x * 0.5) * (fr - 0.3) * (1.0 - ventral);
    }
  } else if (vPart == 1 || vPart == 2) {
    float s = uv.x;
    float c = uv.y;
    bool top = vPart == 1;
    // Feather lines: secondaries across the arm, primaries fanning in the hand.
    float nFeather = s < 0.5 ? 16.0 : 12.0;
    float fline = fract(s * nFeather * (s < 0.5 ? 1.0 : 1.4) + c * 0.35);
    float edge = smoothstep(0.02, 0.0, fline) + smoothstep(0.94, 1.0, fline);
    float flight = smoothstep(0.38, 0.5, c);
    float hand = smoothstep(0.45, 0.58, s);
    // Scalloped trailing edge: each flight feather ends in a rounded tip.
    if (s < uPat3.z - 0.01) {
      float ff = fract(s * nFeather * (s < 0.5 ? 1.0 : 1.4));
      float tip = 0.955 + 0.045 * sqrt(max(0.0, 1.0 - pow(2.0 * ff - 1.0, 2.0)));
      if (c > tip) discard;
    }
    if (top) {
      vec3 flt = mix(cSecondaries, cPrimaries, hand);
      albedo = mix(cCoverts, flt, flight);
      float covs = featherFringe(vec2(s * 10.0, c * 3.0), 2.0) * (1.0 - flight);
      albedo *= 1.0 + uPat2.x * 0.7 * (covs - 0.35);
      // Carpal patch (black shoulder of the kite).
      float carpal = uPat1.z * smoothstep(0.08, 0.15, s) * smoothstep(0.48, 0.38, s) * smoothstep(0.5, 0.35, c);
      albedo = mix(albedo, vec3(0.02), carpal);
      // Pale primary panel.
      float panel = uPat3.x * smoothstep(0.5, 0.6, c) * smoothstep(0.85, 0.7, c) * smoothstep(0.3, 0.4, s) * smoothstep(0.85, 0.7, s);
      albedo = mix(albedo, vec3(0.85), panel);
    } else {
      albedo = mix(cUnderCoverts, cUnderFlight, flight);
      // Dark patagial bar along the leading edge of the inner wing.
      float pat = uPat1.y * smoothstep(0.18, 0.06, c) * smoothstep(0.02, 0.08, s) * smoothstep(0.5, 0.4, s);
      albedo = mix(albedo, cBack * 0.7, pat);
      // Dark carpal comma at the wrist.
      float comma = uPat1.y * smoothstep(0.06, 0.0, length(vec2((s - 0.5) * 2.2, c - 0.3)) - 0.03);
      albedo = mix(albedo, cBack * 0.5, comma);
      float carpal = uPat1.z * smoothstep(0.06, 0.0, length(vec2((s - 0.5) * 2.0, c - 0.25)) - 0.04);
      albedo = mix(albedo, vec3(0.03), carpal);
      // Barred flight feathers.
      float bars = smoothstep(0.6, 0.9, sin(c * 50.0 + s * 9.0)) * flight;
      albedo = mix(albedo, albedo * 0.7, uPat0.y * 0.6 * bars);
      thin = flight;
    }
    float tipDark = smoothstep(1.0 - uPat0.w - 0.04, 1.0 - uPat0.w + 0.04, s);
    albedo = mix(albedo, cPrimaries * 0.35 + vec3(0.01), tipDark * (top ? 0.85 : 1.0));
    float trailing = uPat1.x * smoothstep(0.88, 0.97, c);
    albedo = mix(albedo, cPrimaries * 0.4, trailing);
    albedo *= 1.0 - edge * 0.18 * flight;
    if (top) thin = flight * 0.6;
    rough = 0.7;
    sheen = 0.35;
  } else if (vPart == 3 || vPart == 4) {
    float r = uv.y;
    float x = uv.x * 2.0 - 1.0;
    albedo = vPart == 3 ? cTail : cTailUnder;
    float bands = uPat0.z;
    if (bands > 0.5 && bands < 1.5) {
      // Single dark subterminal band (adult red-tail).
      float b = smoothstep(0.84, 0.87, r) * smoothstep(0.93, 0.9, r);
      albedo = mix(albedo, cTailBand, b * (vPart == 3 ? 1.0 : 0.6));
    } else if (bands >= 1.5) {
      float b = smoothstep(0.35, 0.65, sin(r * bands * 6.2831853 + 1.2));
      albedo = mix(albedo, cTailBand, b * smoothstep(0.08, 0.2, r) * (vPart == 3 ? 1.0 : 0.7));
    }
    float rect = fract((x * 0.5 + 0.5) * 12.0);
    if (r > 0.95 + 0.05 * sqrt(max(0.0, 1.0 - pow(2.0 * rect - 1.0, 2.0)))) discard;
    albedo *= 1.0 - 0.12 * (smoothstep(0.03, 0.0, rect) + smoothstep(0.97, 1.0, rect));
    thin = 0.5;
    rough = 0.72;
  } else if (vPart == 5) {
    albedo = mix(cCere, cBeak, smoothstep(0.18, 0.3, uv.x));
    rough = 0.35;
    sheen = 0.0;
  } else if (vPart == 6) {
    albedo = cLegs;
    rough = 0.6;
    sheen = 0.0;
  } else {
    // Eye: iris colour with a dark pupil and a wet specular highlight.
    albedo = mix(cEye, vec3(0.005), smoothstep(0.32, 0.25, length(vec2(fract(uv.x * 2.0) - 0.5, uv.y - 0.5))));
    rough = 0.08;
    sheen = 0.0;
  }

  float shadow = shadowAt(vWorld, 0.0015);
  float ao = 0.85;
  if (vPart == 0) ao = mix(0.55, 1.0, smoothstep(-0.8, 0.6, n.y));
  vec3 col = shadeSurface(albedo, n, vWorld, ao, rough, shadow);
  // Feather sheen: soft grazing back-scatter.
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += albedo * sheen * fres * (sunRadiance(vWorld.y) * shadow * max(uSunDir.y + 0.15, 0.0) * 0.12 + skyAmbient(n, 1.0) * 0.08);
  // Translucent flight feathers glow when back-lit by the sun.
  if (thin > 0.0) {
    float back = max(dot(-n, uSunDir), 0.0) * max(dot(-V, uSunDir), 0.0);
    vec3 trans = albedo * mix(vec3(1.0), albedo * 1.8, 0.5) * sunRadiance(vWorld.y) * shadow;
    col += trans * thin * (pow(back, 2.0) * 0.6 + max(dot(-n, uSunDir), 0.0) * 0.08);
  }
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

/** Palette hexes are as-photographed colours; lift darks into plausible albedo. */
function lin(hex: string): THREE.Color {
  const c = new THREE.Color(hex); // ColorManagement already decodes sRGB to linear
  return c.setRGB(Math.pow(c.r, 0.92) * 0.85, Math.pow(c.g, 0.92) * 0.85, Math.pow(c.b, 0.92) * 0.85);
}

const COLOR_KEYS = [
  ['cHead', 'head'],
  ['cThroat', 'throat'],
  ['cBreast', 'breast'],
  ['cBelly', 'belly'],
  ['cBack', 'back'],
  ['cCoverts', 'coverts'],
  ['cSecondaries', 'secondaries'],
  ['cPrimaries', 'primaries'],
  ['cUnderCoverts', 'underCoverts'],
  ['cUnderFlight', 'underFlight'],
  ['cTail', 'tail'],
  ['cTailUnder', 'tailUnder'],
  ['cBeak', 'beak'],
  ['cCere', 'cere'],
  ['cLegs', 'legs'],
  ['cEye', 'eye'],
  ['cSkin', 'skin'],
] as const;

export function createBirdMaterial(): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    ...G,
    uPat0: { value: new THREE.Vector4() },
    uPat1: { value: new THREE.Vector4() },
    uPat2: { value: new THREE.Vector4() },
    uPat3: { value: new THREE.Vector4() },
    uFade: { value: 1 },
    cTailBand: { value: new THREE.Color() },
  };
  for (const [u] of COLOR_KEYS) uniforms[u] = { value: new THREE.Color() };
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    side: THREE.DoubleSide,
  });
}

/** Writes a palette (sRGB hex) into the material's linear colour uniforms. */
export function applyPalette(mat: THREE.ShaderMaterial, p: Palette, headT: number, fingerStart: number) {
  const u = mat.uniforms;
  for (const [key, field] of COLOR_KEYS) (u[key].value as THREE.Color).copy(lin(p[field] as string));
  (u.cTailBand.value as THREE.Color).copy(lin(p.tailBandColor ?? p.back));
  (u.uPat0.value as THREE.Vector4).set(p.bellyBand ?? 0, p.barring ?? 0, p.tailBands ?? 0, p.wingtipDark ?? 0);
  (u.uPat1.value as THREE.Vector4).set(p.trailingEdge ?? 0, p.patagial ?? 0, p.carpal ?? 0, p.rump ?? 0);
  (u.uPat2.value as THREE.Vector4).set(p.mottle ?? 0, p.helmet ?? 0, p.skinHead ?? 0, p.crown ?? 0);
  (u.uPat3.value as THREE.Vector4).set(p.wingPanel ?? 0, headT, fingerStart, 1);
}
