import { lightingCommon } from './lighting';

/** Instanced buildings, silos and towers. */
export const propVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in float aPart;    // 0 wall, 1 roof, 2 metal
in vec4 aT0;       // x, y, z, angle
in vec4 aT1;       // sx, sy, sz, kind (0 house, 1 shed, 2 silo, 3 tower, 4 hut)
in vec4 aWall;     // rgb, lit
in vec4 aRoof;     // rgb, seed
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec3 vScale;
out vec3 vLocalN;
flat out float vPart;
flat out vec4 vWall;
flat out vec4 vRoof;
flat out float vKind;

void main() {
  vec3 p = position * aT1.xyz;
  vec3 n = normalize(normal / aT1.xyz);
  float c = cos(aT0.w), s = sin(aT0.w);
  mat2 R = mat2(c, s, -s, c);
  p.xz = R * p.xz;
  n.xz = R * n.xz;
  vec3 world = aT0.xyz + p;
  vWorld = world;
  vNormal = n;
  vLocal = position;
  vScale = aT1.xyz;
  vLocalN = normal;
  vPart = aPart;
  vWall = aWall;
  vRoof = aRoof;
  vKind = aT1.w;
#ifdef SHADOW_PASS
  vShadowZ = (uShadowMatrix * vec4(world, 1.0)).z;
#else
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const propFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec3 vScale;
in vec3 vLocalN;
flat in float vPart;
flat in vec4 vWall;
flat in vec4 vRoof;
flat in float vKind;
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
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  // Palette colours are display-referred; real stucco and paint sit near 0.4.
  vec3 albedo = (vPart > 0.5 ? vRoof.rgb : vWall.rgb) * 0.55;
  float rough = 0.85;
  vec3 emit = vec3(0.0);
  float kind = vKind;
  if (vPart > 1.5) {
    albedo = vec3(0.55, 0.56, 0.58);
    rough = 0.35;
  } else if (vPart > 0.5) {
    // Roof: corrugated metal on sheds and silos, shingles elsewhere.
    bool metal = kind > 0.5 && kind < 2.5;
    rough = metal ? 0.38 : 0.8;
    if (metal) albedo *= 0.9 + 0.1 * sin(vLocal.x * vScale.x * 6.0);
    else albedo *= 0.85 + 0.3 * vnoise(vLocal.xz * vScale.xz * 1.5);
  } else if (abs(n.y) < 0.5 && (kind < 0.5 || kind > 3.5)) {
    // Facade with windows: cells ~3 m wide, one storey high.
    vec3 sc = vLocal * vScale;
    float u = abs(vLocalN.x) > abs(vLocalN.z) ? sc.z : sc.x;
    vec2 cell = vec2(u / 3.2, sc.y / 2.9);
    vec2 f = fract(cell);
    vec2 id = floor(cell);
    bool win = f.x > 0.3 && f.x < 0.72 && f.y > 0.35 && f.y < 0.8 && (id.y + 0.85) * 2.9 < vScale.y * 0.6;
    if (win) {
      albedo = vec3(0.04, 0.05, 0.06);
      rough = 0.3;
      float lit = step(0.68, hash12(id + vRoof.a * 91.0)) * vWall.a;
      vec3 warm = mix(vec3(1.0, 0.42, 0.12), vec3(0.9, 0.62, 0.36), hash12(id + 3.7));
      // TV flicker in a few rooms.
      float tv = step(0.93, hash12(id + 7.1));
      warm = mix(warm, vec3(0.45, 0.6, 1.0) * (0.6 + 0.4 * sin(uTime * 9.0 + id.x * 4.0)), tv);
      emit = warm * warm * lit * uNight * 0.5 * uInvExposure;
      if (lit > 0.5) albedo = vec3(0.0);
    }
  } else if (kind > 1.5 && kind < 2.5) {
    // Silo: ribbed galvanised steel.
    rough = 0.4;
    albedo *= 0.88 + 0.12 * sin(vLocal.y * vScale.y * 3.0);
  }
  float shadow = shadowAt(vWorld + n * 0.3, 0.0012);
  float ao = mix(0.6, 1.0, clamp(vLocal.y * 3.0, 0.0, 1.0));
  vec3 col = shadeSurface(albedo, n, vWorld, ao, rough, shadow) + emit;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
