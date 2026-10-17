import { lightingCommon } from './lighting';

export const wireVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uPixelAngle;
in vec2 aStrip;   // t along span, side (-1/1)
in vec4 aP0;      // start xyz, sag (m)
in vec4 aP1;      // end xyz, conductor radius (m)
out vec3 vWorld;
out vec3 vTangent;
out float vSide;
out float vCover;

void main() {
  float t = aStrip.x;
  float sag = aP0.w;
  vec3 world = mix(aP0.xyz, aP1.xyz, t);
  world.y -= 4.0 * sag * t * (1.0 - t);
  vec3 tangent = normalize(aP1.xyz - aP0.xyz + vec3(0.0, -4.0 * sag * (1.0 - 2.0 * t), 0.0));
  vec3 toCam = uCamPos - world;
  float dist = length(toCam);
  vec3 midSpan = mix(aP0.xyz, aP1.xyz, 0.5);
  if (distance(midSpan.xz, uCamPos.xz) > 9000.0 + distance(aP0.xz, aP1.xz)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Widen to at least ~1.2 px and carry the true width as coverage instead.
  float radius = aP1.w;
  float halfW = max(radius, dist * uPixelAngle * 0.6);
  vCover = radius / halfW;
  vec3 side = normalize(cross(tangent, toCam));
  world += side * aStrip.y * halfW;
  vWorld = world;
  vTangent = tangent;
  vSide = aStrip.y;
  vec2 dc = world.xz - uCamPos.xz;
  world.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const wireFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vTangent;
in float vSide;
in float vCover;
out vec4 outColor;

void main() {
  #include <logdepthbuf_fragment>
  vec3 tng = normalize(vTangent);
  vec3 v = uCamPos - vWorld;
  vec3 facing = normalize(v - tng * dot(v, tng));
  vec3 across = normalize(cross(tng, facing));
  // Round conductor: normal sweeps across the ribbon.
  float s = clamp(vSide, -1.0, 1.0);
  vec3 n = normalize(facing * sqrt(max(0.0, 1.0 - s * s)) + across * s);
  // Weathered stranded aluminium.
  vec3 alb = vec3(0.22, 0.23, 0.24);
  float shadow = shadowAt(vWorld, 0.0008);
  vec3 col = shadeSurface(alb, n, vWorld, 1.0, 0.45, shadow);
  col = applyAtmosphere(col, vWorld);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
  float dist = length(v);
  float a = pow(vCover, 0.75) * edge * (1.0 - smoothstep(6000.0, 9000.0, dist));
  outColor = vec4(col, a);
}
`;
