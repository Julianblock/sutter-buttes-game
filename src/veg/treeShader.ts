import { lightingCommon } from '../render/shaders/lighting';
import { noiseCommon } from '../render/shaders/noise';
import { windCommon } from '../render/shaders/wind';

export const SPECIES_COUNT = 8;

export const treeVertex = /* glsl */ `
${noiseCommon}
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uWind;
uniform float uLeafAmount[${SPECIES_COUNT}];
in vec3 aCenter;
in float aPart;
in vec4 aInst0; // x, y, z, rotation
in vec4 aInst1; // crown radius, height, species, seed
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out float vAO;
out vec3 vClusterN;
flat out int vSpecies;
flat out float vSeed;
flat out float vLeaf;
flat out vec2 vSize;
out float vGust;
${windCommon}

void main() {
  vec3 local = position;
  int sp = int(aInst1.z + 0.5);
  float leaf = aPart;
  float amount = uLeafAmount[sp];
  vec3 c = aCenter;
  vec3 crownC = vec3(0.0, 0.62, 0.0);
  vec3 n = normal;
  vec3 nCluster = vec3(0.0, 1.0, 0.0);
  if (leaf > 0.5) {
    // Bare trees: clusters contract into a twiggy core.
    local = c + (local - c) * mix(0.6, 1.0, amount);
    nCluster = normalize(local - c);
    vec3 nCrown = normalize((local - crownC) / vec3(0.84, 0.36, 0.84));
    n = normalize(mix(nCluster, nCrown, 0.6));
    float shell = length((local - crownC) / vec3(0.9, 0.38, 0.9));
    vAO = clamp(0.25 + 0.75 * shell, 0.25, 1.0) * mix(0.55, 1.0, smoothstep(0.35, 0.9, local.y));
  } else {
    vAO = mix(0.35, 0.8, smoothstep(0.0, 0.6, local.y));
  }
  float r = aInst1.x;
  float h = aInst1.y;
  float rot = aInst0.w;
  // Wind: trunk sway and a downwind lean that both swell as gusts pass,
  // plus leaf clusters bobbing on their twigs.
  float wind = length(uWind);
  float gust = windGust(aInst0.xz);
  vGust = gust * smoothstep(0.5, 4.0, wind);
  float ph = uTime * (1.1 + 0.4 * fract(aInst1.w * 7.0)) + aInst1.w * 6.2831 + aInst0.x * 0.03;
  float sway = (sin(ph) + 0.4 * sin(ph * 2.3 + 1.0)) * 0.012 * (0.4 + wind * 0.15) * (0.6 + 1.6 * gust);
  sway += 0.004 * wind * (0.3 + gust);
  sway *= local.y * local.y;
  if (leaf > 0.5) {
    float ch = fract(sin(dot(c, vec3(12.9, 78.2, 37.7))) * 43758.5);
    float bob = sin(uTime * (2.5 + 2.0 * ch) + ch * 6.28) * 0.012 * (0.3 + gust) * (0.4 + wind * 0.12);
    local += vec3(bob, bob * 0.5, -bob * 0.7);
  }
  vec3 p = vec3(local.x * r, local.y * h, local.z * r);
  p.xz += windDir() * sway * h;
  float cs = cos(rot), sn = sin(rot);
  p.xz = mat2(cs, -sn, sn, cs) * p.xz;
  n = normalize(vec3(n.x / r, n.y / h, n.z / r));
  n.xz = mat2(cs, -sn, sn, cs) * n.xz;
  nCluster = normalize(vec3(nCluster.x / r, nCluster.y / h, nCluster.z / r));
  nCluster.xz = mat2(cs, -sn, sn, cs) * nCluster.xz;
  vClusterN = nCluster;
  vec3 world = aInst0.xyz + p;
  vWorld = world;
  vNormal = n;
  vLocal = local;
  vSpecies = sp;
  vSeed = aInst1.w;
  vLeaf = leaf;
  vSize = vec2(r, h);
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

export const treeFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform vec3 uLeafColor[${SPECIES_COUNT}];
uniform vec3 uBarkColor[${SPECIES_COUNT}];
uniform float uLeafAmount[${SPECIES_COUNT}];
uniform vec3 uFallTint;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in float vAO;
in vec3 vClusterN;
flat in int vSpecies;
flat in float vSeed;
flat in float vLeaf;
flat in vec2 vSize;
in float vGust;
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

/** Nearest elliptical leaf in a jittered 3D grid: x = distance, yzw = cell id. */
vec4 leafCells(vec3 q) {
  vec3 ci = floor(q);
  vec3 o = step(0.5, fract(q)) - 1.0;
  float best = 9.0;
  vec3 bestId = ci;
  for (int k = 0; k < 8; k++) {
    vec3 c = ci + o + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 dv = q - (c + vec3(hash13(c), hash13(c + 19.1), hash13(c + 47.7)));
    vec3 axis = normalize(vec3(hash13(c + 2.9), hash13(c + 6.1), hash13(c + 8.3)) - 0.5);
    float al = dot(dv, axis);
    float dd = sqrt(dot(dv, dv) + 2.2 * al * al) / (0.5 + 0.35 * hash13(c + 11.3));
    if (dd < best) { best = dd; bestId = c; }
  }
  return vec4(best, bestId);
}

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
  if (vLeaf > 1.5) discard;
  if (vLeaf > 0.5) {
    float amount = uLeafAmount[vSpecies];
    float nz = vnoise3(vLocal * 9.0 + vSeed * 13.0);
    float fine = vnoise3(vLocal * 31.0 + vSeed * 7.0);
    if (amount < 0.98 && fine * 0.6 + nz * 0.4 > mix(0.32, 1.05, amount)) discard;
    // Dappled light through gaps in the canopy.
    if (vnoise3(vLocal * 26.0 + vSeed * 5.0) < 0.22) discard;
  }
  outColor = vec4(vShadowZ, 0.0, 0.0, 1.0);
  return;
#endif
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  float amount = uLeafAmount[vSpecies];
  vec3 albedo;
  float thin = 0.0;
  if (vLeaf > 0.5) {
    float nz = vnoise3(vLocal * 9.0 + vSeed * 13.0);
    float fine = vnoise3(vLocal * 31.0 + vSeed * 7.0);
    // Bare canopies: keep only a sparse lattice of twigs.
    if (amount < 0.98 && fine * 0.6 + nz * 0.4 > mix(0.32, 1.05, amount)) discard;
    // Ragged, leafy silhouettes where clusters turn edge-on to the viewer.
    float dist = length(uCamPos - vWorld);
    float edge = 1.0 - abs(dot(normalize(vClusterN), V));
    float leafy = vnoise3(vLocal * 46.0 + vSeed * 3.0);
    bool inner = vLeaf > 1.5;
    float leafyScale = smoothstep(0.012, 0.004, length(fwidth(vLocal)));
    if (!inner && edge > 0.5 && leafy < (edge - 0.5) * 2.4 * leafyScale) discard;
    vec3 leafC = uLeafColor[vSpecies] * (0.82 + 0.36 * fract(vSeed * 91.7));
    leafC *= 0.8 + 0.4 * nz;
    // Leaf structure at two scales: individual leaves up close, then leaf
    // clumps at mid range. Each cell is tilted and toned differently, gaps open
    // between cells (mostly at the silhouette), and cell rims self-shadow.
    vec3 pm = vLocal * vec3(vSize.x, vSize.y, vSize.x);
    float fp = length(fwidth(pm));
    float sFine = inner ? 0.0 : smoothstep(0.15, 0.045, fp);
    float sCoarse = inner ? 0.0 : smoothstep(0.7, 0.2, fp) * (1.0 - sFine);
    if (sFine > 0.0) {
      vec4 c = leafCells(pm / 0.12 + vSeed * 17.0);
      float cut = mix(1.15, 0.85, edge);
      if (c.x > mix(9.0, cut, sFine)) discard;
      vec3 leafN = vec3(hash13(c.yzw + 5.1), hash13(c.yzw + 7.7), hash13(c.yzw + 9.9)) - 0.5;
      // Gusts set leaves fluttering.
      leafN += 0.5 * vGust * sin(uTime * 9.0 + hash13(c.yzw) * 6.28) * vec3(0.6, 1.0, 0.4);
      n = normalize(n + leafN * 1.1 * sFine);
      leafC *= mix(1.0, (0.8 + 0.4 * hash13(c.yzw + 3.3)) * (0.75 + 0.25 * (1.0 - c.x / cut)), sFine);
    }
    if (sCoarse > 0.0) {
      vec4 c = leafCells(pm / 0.55 + vSeed * 5.0);
      float cut = mix(1.6, 0.95, edge * edge);
      if (c.x > mix(9.0, cut, sCoarse)) discard;
      vec3 clumpN = vec3(hash13(c.yzw + 5.1), hash13(c.yzw + 7.7), hash13(c.yzw + 9.9)) - 0.5;
      clumpN += 0.25 * vGust * sin(uTime * 5.0 + hash13(c.yzw) * 6.28);
      n = normalize(n + clumpN * 0.8 * sCoarse);
      leafC *= mix(1.0, (0.85 + 0.3 * hash13(c.yzw + 3.3)) * (0.6 + 0.4 * (1.0 - c.x / cut)), sCoarse);
    }
    if (inner) leafC *= 0.55;
    // Per-tree autumn variation (some trees turn earlier).
    leafC = mix(leafC, uFallTint, clamp((fract(vSeed * 53.1) - 0.5) * 0.6, 0.0, 1.0) * float(vSpecies != 1 && vSpecies != 4));
    // Oak canopy reflects far less than its leaf colour suggests (self-shadowed
    // gaps, waxy dusty leaves): darken and desaturate toward grey-green.
    float lum = dot(leafC, vec3(0.3, 0.55, 0.15));
    // Blossom (near-white crowns) stays bright.
    leafC = mix(vec3(lum), leafC, 0.8) * mix(0.62, 0.8, smoothstep(0.35, 0.7, lum));
    albedo = mix(uBarkColor[vSpecies] * 0.5, leafC, smoothstep(0.0, 0.5, amount));
    thin = amount;
  } else {
    float bn = vnoise3(vWorld * vec3(2.0, 0.4, 2.0));
    albedo = uBarkColor[vSpecies] * 0.55 * (0.75 + 0.5 * bn);
  }

  // Rain darkens bark far more than waxy leaves.
  albedo = wetten(albedo, vLeaf > 0.5 ? 0.35 : 1.0);
  // Snow lodges on the tops of branches and leaf clumps.
  vec3 gn = normalize(vNormal);
  if (!gl_FrontFacing) gn = -gn;
  float snowT = snowAmount(normalize(gn + n * 0.5), vWorld.xz * 2.0 + vWorld.y, vWorld.y) * (vLeaf > 0.5 ? 0.25 : 0.35);
  albedo = mix(albedo, SNOW_ALB, snowT);
  thin *= 1.0 - snowT;

  float shadow = shadowAt(vWorld + n * 0.3, 0.002);
  vec3 sun = sunRadiance(vWorld.y);
  vec3 moon = moonRadiance(vWorld.y);
  float wrap = vLeaf > 0.5 ? 0.3 : 0.1;
  float ndl = clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float ndlM = clamp((dot(n, uMoonDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float ao = vAO;
  vec3 col = albedo / PI * (sun * ndl * shadow + moon * ndlM * shadow) * mix(1.0, ao, 0.6);
  col += albedo * skyAmbient(n, ao) / PI + headlight(albedo, n, vWorld);
  // Light filtering through backlit leaves.
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  col += albedo * albedo * 2.2 * sun * shadow * back * thin * 0.35 * ao;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
