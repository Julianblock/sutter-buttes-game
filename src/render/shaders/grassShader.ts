import { lightingCommon } from './lighting';
import { noiseCommon } from './noise';
import { terrainCommon } from './terrainCommon';
import { windCommon } from './wind';

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
uniform float uSeedHead;  // 0..1 share of grasses in seed (late spring - summer)
uniform vec4 uCar;        // player truck: x, z, sin(heading), cos(heading); 0 heading vector = none
in float aBlade;          // blade index within the clump
${windCommon}
out vec3 vWorld;
out vec3 vColor;
out vec3 vNormal;
out float vY;
out float vGust;
out float vHead;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void collapse() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vWorld = vec3(0.0); vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); vY = 0.0; vGust = 0.0; vHead = 0.0;
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
  vec2 dCar = centre - uCar.xy;
  if (dot(uCar.zw, uCar.zw) > 0.5 && abs(dot(dCar, uCar.zw)) < 3.1 && abs(dot(dCar, vec2(uCar.w, -uCar.z))) < 1.15) { collapse(); return; }

  // Habitat: open natural grassland only (no canopy, rock, crops or water).
  vec2 lcUV = centre / uLcSize + 0.5;
  vec4 mA = texture(uMaskA, lcUV);
  float hC = terrainHeight(centre);
  float wIn = regionWeight(uRegionSize.x, centre);
  float natural = max(mA.b, smoothstep(30.0, 60.0, hC) * wIn);
  vec3 photo = textureLod(uImgInner, regionUV(centre, uRegionSize.x), 0.0).rgb;
  if (wIn < 1.0) photo = mix(textureLod(uImgMid, regionUV(centre, uRegionSize.y), 0.0).rgb, photo, wIn);
  vec3 alb = photo * 0.62;
  float l = luma(alb);
  float canopy = smoothstep(0.07, 0.04, l);
  vec3 nrm = normalize(vec3(hC - terrainHeight(centre + vec2(4.0, 0.0)), 4.0, hC - terrainHeight(centre + vec2(0.0, 4.0))));
  float rocky = smoothstep(0.35, 0.55, 1.0 - nrm.y);
  float density = natural * (1.0 - canopy) * (1.0 - rocky) * (1.0 - mA.r) * (1.0 - mA.a) * (1.0 - mA.g);
  float patchy = vnoise(centre / 7.0) * 0.6 + vnoise(centre / 1.9) * 0.4;
  if (density < 0.3 + 0.4 * patchy * (1.0 - density)) { collapse(); return; }

  // Same seasonal recolour the terrain applies to the orthophoto.
  float aspectWet = clamp(-nrm.z * 0.6, 0.0, 0.4);
  float green = clamp(uVeg.x + aspectWet * (1.0 - uVeg.x) * 0.6, 0.0, 1.0);
  // Cured straw keeps the photo's local tone; spring growth is a fresh green sward.
  vec3 straw = mix(alb, vec3(0.40, 0.33, 0.19) * (0.7 + 1.6 * l), 0.45);
  vec3 sward = mix(vec3(0.055, 0.12, 0.028), vec3(0.10, 0.165, 0.035), vnoise(centre / 9.0));
  vec3 base = mix(straw, sward, green);
  // Clump-to-clump hue drift: patches of different grasses.
  base *= mix(vec3(0.9, 1.0, 0.85), vec3(1.1, 1.0, 0.92), vnoise(centre / 3.1));

  // Blade.
  float b = aBlade;
  float rb0 = h21(cc + b * 7.13);
  float rb1 = h21(cc * 1.7 + b * 3.71);
  float rb2 = h21(cc * 2.3 + b * 5.29);
  float rb3 = h21(cc * 3.1 + b * 1.93);
  float ang = rb0 * 6.2832;
  vec2 root = centre + vec2(cos(ang), sin(ang)) * sqrt(rb1) * uSpacing * 0.55;
  float coarse = step(1.0, uSpacing);

  // Plant type: broad-leaved forb, wild oat in seed, or plain grass blade.
  float drift = smoothstep(0.5, 0.72, fbm(root / 45.0 + 3.1, 3));
  // Wildflower drifts: inside a drift most plants are in bloom.
  float forbShare = 0.1 + 0.45 * uVeg.z * drift;
  bool forb = rb3 < forbShare;
  bool oat = !forb && rb3 < forbShare + 0.22 * uSeedHead;
  float springBloom = uVeg.z * (0.25 + drift);
  float thistle = uSeedHead * (1.0 - green) * smoothstep(0.4, 0.7, vnoise(root / 30.0 + 11.0));
  bool flower = forb && (rb2 < springBloom || rb2 < thistle * 0.8);

  float grazed = mix(0.55, 1.0, smoothstep(0.3, 0.7, vnoise(root / 23.0 + 5.0)));
  float height = uGrassH * grazed * (0.55 + 0.9 * rb2) * mix(1.0, 1.5, coarse);
  float width = 0.013 * max(uSpacing / 0.36, 1.0) * (0.7 + 0.6 * rb1);
  float leanAmt = 0.25 + 0.35 * rb1;
  float y = position.y;
  float wMul = 1.0;
  if (oat) {
    height *= 1.35;
    // Thin culm, then a loose drooping panicle of spikelets.
    wMul = y > 0.6 ? 2.4 * sin((y - 0.6) / 0.4 * 3.1416) + 0.4 : 0.45;
    leanAmt += 0.25;
  } else if (forb) {
    if (flower) {
      height = 0.25 + 0.3 * rb1;
      wMul = y > 0.82 ? 4.5 : 1.6;
      leanAmt = 0.08;
    } else {
      // Rosette leaf splayed close to the ground.
      height = 0.12 + 0.12 * rb1;
      wMul = 3.8 * (1.0 - 0.4 * y);
      leanAmt = 1.6;
    }
  }
  width *= wMul;

  float face = rb2 * 6.2832;
  vec3 across = vec3(cos(face), 0.0, sin(face));
  vec3 bendDir = normalize(vec3(cos(ang + 0.6), 0.0, sin(ang + 0.6)));

  vec2 wdir = windDir();
  float ws = length(uWind);
  float gust = windGust(root);
  float stiff = forb ? 0.35 : 1.0;
  float sway = stiff * ((0.06 + 0.05 * ws) * (0.5 + gust * 2.2) + 0.05 * (0.4 + ws * 0.1) * sin(uTime * (2.4 + 1.2 * rb0) + dot(root, wdir) * 0.9));
  sway = min(sway, 1.3);
  vec3 lean = bendDir * leanAmt + vec3(wdir.x, 0.0, wdir.y) * sway;
  vec3 p = vec3(root.x, terrainHeight(root), root.y);
  p += across * position.x * width;
  p += lean * height * y * y;
  p.y += height * y * (1.0 - 0.25 * min(dot(lean, lean), 2.0) * y);

  vWorld = p;
  vY = y;
  vGust = gust * stiff;
  vec3 bladeN = normalize(cross(across, normalize(lean * 2.0 * y + vec3(0.0, 1.0, 0.0))));
  vNormal = bladeN;

  // Tone: dead thatch at the base, individual variation, bleached tips.
  vec3 col = base * (0.7 + 0.6 * rb0);
  col = mix(col, col * vec3(1.25, 1.18, 0.95) + vec3(0.02, 0.018, 0.008), y * (0.1 + 0.9 * (1.0 - green)));
  vec3 thatch = vec3(0.13, 0.115, 0.09) * (0.8 + 0.4 * rb1);
  col = mix(thatch, col, smoothstep(0.0, 0.35, y));
  vHead = 0.0;
  if (oat && y > 0.6) {
    col = mix(vec3(0.24, 0.30, 0.13), vec3(0.50, 0.43, 0.27), 1.0 - green) * (0.85 + 0.3 * rb0);
    vHead = 1.0;
  }
  if (forb) {
    col = mix(vec3(0.06, 0.12, 0.035), vec3(0.17, 0.18, 0.13), 1.0 - green) * (0.8 + 0.4 * rb0);
    if (flower && y > 0.8) {
      float k = h21(root * 0.37);
      vec3 fc = k < 0.35 ? vec3(0.78, 0.24, 0.02)   // California poppy
              : k < 0.6 ? vec3(0.22, 0.13, 0.52)    // sky lupine
              : k < 0.8 ? vec3(0.72, 0.58, 0.05)    // goldfields
              : k < 0.92 ? vec3(0.75, 0.42, 0.04)   // fiddleneck
              : vec3(0.62, 0.30, 0.44);             // owl's clover
      if (rb2 >= springBloom) fc = vec3(0.70, 0.60, 0.08); // yellow star thistle
      col = fc;
      vHead = 2.0;
    }
  }
  vColor = col;

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
in float vGust;
in float vHead;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  vec3 alb = vColor;
  // Spikelets: break the panicle into little bracts.
  if (vHead > 0.5 && vHead < 1.5) alb *= 0.75 + 0.5 * step(0.5, fract(vY * 38.0));
  // Blades bent by a gust flash their paler, glossier undersides.
  alb *= 1.0 + 0.28 * vGust * vY;
  // Blades scatter light like a canopy: bias normals upward.
  n = normalize(n + vec3(0.0, 0.9, 0.0));
  float shadow = shadowAt(vWorld + vec3(0.0, 0.3, 0.0), 0.0012);
  float ao = mix(0.3, 1.0, vY);
  vec3 col = shadeSurface(alb, n, vWorld, ao, mix(0.75, 0.5, vGust), shadow);
  // Light through thin blades when looking toward the sun.
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += alb * sunRadiance(vWorld.y) * back * shadow * 0.3 * vY;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
