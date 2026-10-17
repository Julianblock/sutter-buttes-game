import { lightingCommon } from './lighting';
import { noiseCommon } from './noise';
import { terrainCommon } from './terrainCommon';

export const grassVertex = /* glsl */ `
${terrainCommon}
${noiseCommon}
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uWind;
uniform sampler2D uImgInner;
uniform sampler2D uImgMid;
uniform sampler2D uMaskA;
uniform float uLcSize;
uniform vec4 uVeg;
uniform vec2 uOrigin;     // grid origin, snapped to the cell size
uniform float uSpacing;   // cell size (m)
uniform float uN;         // cells per side
uniform vec2 uFadeIn;     // density ramps up between these distances
uniform vec2 uFadeOut;    // and back down between these
uniform float uGrassH;    // seasonal sward height (m)
in float aBlade;          // blade index within the clump
out vec3 vWorld;
out vec3 vColor;
out vec3 vNormal;
out float vY;
out float vFlower;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vWorld = vec3(0.0); vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); vY = 0.0; vFlower = 0.0;
}

void main() {
  int id = gl_InstanceID;
  int n = int(uN);
  vec2 cell = vec2(float(id % n), float(id / n));
  vec2 cc = uOrigin + (cell - uN * 0.5) * uSpacing;
  float r0 = h21(cc * 0.173 + 1.7);
  float r1 = h21(cc * 0.311 + 9.2);
  vec2 centre = cc + (vec2(r0, r1) - 0.5) * uSpacing;
  float d = distance(centre, uCamPos.xz);
  float keep = smoothstep(uFadeIn.x, uFadeIn.y, d) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, d));
  if (h21(cc * 0.07 + 3.3) > keep) { collapse(); return; }

  // Habitat: open natural grassland only (no canopy, rock, crops or water).
  vec2 lcUV = centre / uLcSize + 0.5;
  vec4 mA = texture(uMaskA, lcUV);
  float hC = terrainHeight(centre);
  float natural = max(mA.b, smoothstep(30.0, 60.0, hC) * regionWeight(uRegionSize.x, centre));
  vec3 photo = textureLod(uImgInner, regionUV(centre, uRegionSize.x), 0.0).rgb;
  float wIn = regionWeight(uRegionSize.x, centre);
  if (wIn < 1.0) photo = mix(textureLod(uImgMid, regionUV(centre, uRegionSize.y), 0.0).rgb, photo, wIn);
  vec3 alb = photo * 0.62;
  float l = luma(alb);
  float canopy = smoothstep(0.07, 0.04, l);
  vec3 nrm = terrainNormal(centre, 4.0);
  float rocky = smoothstep(0.35, 0.55, 1.0 - nrm.y);
  float density = natural * (1.0 - canopy) * (1.0 - rocky) * (1.0 - mA.r) * (1.0 - mA.a) * (1.0 - mA.g);
  float patchy = vnoise(centre / 7.0) * 0.6 + vnoise(centre / 1.9) * 0.4;
  if (density < 0.35 + 0.4 * patchy * (1.0 - density)) { collapse(); return; }

  // Same seasonal recolour the terrain applies to the orthophoto.
  float dryness = clamp(((alb.r - alb.b) / max(l, 0.01) - 0.25) * 2.5, 0.0, 1.0);
  vec3 lush = mix(vec3(0.050, 0.092, 0.020), vec3(0.090, 0.135, 0.030), vnoise(centre / 38.0)) * (0.75 + 2.2 * l);
  float aspectWet = clamp(-nrm.z * 0.6, 0.0, 0.4);
  float green = clamp(uVeg.x + aspectWet * (1.0 - uVeg.x) * 0.6, 0.0, 1.0);
  vec3 base = mix(alb, lush, green * dryness);

  // Blade.
  float b = aBlade;
  float rb0 = h21(cc + b * 7.13);
  float rb1 = h21(cc * 1.7 + b * 3.71);
  float rb2 = h21(cc * 2.3 + b * 5.29);
  float ang = rb0 * 6.2832;
  vec2 root = centre + vec2(cos(ang), sin(ang)) * sqrt(rb1) * uSpacing * 0.55;
  float grazed = mix(0.55, 1.0, smoothstep(0.3, 0.7, vnoise(root / 23.0 + 5.0)));
  float height = uGrassH * grazed * (0.55 + 0.9 * rb2) * mix(1.0, 1.6, step(1.0, uSpacing));
  float width = 0.012 * max(uSpacing / 0.45, 1.0) * (0.7 + 0.6 * rb1);
  float face = rb2 * 6.2832;
  vec3 across = vec3(cos(face), 0.0, sin(face));
  vec3 bendDir = normalize(vec3(cos(ang + 0.6), 0.0, sin(ang + 0.6)));

  float y = position.y;
  vec2 wind = uWind;
  float ws = length(wind);
  vec2 wdir = ws > 0.01 ? wind / ws : vec2(1.0, 0.0);
  float gust = vnoise(root * 0.08 - wind * uTime * 0.12);
  float sway = (0.25 + 0.1 * ws) * (0.4 + gust) + 0.08 * sin(uTime * (2.0 + rb0) + dot(root, wdir) * 0.7);
  sway = min(sway, 1.2);
  vec3 lean = bendDir * (0.25 + 0.35 * rb1) + vec3(wdir.x, 0.0, wdir.y) * sway;
  vec3 p = vec3(root.x, terrainHeight(root), root.y);
  p += across * position.x * width;
  p += lean * height * y * y;
  p.y += height * y * (1.0 - 0.25 * dot(lean, lean) * y);

  vWorld = p;
  vY = y;
  vec3 bladeN = normalize(cross(across, normalize(lean * 2.0 * y + vec3(0.0, 1.0, 0.0))));
  vNormal = bladeN;
  // Individual blades vary in tone; tips bleach.
  vec3 col = base * (0.7 + 0.6 * rb0);
  col = mix(col, col * vec3(1.25, 1.18, 0.95) + vec3(0.02, 0.018, 0.008), y * (0.4 + 0.6 * (1.0 - green)));
  vColor = col;
  // Spring wildflowers: poppy, lupine, goldfields drifts.
  float drift = smoothstep(0.55, 0.75, fbm(root / 60.0 + 3.1, 3));
  vFlower = step(b, 1.5) * step(0.4, uVeg.z * drift + rb1 * 0.3) * step(0.82, y);

  vec2 dc = p.xz - uCamPos.xz;
  p.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const grassFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vColor;
in vec3 vNormal;
in float vY;
in float vFlower;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  // Blades scatter light like a canopy: bias normals upward.
  n = normalize(n + vec3(0.0, 0.9, 0.0));
  vec3 alb = vColor;
  if (vFlower > 0.5) {
    float k = hash12(floor(vWorld.xz * 3.0));
    alb = k < 0.5 ? vec3(0.70, 0.22, 0.02) : k < 0.8 ? vec3(0.22, 0.13, 0.45) : vec3(0.65, 0.52, 0.04);
  }
  float shadow = shadowAt(vWorld + vec3(0.0, 0.3, 0.0), 0.0012);
  float ao = mix(0.3, 1.0, vY);
  vec3 col = shadeSurface(alb, n, vWorld, ao, 0.8, shadow);
  // Light through thin blades when looking toward the sun.
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += alb * sunRadiance(vWorld.y) * back * shadow * 0.25 * vY;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
