import { lightingCommon } from './lighting';

/** Headstones, iron fencing, gate pillars and signs, baked into world space. */
export const cemeteryVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in float aPart;   // 0 stone, 1 inscribed stone face, 2 iron, 3 concrete, 4 sign face, 5 wood
in vec3 aTint;
in float aSeed;   // fract: random; integer part 1 = pioneer-era stone
in vec2 aUv;      // stones: across, up (0..1); signs: atlas uv
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
flat out float vPart;
flat out vec3 vTint;
flat out float vSeed;

void main() {
  vec3 world = position;
  vWorld = world;
  vNormal = normal;
  vUv = aUv;
  vPart = aPart;
  vTint = aTint;
  vSeed = aSeed;
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

export const cemeteryFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform sampler2D uSignTex;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
flat in float vPart;
flat in vec3 vTint;
flat in float vSeed;
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

// Rows of chiselled lettering: a name, the dates, a short epitaph.
float inscription(vec2 uv, float seed) {
  float ink = 0.0;
  for (int r = 0; r < 4; r++) {
    float fr = float(r);
    float y = (r == 0 ? 0.74 : r == 1 ? 0.63 : 0.5 - (fr - 2.0) * 0.07);
    float hgt = r == 0 ? 0.055 : 0.032;
    float hw = r == 0 ? 0.3 : r == 1 ? 0.22 : 0.26 - fract(seed * (7.0 + fr)) * 0.12;
    if (abs(uv.y - y) > hgt || abs(uv.x - 0.5) > hw) continue;
    float cells = r == 0 ? 14.0 : 22.0;
    float cx = (uv.x - 0.5 + hw) / (2.0 * hw) * cells;
    vec2 id = vec2(floor(cx), fr + seed * 13.0);
    vec2 f = vec2(fract(cx), (uv.y - y + hgt) / (2.0 * hgt));
    // A crude glyph: a few vertical and horizontal strokes per letter cell.
    float h1 = hash12(id), h2 = hash12(id + 5.3), h3 = hash12(id + 9.1);
    float stroke = 0.0;
    stroke = max(stroke, step(abs(f.x - 0.2), 0.08) * step(0.3, h1));
    stroke = max(stroke, step(abs(f.x - 0.75), 0.08) * step(0.5, h2));
    stroke = max(stroke, step(abs(f.y - 0.85), 0.09) * step(0.45, h3) * step(f.x, 0.85));
    stroke = max(stroke, step(abs(f.y - 0.15), 0.09) * step(0.6, h1 + h2 * 0.3) * step(f.x, 0.85));
    stroke = max(stroke, step(abs(f.y - 0.5), 0.08) * step(0.7, h3) * step(f.x, 0.85));
    stroke *= step(0.12, f.y) * step(f.y, 0.9) * step(f.x, 0.88) * step(0.08, hash12(id + 2.2));
    ink = max(ink, stroke);
  }
  return ink;
}

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
  outColor = vec4(vShadowZ, 0.0, 0.0, 1.0);
  return;
#endif
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  int part = int(vPart + 0.5);
  float old = floor(vSeed);
  float rnd = fract(vSeed);
  vec3 wp = vWorld;
  vec3 alb = vTint * 0.8;
  float rough = 0.75;
  float ao = 1.0;
  float porosity = 0.6;

  if (part <= 1) {
    // Stone: marble and sandstone sugar and stain with age; granite stays polished.
    float grain = vnoise(wp.xz * 37.0 + wp.y * 41.0) * 0.6 + vnoise(wp.xz * 9.0 + wp.y * 11.0) * 0.4;
    alb *= 0.88 + 0.24 * grain;
    rough = mix(0.22, 0.7, old);
    porosity = mix(0.15, 0.75, old);
    // Rain streaks running down from the top edge.
    float streak = vnoise(vec2(dot(wp.xz, vec2(9.0, 7.0)), wp.y * 0.7 + rnd * 9.0));
    alb *= 1.0 - old * 0.3 * smoothstep(0.45, 0.9, streak) * smoothstep(0.3, 1.0, vUv.y);
    // Lichen crust: rosettes of grey-green and orange on tops and the shady north side.
    float face = max(n.y, 0.0) + max(-n.z, 0.0) * 0.6 + 0.25;
    float lp = vnoise(wp.xz * 7.0 + wp.y * 6.0 + rnd * 17.0);
    float lichen = smoothstep(0.58, 0.72, lp) * face * mix(0.15, 1.0, old);
    vec3 lc = mix(vec3(0.42, 0.44, 0.34), vec3(0.62, 0.42, 0.14), step(0.82, vnoise(wp.xz * 3.0 + wp.y * 2.0 + 4.0)));
    alb = mix(alb, lc, clamp(lichen, 0.0, 0.85));
    // Soil splash and moss creeping up from the ground.
    float grime = 1.0 - smoothstep(0.0, 0.22, vUv.y);
    alb = mix(alb, vec3(0.13, 0.12, 0.08), grime * mix(0.25, 0.6, old));
    ao *= 1.0 - grime * 0.3;
    rough = mix(rough, 0.9, max(lichen, grime) * 0.8);
    if (part == 1) {
      float ink = inscription(vUv, rnd);
      // Old letters weather to shallow grooves; new ones are cut dark and crisp.
      float fade = mix(1.0, 0.35 + 0.4 * vnoise(vUv * 30.0 + rnd * 5.0), old);
      alb *= 1.0 - ink * fade * mix(0.7, 0.4, old);
      ao *= 1.0 - ink * 0.35 * fade;
    }
  } else if (part == 2) {
    // Wrought iron: flaking black paint over rust.
    float rust = smoothstep(0.45, 0.75, vnoise(wp.xz * 5.0 + wp.y * 9.0));
    alb = mix(vec3(0.03, 0.03, 0.03), vec3(0.2, 0.085, 0.035), rust);
    rough = mix(0.45, 0.9, rust);
    porosity = 0.2;
  } else if (part == 3) {
    alb *= 0.85 + 0.25 * vnoise(wp.xz * 13.0 + wp.y * 17.0);
    float moss = smoothstep(0.55, 0.8, vnoise(wp.xz * 4.0 + wp.y * 3.0)) * (0.4 + 0.6 * max(n.y, 0.0));
    alb = mix(alb, vec3(0.16, 0.18, 0.08), moss * 0.7);
    rough = 0.9;
  } else if (part == 4) {
    vec3 t = texture(uSignTex, vUv).rgb;
    alb = t * t * 0.8;
    rough = 0.55;
    porosity = 0.1;
  } else {
    // Sun-greyed redwood posts and boards.
    float g = vnoise(vec2(wp.x * 2.0 + wp.z * 2.0, wp.y * 30.0));
    alb = vec3(0.29, 0.26, 0.22) * (0.8 + 0.35 * g);
    rough = 0.9;
  }

  alb = wetten(alb, porosity);
  rough = mix(rough, rough * 0.4, uWet);
  float snow = snowAmount(n, wp.xz, wp.y);
  alb = mix(alb, SNOW_ALB, smoothstep(0.1, 0.5, snow) * step(0.3, n.y));

  float shadow = shadowAt(wp + n * 0.05, 0.0008);
  vec3 col = shadeSurface(alb, n, wp, ao, rough, shadow);
  col = applyAtmosphere(col, wp);
  outColor = vec4(col, 1.0);
}
`;
