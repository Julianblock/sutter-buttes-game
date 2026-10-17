import { lightingCommon } from '../render/shaders/lighting';

export const SPECIES_COUNT = 8;

export const treeVertex = /* glsl */ `
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
  // Wind sway grows with height.
  float wind = length(uWind);
  float ph = uTime * (1.1 + 0.4 * fract(aInst1.w * 7.0)) + aInst1.w * 6.2831 + aInst0.x * 0.03;
  float sway = (sin(ph) + 0.4 * sin(ph * 2.3 + 1.0)) * 0.012 * (0.4 + wind * 0.15) * local.y * local.y;
  vec3 p = vec3(local.x * r, local.y * h, local.z * r);
  p.xz += normalize(uWind + 1e-4) * sway * h;
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
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
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
    if (dist < 900.0 && edge > 0.5 && leafy < (edge - 0.5) * 2.4 * smoothstep(900.0, 500.0, dist)) discard;
    vec3 leafC = uLeafColor[vSpecies] * (0.82 + 0.36 * fract(vSeed * 91.7));
    leafC *= 0.8 + 0.4 * nz;
    // Per-tree autumn variation (some trees turn earlier).
    leafC = mix(leafC, uFallTint, clamp((fract(vSeed * 53.1) - 0.5) * 0.6, 0.0, 1.0) * float(vSpecies != 1 && vSpecies != 4));
    // Oak canopy reflects far less than its leaf colour suggests (self-shadowed
    // gaps, waxy dusty leaves): darken and desaturate toward grey-green.
    float lum = dot(leafC, vec3(0.3, 0.55, 0.15));
    // Blossom (near-white crowns) stays bright.
    leafC = mix(vec3(lum), leafC, 0.8) * mix(0.62, 0.8, smoothstep(0.35, 0.7, lum));
    albedo = mix(uBarkColor[vSpecies] * 0.8, leafC, smoothstep(0.0, 0.5, amount));
    thin = amount;
  } else {
    float bn = vnoise3(vWorld * vec3(2.0, 0.4, 2.0));
    albedo = uBarkColor[vSpecies] * (0.75 + 0.5 * bn);
  }

  float shadow = shadowAt(vWorld + n * 0.3, 0.002);
  vec3 sun = sunRadiance(vWorld.y);
  vec3 moon = moonRadiance(vWorld.y);
  float wrap = vLeaf > 0.5 ? 0.3 : 0.1;
  float ndl = clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float ndlM = clamp((dot(n, uMoonDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float ao = vAO;
  vec3 col = albedo / PI * (sun * ndl * shadow + moon * ndlM * shadow) * mix(1.0, ao, 0.6);
  col += albedo * skyAmbient(n, ao) / PI;
  // Light filtering through backlit leaves.
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  col += albedo * albedo * 2.2 * sun * shadow * back * thin * 0.35 * ao;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
