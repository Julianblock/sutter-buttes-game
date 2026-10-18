import { lightingCommon } from '../render/shaders/lighting';

/** Material ids baked into the `aPart` attribute of the player vehicle. */
export const CAR_PART = {
  PAINT: 0,
  TRIM: 1, // black plastic, grille, bumpers
  CHROME: 2,
  INTERIOR: 3, // dash, seats, console
  HEADLIGHT: 4,
  TAILLIGHT: 5,
  TIRE: 6,
  HEADLINER: 7,
  GAUGES: 8,
} as const;

export const carVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in float aPart;
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
flat out float vPart;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  vPart = aPart;
#ifdef SHADOW_PASS
  vShadowZ = (uShadowMatrix * w).z;
#else
  vec2 dc = w.xz - uCamPos.xz;
  w.y -= dot(dc, dc) / (2.0 * 7310000.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

export const carFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform vec3 uPaint;
uniform float uHeadOn;
uniform float uBrake;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
flat in float vPart;
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
  outColor = vec4(vShadowZ, 0.0, 0.0, 1.0);
  return;
#endif
  int part = int(vPart + 0.5);
  vec3 n = normalize(vNormal);
  bool inside = !gl_FrontFacing;
  if (inside) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 alb = vec3(0.04);
  float rough = 0.8;
  float coat = 0.0;
  vec3 emit = vec3(0.0);
  if (part == 0) {
    if (inside) {
      // Inside of the body shell: door cards and kick panels.
      alb = vec3(0.045, 0.043, 0.04);
    } else {
      alb = uPaint;
      rough = 0.35;
      coat = 1.0;
    }
  } else if (part == 1) {
    alb = vec3(0.025);
    rough = 0.55;
  } else if (part == 2) {
    alb = vec3(0.55, 0.56, 0.58);
    rough = 0.18;
    coat = 0.6;
  } else if (part == 3) {
    // Grained dash plastic and seat cloth.
    float g = vnoise(vLocal.xz * 60.0) * 0.5 + vnoise(vLocal.yz * 23.0) * 0.5;
    alb = vec3(0.055, 0.05, 0.047) * (0.85 + 0.3 * g);
    rough = 0.85;
  } else if (part == 4) {
    alb = vec3(0.6);
    rough = 0.1;
    coat = 1.0;
    emit = vec3(1.0, 0.92, 0.78) * uHeadOn * 6.0;
  } else if (part == 5) {
    alb = vec3(0.25, 0.01, 0.01);
    rough = 0.15;
    coat = 0.8;
    emit = vec3(1.0, 0.03, 0.01) * (uHeadOn * 0.8 + uBrake * 3.0);
  } else if (part == 6) {
    alb = vec3(0.02);
    rough = 0.9;
  } else if (part == 7) {
    alb = vec3(0.16, 0.155, 0.145);
    rough = 0.9;
  } else {
    alb = vec3(0.02);
    emit = vec3(1.0, 0.55, 0.2) * 0.25;
  }
  float shadow = shadowAt(vWorld + n * 0.05, 0.0006);
  float ao = inside ? 0.5 : 1.0;
  vec3 col = shadeSurface(alb, n, vWorld, ao, rough, shadow);
  if (coat > 0.0) {
    // Clear coat: mirror the sky, occluded where the body faces down.
    vec3 R = reflect(-V, n);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 env = skyRadianceDir(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
    env *= mix(0.25, 1.0, smoothstep(-0.2, 0.3, R.y));
    col += env * F * coat;
    col += sunRadiance(vWorld.y) * shadow * pow(max(dot(R, uSunDir), 0.0), 600.0) * 30.0 * F * coat;
  }
  col += emit * uInvExposure * mix(0.15, 1.0, uNight);
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

export const glassFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
flat in float vPart;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  bool inside = !gl_FrontFacing;
  if (inside) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 R = reflect(-V, n);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 env = skyRadianceDir(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
  float shadow = shadowAt(vWorld, 0.0006);
  vec3 sun = sunRadiance(vWorld.y) * shadow * pow(max(dot(R, uSunDir), 0.0), 900.0) * 40.0;
  vec3 col = (env + sun) * F;
  // Seen from the cabin the glass only faintly reflects the dash and sky.
  float a = inside ? clamp(F * 0.6, 0.02, 0.25) : clamp(0.35 + F, 0.0, 0.95);
  col = mix(col, vec3(0.004, 0.006, 0.007), inside ? 0.0 : 0.4);
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col / max(a, 0.02) * (inside ? 1.0 : 0.6), a);
}
`;
