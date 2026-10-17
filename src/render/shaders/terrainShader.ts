import { lightingCommon } from './lighting';
import { terrainCommon } from './terrainCommon';

export const terrainVertex = /* glsl */ `
${terrainCommon}
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uGridDim;
uniform float uLodK;
in vec4 aNode; // x0, z0, size, level
out vec3 vWorld;

void main() {
  vec2 g = position.xz * uGridDim;
  vec2 xz = aNode.xy + position.xz * aNode.z;
  float h = terrainHeight(xz);
  float dist = distance(uCamPos, vec3(xz.x, h, xz.y));
  float mEnd = 2.0 * aNode.z * uLodK;
  float mStart = mEnd * 0.7;
  float morph = clamp((dist - mStart) / (mEnd - mStart), 0.0, 1.0);
  xz -= fract(g * 0.5) * 2.0 / uGridDim * aNode.z * morph;
  h = terrainHeight(xz);
  vWorld = vec3(xz.x, h, xz.y);
  // Earth curvature with standard atmospheric refraction (k = 0.13).
  vec2 dc = xz - uCamPos.xz;
  vec3 p = vWorld;
  p.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const terrainFragment = /* glsl */ `
${lightingCommon}
${terrainCommon}
#include <logdepthbuf_pars_fragment>
uniform sampler2D uImgInner;
uniform sampler2D uImgMid;
uniform sampler2D uImgFar;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform float uLcSize;
uniform vec4 uVeg;      // grass green, oak leaf-out, wildflowers, wetland flooding
uniform vec4 uRice;     // flooded, sprouting, mature green, golden/harvested
uniform vec4 uOrchard;  // bare, almond blossom, fruit blossom, autumn colour
uniform float uSnowLine;
in vec3 vWorld;
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rippleNormal(vec2 xz, float dist) {
  vec2 w = uWind * uTime;
  float e = 0.35;
  float s = 1.0 / 2.2;
  float a = vnoise((xz + w * 0.6) * s) + 0.5 * vnoise((xz * 2.7 - w) * s);
  float b = vnoise((xz + vec2(e, 0.0) + w * 0.6) * s) + 0.5 * vnoise(((xz + vec2(e, 0.0)) * 2.7 - w) * s);
  float c = vnoise((xz + vec2(0.0, e) + w * 0.6) * s) + 0.5 * vnoise(((xz + vec2(0.0, e)) * 2.7 - w) * s);
  float amp = 0.10 * clamp(1.0 - dist / 3000.0, 0.15, 1.0) * (0.4 + length(uWind) * 0.15);
  return normalize(vec3((a - b) * amp / e, 1.0, (a - c) * amp / e));
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 xz = vWorld.xz;
  vec3 w = regionWeights(xz);
  float dist = length(vWorld - uCamPos);

  float e = terrainTexel(xz);
  vec3 n = terrainNormal(xz, e);
  float ao = terrainSample(xz).y;

  vec3 alb = texture(uImgFar, regionUV(xz, uRegionSize.z)).rgb;
  if (w.y > 0.0) alb = mix(alb, texture(uImgMid, regionUV(xz, uRegionSize.y)).rgb, w.y);
  if (w.x > 0.0) alb = mix(alb, texture(uImgInner, regionUV(xz, uRegionSize.x)).rgb, w.x);
  // Orthophotos are exposed for display; bring them down to physical albedo.
  alb *= 0.62;

  vec2 lcUV = xz / uLcSize + 0.5;
  float inLc = step(0.0, lcUV.x) * step(lcUV.x, 1.0) * step(0.0, lcUV.y) * step(lcUV.y, 1.0);
  vec4 mA = texture(uMaskA, lcUV) * inLc;
  vec4 mB = texture(uMaskB, lcUV) * inLc;

  float l = luma(alb);
  float detailFade = clamp(1.0 - dist / 2500.0, 0.0, 1.0);
  float nA = fbm(xz / 38.0, 4);
  float nB = vnoise(xz / 4.0);

  // --- Natural grassland & oak savanna on the Buttes ---------------------------
  float natural = max(mA.b, smoothstep(30.0, 60.0, vWorld.y) * w.x);
  float dryness = clamp(((alb.r - alb.b) / max(l, 0.01) - 0.25) * 2.5, 0.0, 1.0);
  float canopy = smoothstep(0.075, 0.035, l);
  vec3 lush = mix(vec3(0.050, 0.092, 0.020), vec3(0.090, 0.135, 0.030), nA) * (0.75 + 2.2 * l);
  // North-facing slopes stay greener longer.
  float aspectWet = clamp(-n.z * 0.6, 0.0, 0.4);
  float green = clamp(uVeg.x + aspectWet * (1.0 - uVeg.x) * 0.6, 0.0, 1.0);
  vec3 grass = mix(alb, lush, green * dryness * (1.0 - canopy));
  // Late-season grass goes grey-brown before the first rains.
  grass = mix(grass, grass * vec3(0.92, 0.86, 0.80), uOrchard.w * dryness * (1.0 - green));
  // Bare blue oaks in winter read as grey-brown lace instead of dark crowns.
  vec3 bare = mix(vec3(0.075, 0.066, 0.055), lush, 0.25);
  grass = mix(grass, bare, canopy * (1.0 - uVeg.y) * 0.55 * step(0.5, nB + 0.35));
  // Spring wildflowers: poppies, lupine and goldfields in drifts.
  float flowers = uVeg.z * (1.0 - canopy) * smoothstep(0.55, 0.75, fbm(xz / 60.0 + 3.1, 3));
  vec3 flowerCol = mix(vec3(0.62, 0.24, 0.03), vec3(0.22, 0.14, 0.42), step(0.5, vnoise(xz / 25.0)));
  flowerCol = mix(flowerCol, vec3(0.55, 0.45, 0.05), step(0.72, vnoise(xz / 17.0 + 9.0)));
  grass = mix(grass, flowerCol, flowers * 0.35);
  alb = mix(alb, grass, natural);

  // Andesite / dacite rock on steep crags, rust-red where oxidised.
  float slope = 1.0 - n.y;
  float rocky = smoothstep(0.38, 0.62, slope + (nB - 0.5) * 0.18) * smoothstep(60.0, 140.0, vWorld.y);
  vec3 rock = mix(vec3(0.16, 0.155, 0.15), vec3(0.24, 0.13, 0.08), smoothstep(0.55, 0.8, nA));
  rock *= 0.8 + 0.4 * vnoise(xz / 1.7);
  alb = mix(alb, rock, rocky * 0.75);

  // Snowpack on the Sierra Nevada, Lassen and the Coast Range peaks.
  float snowN = fbm(xz / 3000.0, 4);
  float snow = smoothstep(uSnowLine - 250.0 + snowN * 500.0, uSnowLine + 250.0 + snowN * 500.0, vWorld.y);
  snow *= 1.0 - smoothstep(0.45, 0.75, slope) * 0.7;
  alb = mix(alb, vec3(0.82, 0.85, 0.9), snow);

  // --- Rice ---------------------------------------------------------------------
  float waterFrac = 0.0;
  float rice = mA.r;
  vec3 riceCol = alb;
  vec3 stubble = mix(vec3(0.15, 0.12, 0.07), vec3(0.22, 0.18, 0.10), nB);
  riceCol = mix(riceCol, mix(vec3(0.04, 0.11, 0.025), vec3(0.08, 0.16, 0.035), nA), uRice.z * 0.7);
  riceCol = mix(riceCol, mix(vec3(0.32, 0.25, 0.10), stubble, 0.4), uRice.w);
  riceCol = mix(riceCol, stubble * 0.8, uRice.x);
  riceCol = mix(riceCol, mix(stubble * 0.7, vec3(0.06, 0.13, 0.03), 0.5), uRice.y);
  alb = mix(alb, riceCol, rice);
  float riceWater = uRice.x * smoothstep(0.25, 0.6, vnoise(xz / 9.0) * 0.5 + 0.55) + uRice.y * 0.75;
  waterFrac = max(waterFrac, rice * riceWater);

  // --- Orchards -------------------------------------------------------------------
  float orchard = mA.g;
  vec3 orch = alb;
  orch = mix(orch, mix(vec3(0.12, 0.10, 0.075), alb, 0.3), uOrchard.x * 0.75);
  orch = mix(orch, vec3(0.78, 0.72, 0.74), uOrchard.y * mB.r * 0.8);
  orch = mix(orch, vec3(0.78, 0.50, 0.62), uOrchard.z * mB.g * 0.7);
  orch = mix(orch, vec3(0.33, 0.27, 0.08), uOrchard.w * (1.0 - mB.r) * 0.6);
  alb = mix(alb, orch, orchard);

  // --- Wetlands & open water ------------------------------------------------------
  waterFrac = max(waterFrac, mB.a * uVeg.w * smoothstep(0.3, 0.7, vnoise(xz / 30.0) + 0.3));
  waterFrac = max(waterFrac, mA.a * smoothstep(0.12, 0.05, l + 0.02));
  waterFrac *= smoothstep(0.30, 0.12, slope);

  // Ground detail up close.
  alb *= mix(1.0, 0.82 + 0.36 * vnoise(xz / 2.3) * (0.7 + 0.6 * nB), detailFade);
  vec2 bump = vec2(vnoise(xz / 1.3) - vnoise(xz / 1.3 + vec2(0.6, 0.0)), vnoise(xz / 1.3) - vnoise(xz / 1.3 + vec2(0.0, 0.6)));
  n = normalize(n + vec3(bump.x, 0.0, bump.y) * (0.25 + rocky * 0.6) * detailFade);

  float shadow = shadowAt(vWorld + n * 0.6, 0.0008);
  vec3 color = shadeSurface(alb, n, vWorld, ao, 0.92, shadow);

  if (waterFrac > 0.01) {
    vec3 wn = rippleNormal(xz, dist);
    vec3 V = normalize(uCamPos - vWorld);
    vec3 R = reflect(-V, wn);
    R.y = abs(R.y);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
    vec3 refl = skyRadianceDir(R) * cloudShadow(vWorld + R * 400.0);
    vec3 sun = sunRadiance(vWorld.y) * shadow;
    float glint = pow(max(dot(R, uSunDir), 0.0), 900.0) * 140.0 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.6;
    float glintM = pow(max(dot(R, uMoonDir), 0.0), 700.0) * 90.0;
    vec3 body = vec3(0.020, 0.024, 0.016) * skyAmbient(vec3(0, 1, 0), 1.0) / PI;
    vec3 water = mix(body, refl, F) + sun * glint * F + moonRadiance(vWorld.y) * glintM * F;
    color = mix(color, water, waterFrac);
  }

  color = applyAtmosphere(color, vWorld);
  outColor = vec4(color, 1.0);
}
`;
