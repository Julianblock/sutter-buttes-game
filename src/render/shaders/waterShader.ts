import { lightingCommon, waterCommon } from './lighting';
import { terrainCommon } from './terrainCommon';

/** Water surface drawn on the terrain's quadtree patches at the baked water level. */
export const waterVertex = /* glsl */ `
${terrainCommon}
${waterCommon}
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
uniform float uGridDim;
uniform float uLodK;
in vec4 aNode;
out vec3 vWorld;

float surfaceAt(vec2 xz) {
  vec2 wl = waterAt(xz);
  return wl.x > -500.0 ? wl.x : terrainHeight(xz) - 30.0;
}

void main() {
  float hw = uWaterSize * 0.5;
  if (aNode.x > hw || aNode.y > hw || aNode.x + aNode.z < -hw || aNode.y + aNode.z < -hw) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 g = position.xz * uGridDim;
  vec2 xz = aNode.xy + position.xz * aNode.z;
  float h = surfaceAt(xz);
  float dist = distance(uCamPos, vec3(xz.x, h, xz.y));
  float mEnd = 2.0 * aNode.z * uLodK;
  float mStart = mEnd * 0.7;
  float morph = clamp((dist - mStart) / (mEnd - mStart), 0.0, 1.0);
  xz -= fract(g * 0.5) * 2.0 / uGridDim * aNode.z * morph;
  vWorld = vec3(xz.x, surfaceAt(xz), xz.y);
  vec2 dc = xz - uCamPos.xz;
  vec3 p = vWorld;
  p.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const waterFragment = /* glsl */ `
${lightingCommon}
${terrainCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
out vec4 outColor;

/** Wind ripples and slow swells, fading below a pixel to stop sparkle. */
vec3 waterNormal(vec2 xz, float dist) {
  vec2 w = uWind * uTime;
  float fp = length(fwidth(xz));
  float e = 0.3;
  float s = 1.0 / 1.8;
  float a = vnoise((xz + w * 0.5) * s) + 0.5 * vnoise((xz * 2.3 - w * 0.8) * s);
  float b = vnoise((xz + vec2(e, 0.0) + w * 0.5) * s) + 0.5 * vnoise(((xz + vec2(e, 0.0)) * 2.3 - w * 0.8) * s);
  float c = vnoise((xz + vec2(0.0, e) + w * 0.5) * s) + 0.5 * vnoise(((xz + vec2(0.0, e)) * 2.3 - w * 0.8) * s);
  float amp = 0.07 * smoothstep(3.0, 0.4, fp) * (0.5 + length(uWind) * 0.15);
  vec2 big = xz / 30.0 + w * 0.03;
  float sx = vnoise(big) - vnoise(big + vec2(0.05, 0.0));
  float sz = vnoise(big) - vnoise(big + vec2(0.0, 0.05));
  vec2 rip = rainRipples(xz) * smoothstep(0.2, 0.05, fp);
  return normalize(vec3((a - b) * amp / e + rip.x + sx * 0.4, 1.0, (a - c) * amp / e + rip.y + sz * 0.4));
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 xz = vWorld.xz;
  vec2 wl = waterAt(xz);
  if (wl.y < 0.02) discard;
  float depth = wl.x - terrainHeight(xz);
  if (depth < 0.0) discard;
  vec3 toEye = uCamPos - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  vec3 n = waterNormal(xz, dist);
  vec3 col;
  float alpha;
  if (uCamPos.y >= vWorld.y) {
    float cosV = max(dot(n, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
    vec3 R = reflect(-V, n);
    R.y = abs(R.y) + 0.01;
    float shadow = shadowAt(vWorld, 0.0004);
    vec3 refl = skyRadianceDir(normalize(R)) * cloudShadow(vWorld + R * 400.0);
    float sd = max(dot(R, uSunDir), 0.0);
    refl += sunRadiance(vWorld.y) * shadow * (pow(sd, 900.0) * 140.0 + pow(sd, 80.0) * 0.5);
    refl += moonRadiance(vWorld.y) * pow(max(dot(R, uMoonDir), 0.0), 700.0) * 90.0;
    refl += flashLight(vec3(0.0, 1.0, 0.0)) * 0.3;
    // Down through the water to the bed along the refracted ray, and back.
    float cosT = sqrt(1.0 - (1.0 - cosV * cosV) / 1.77);
    vec3 T = exp(-WATER_SIGMA * depth / max(cosT, 0.12));
    float t = dot(T, vec3(0.3, 0.4, 0.3));
    vec3 body = waterScatter(depth * 0.4) * (1.0 - T);
    alpha = clamp(1.0 - t * (1.0 - F), 0.0, 1.0);
    col = (body * (1.0 - F) + refl * F) / max(alpha, 1e-3);
    // Feather the very edge so the shoreline never shows a hard line.
    alpha *= smoothstep(0.0, 0.08, depth);
  } else {
    // From below: the sky squeezed into Snell's window, mirror-murk outside it.
    vec3 I = -V;
    vec3 t = refract(I, -n, 1.33);
    float camDepth = vWorld.y - uCamPos.y;
    if (dot(t, t) < 1e-4) {
      col = waterScatter(camDepth + 2.0) * 0.8;
    } else {
      float cosI = max(dot(I, n), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
      col = skyRadianceDir(normalize(vec3(t.x, max(t.y, 0.02), t.z))) * (1.0 - F) * 0.9;
      col += sunRadiance(vWorld.y) * pow(max(dot(normalize(t), uSunDir), 0.0), 3000.0) * 40.0;
      col += waterScatter(camDepth) * F;
    }
    alpha = 1.0;
  }
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, alpha);
}
`;
