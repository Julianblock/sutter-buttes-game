import { lightingCommon } from './lighting';

export const FLOCK_SPECIES = 4;

/** Instanced background birds: wings flap or hold a gliding dihedral in the shader. */
export const flockVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uTime;
in float aSpan;    // -1..1 across the wings, 0 on the body
in float aWing;    // 1 for wing vertices
in vec4 aP;        // x, y, z, scale
in vec4 aO;        // yaw, pitch, bank, species
in vec2 aF;        // flap phase, flap amount (0 = gliding)
out vec3 vWorld;
out vec3 vNormal;
out float vSpan;
flat out int vSpecies;

void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aWing > 0.5) {
    float side = sign(aSpan);
    float s = abs(aSpan);
    // Flap: whole wing rotates about the shoulder, the hand lags behind.
    float a = sin(aF.x) * 0.9 * aF.y + sin(aF.x - 0.6) * 0.35 * aF.y * s;
    // Gliders hold a dihedral (vultures: a pronounced V).
    a += mix(0.12, 0.0, aF.y);
    float c = cos(a), sn = sin(a);
    vec2 q = vec2(p.x, p.y);
    p.x = q.x * c - side * q.y * sn;
    p.y = side * q.x * sn + q.y * c;
    vec2 m = vec2(n.x, n.y);
    n.x = m.x * c - side * m.y * sn;
    n.y = side * m.x * sn + m.y * c;
  }
  p *= aP.w;
  // Orientation: bank about forward (+z), pitch about x, yaw about y.
  float cb = cos(aO.z), sb = sin(aO.z);
  p.xy = mat2(cb, sb, -sb, cb) * p.xy;
  n.xy = mat2(cb, sb, -sb, cb) * n.xy;
  float cp = cos(aO.y), sp = sin(aO.y);
  p.yz = mat2(cp, -sp, sp, cp) * p.yz;
  n.yz = mat2(cp, -sp, sp, cp) * n.yz;
  float cy = cos(aO.x), sy = sin(aO.x);
  p.xz = mat2(cy, -sy, sy, cy) * p.xz;
  n.xz = mat2(cy, -sy, sy, cy) * n.xz;
  vec3 world = aP.xyz + p;
  vWorld = world;
  vNormal = n;
  vSpan = aSpan;
  vSpecies = int(aO.w + 0.5);
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const flockFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform vec3 uBody[${FLOCK_SPECIES}];
uniform vec3 uWingC[${FLOCK_SPECIES}];
uniform vec3 uTip[${FLOCK_SPECIES}];
uniform float uTipStart[${FLOCK_SPECIES}];
in vec3 vWorld;
in vec3 vNormal;
in float vSpan;
flat in int vSpecies;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float s = abs(vSpan);
  vec3 alb = s < 0.08 ? uBody[vSpecies] : mix(uWingC[vSpecies], uTip[vSpecies], smoothstep(uTipStart[vSpecies] - 0.05, uTipStart[vSpecies] + 0.05, s));
  // Thin feathers glow when backlit against the sky.
  vec3 V = normalize(uCamPos - vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 6.0) * step(0.08, s);
  vec3 col = shadeSurface(alb, n, vWorld, 0.9, 0.8, 1.0);
  col += alb * sunRadiance(vWorld.y) * back * 0.08;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
