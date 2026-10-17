import { lightingCommon } from './lighting';

/** Instanced animals with procedural gait: legs swing about their hips, heads dip to graze. */
export const animalVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in vec3 aColor;
in vec4 aLimb;     // limb id, pivot y, pivot z, phase offset
in vec4 aT0;       // x, y, z, heading
in vec4 aT1;       // scale, gait phase, gait speed (0 idle, 1 walk, 2 run), graze
in vec3 aTint;
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;

vec3 rotX(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  int limb = int(aLimb.x + 0.5);
  float phase = aT1.y;
  float gait = aT1.z;
  vec3 pivot = vec3(0.0, aLimb.y, aLimb.z);
  if (limb >= 1 && limb <= 4) {
    // Walk: diagonal pairs; run: bounding gallop with bigger swing.
    float amp = gait < 0.05 ? 0.0 : mix(0.35, 0.75, clamp(gait - 1.0, 0.0, 1.0));
    float a = sin(phase + aLimb.w) * amp;
    p = rotX(p - pivot, a) + pivot;
    n = rotX(n, a);
  } else if (limb == 5) {
    // Head and neck: lowered to the grass when grazing, slight bob when walking.
    float a = aT1.w * 0.95 - sin(phase * 2.0) * 0.05 * min(gait, 1.0);
    p = rotX(p - pivot, a) + pivot;
    n = rotX(n, a);
  } else if (limb == 6) {
    float a = sin(phase * 0.7 + aT0.x) * 0.25;
    p = rotX(p - pivot, a) + pivot;
  }
  // Body bob at speed.
  p.y += abs(sin(phase)) * 0.04 * gait;
  p *= aT1.x;
  float c = cos(aT0.w), s = sin(aT0.w);
  // Heading 0 faces +z.
  p.xz = mat2(c, -s, s, c) * p.xz;
  n.xz = mat2(c, -s, s, c) * n.xz;
  vec3 world = aT0.xyz + p;
  vWorld = world;
  vNormal = n;
  vColor = aColor * aTint;
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

export const animalFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
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
  float shadow = shadowAt(vWorld + n * 0.1, 0.0012);
  // Fur: soft wrap so the sunlit flank glows and the belly falls off.
  float ao = mix(0.55, 1.0, clamp(n.y * 0.5 + 0.6, 0.0, 1.0));
  vec3 col = shadeSurface(vColor, n, vWorld, ao, 0.95, shadow);
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
