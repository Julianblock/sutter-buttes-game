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
  MIRROR: 9,
  DASH: 10, // dash top and steering wheel grips: dark, low sheen
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
uniform float uLampOn;
uniform float uBrake;
uniform float uSpeedFrac;
uniform float uRpmFrac;
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
    // Tan seat cloth and door cards.
    float g = vnoise3(vLocal * 160.0) * 0.6 + vnoise3(vLocal * 37.0) * 0.4;
    alb = vec3(0.2, 0.15, 0.1) * (0.85 + 0.3 * g);
    rough = 0.9;
  } else if (part == 9) {
    // Mirror glass: sky above the horizon, dark land below.
    vec3 R = reflect(-V, n);
    vec3 sky = skyRadianceDir(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
    vec3 land = skyAmbient(vec3(0.0, 1.0, 0.0), 1.0) * vec3(0.12, 0.11, 0.07) + sunRadiance(vWorld.y) * max(uSunDir.y, 0.0) * vec3(0.05, 0.045, 0.03);
    vec3 col = mix(land, sky, smoothstep(-0.03, 0.03, R.y)) * 0.85;
    outColor = vec4(applyAtmosphere(col, vWorld), 1.0);
    return;
  } else if (part == 10) {
    float g = vnoise3(vLocal * 140.0);
    alb = vec3(0.04, 0.038, 0.036) * (0.9 + 0.2 * g);
    rough = 0.5;
    coat = 0.1;
  } else if (part == 4) {
    alb = vec3(0.6);
    rough = 0.1;
    coat = 1.0;
    emit = vec3(1.0, 0.92, 0.78) * uLampOn * 6.0;
  } else if (part == 5) {
    alb = vec3(0.25, 0.01, 0.01);
    rough = 0.15;
    coat = 0.8;
    emit = vec3(1.0, 0.03, 0.01) * (uLampOn * 0.8 + uBrake * 3.0);
  } else if (part == 6) {
    alb = vec3(0.02);
    rough = 0.9;
  } else if (part == 7) {
    alb = vec3(0.16, 0.155, 0.145);
    rough = 0.9;
  } else {
    alb = vec3(0.02);
    rough = 0.3;
    // Speedometer and tachometer: ticks, needle, faint backlight.
    float glow = 0.04;
    for (int i = 0; i < 2; i++) {
      vec2 d = vLocal.zy - vec2(i == 0 ? -0.5 : -0.34, 1.09);
      float r = length(d);
      float a = atan(d.x, d.y);
      float tick = step(fract((a + 2.3) / 4.6 * 12.0 + 0.04), 0.1) * step(abs(a), 2.35);
      glow += tick * smoothstep(0.034, 0.036, r) * smoothstep(0.046, 0.044, r) * 0.8;
      float ang = mix(-2.3, 2.3, i == 0 ? uSpeedFrac : uRpmFrac);
      vec2 dir = vec2(sin(ang), cos(ang));
      float t = clamp(dot(d, dir), 0.0, 0.038);
      float nd = length(d - dir * t);
      glow += smoothstep(0.0028, 0.0012, nd) * 3.0;
      glow += smoothstep(0.047, 0.045, r) * 0.05;
    }
    emit = vec3(1.0, 0.5, 0.18) * glow;
  }
  float shadow = shadowAt(vWorld + n * 0.05, 0.0006);
  float ao = inside ? 0.5 : 1.0;
  vec3 col = shadeSurface(alb, n, vWorld, ao, rough, shadow);
  if (part == 3 || part == 7 || part == 8 || part == 10 || inside) {
    // Light bouncing into the cab through the glass.
    float sunUp = smoothstep(-0.03, 0.05, uSunDir.y);
    vec3 fill = skyAmbient(vec3(0.0, 1.0, 0.0), 1.0) * 0.5 + sunRadiance(vWorld.y) * max(uSunDir.y, 0.04) * 0.15 * sunUp;
    col += alb * fill * (0.55 + 0.45 * max(n.y, 0.0));
  }
  if (coat > 0.0) {
    // Clear coat: mirror the sky, occluded where the body faces down.
    vec3 R = reflect(-V, n);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 env = skyRadianceDir(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
    env *= mix(0.25, 1.0, smoothstep(-0.2, 0.3, R.y));
    col += env * F * coat;
    col += sunRadiance(vWorld.y) * shadow * pow(max(dot(R, uSunDir), 0.0), 600.0) * 30.0 * F * coat * smoothstep(-0.02, 0.03, uSunDir.y);
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
  vec3 sun = sunRadiance(vWorld.y) * shadow * pow(max(dot(R, uSunDir), 0.0), 900.0) * 40.0 * smoothstep(-0.02, 0.03, uSunDir.y);
  vec3 refl = (env + sun) * F;
  // Premultiplied: reflections add, the tint absorbs some of what's behind.
  float absorb = inside ? 0.06 : 0.28;
  vec3 col = refl * (inside ? 0.35 : 1.0);
  col *= segmentTransmittance(vWorld);
  outColor = vec4(col, absorb);
}
`;
