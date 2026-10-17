import { lightingCommon } from './lighting';

export const roadVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in vec2 aRoad;     // across (-1..1 incl. shoulder), along (m)
in vec4 aInfo;     // half width (m), style, rank, normal.x
in float aNz;
out vec3 vWorld;
out vec2 vRoad;
flat out vec3 vInfo;
out vec3 vNormal;

void main() {
  vec3 world = position;
  vWorld = world;
  vRoad = aRoad;
  vInfo = aInfo.xyz;
  vNormal = vec3(aInfo.w, sqrt(max(0.0, 1.0 - aInfo.w * aInfo.w - aNz * aNz)), aNz);
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  // Pull toward the camera along the view ray so depth beats the GPU terrain
  // (whose filtering differs slightly from the CPU heightfield) without moving
  // on screen. The pull emulates a vertical lift that grows with distance as
  // terrain LOD error does; bigger roads win at junctions.
  vec3 toCam = uCamPos - world;
  float d = length(toCam);
  float above = max(toCam.y, 1.0);
  float lift = 0.3 + d * 0.0015 + aInfo.z * 0.03;
  world += toCam / max(d, 1e-3) * min(lift * d / above, d * 0.25);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const roadFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec2 vRoad;
flat in vec3 vInfo;
in vec3 vNormal;
out vec4 outColor;

float band(float x, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x));
}

void main() {
  #include <logdepthbuf_fragment>
  float halfW = vInfo.x;
  int style = int(vInfo.y + 0.5);
  float dist = length(vWorld - uCamPos);
  // Metres from centreline; the outer 15% of the ribbon is gravel shoulder.
  float x = vRoad.x * halfW / 0.85;
  float ax = abs(x);
  float along = vRoad.y;
  float aa = max(fwidth(x), 0.02);

  vec2 p = vWorld.xz;
  float grain = vnoise(p * 3.0) * 0.5 + vnoise(p * 0.7) * 0.5;
  // Asphalt: fresh highways dark, county chip-seal lighter and greyer.
  vec3 asphalt = style >= 3 ? vec3(0.055, 0.056, 0.058) : style == 0 ? vec3(0.12, 0.115, 0.105) : vec3(0.095, 0.093, 0.09);
  asphalt *= 0.85 + 0.3 * grain;
  // Tyre polish in the wheel tracks, oil drip down the lane centres.
  float lane = mod(ax, 3.6);
  asphalt *= 1.0 + 0.08 * band(lane, 0.5, 1.1, 0.3) + 0.08 * band(lane, 2.4, 3.0, 0.3);
  asphalt *= 1.0 - 0.12 * band(lane, 1.5, 2.1, 0.4) * vnoise(vec2(along * 0.3, x));
  vec3 gravel = mix(vec3(0.21, 0.18, 0.14), vec3(0.29, 0.25, 0.19), vnoise(p * 2.1));
  float onRoad = 1.0 - smoothstep(halfW - 0.08, halfW + 0.08, ax);
  vec3 alb = mix(gravel, asphalt, onRoad);

  // US road markings, faded with wear.
  float wear = 0.65 + 0.35 * vnoise(vec2(along * 0.08, x * 0.3));
  vec3 yellow = vec3(0.62, 0.45, 0.07);
  vec3 white = vec3(0.62);
  float dash = step(fract(along / 12.2), 0.25);
  float m = 0.0;
  vec3 mc = white;
  if (style == 4) {
    // One-way carriageway (freeway): dashed lane line, solid edges.
    m = band(ax, 0.0, 0.08, aa) * dash;
    float edgeR = band(x, halfW - 0.45, halfW - 0.3, aa);
    float edgeL = band(-x, halfW - 0.45, halfW - 0.3, aa);
    if (edgeL > 0.0) mc = yellow;
    m = max(m, max(edgeR, edgeL));
  } else if (style >= 2) {
    // Two-lane highway: double yellow, white fog lines.
    float dbl = band(ax, 0.08, 0.2, aa);
    float edge = band(ax, halfW - 0.4, halfW - 0.25, aa);
    if (dbl > 0.0) mc = yellow;
    m = max(dbl, edge);
  } else if (style == 1) {
    // County road: dashed yellow centre.
    m = band(ax, 0.0, 0.11, aa) * dash;
    mc = yellow;
  }
  m *= wear * onRoad * clamp(1.0 - dist / 1500.0, 0.0, 1.0);
  alb = mix(alb, mc, m);

  vec3 n = normalize(vNormal);
  float shadow = shadowAt(vWorld + n * 0.4, 0.0008);
  float rough = mix(0.85, 0.55, m);
  vec3 col = shadeSurface(alb, n, vWorld, 1.0, rough, shadow);
  col = applyAtmosphere(col, vWorld);
  // Fade the ribbon into the orthophoto (which already shows the road) far away.
  float fade = 1.0 - smoothstep(2500.0, 6000.0, dist);
  float edgeFade = 1.0 - smoothstep(0.8, 1.0, abs(vRoad.x));
  outColor = vec4(col, fade * edgeFade);
}
`;
