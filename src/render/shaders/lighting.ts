import { atmosphereCommon } from './atmosphereCommon';
import { noiseCommon } from './noise';

/** Uniform declarations + lighting helpers shared by every lit material. */
export const lightingCommon = /* glsl */ `
${atmosphereCommon}
${noiseCommon}
#ifndef LIGHTING_COMMON
#define LIGHTING_COMMON

uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonScale;
uniform float uNight;
uniform float uFogTop;
uniform float uFogDensity;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform vec2 uWind;
uniform vec4 uSeason;
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uSkyViewLUT;
uniform sampler2D uMoonViewLUT;
uniform sampler2D uAmbientLUT;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform sampler2D uTerrainShadow;
uniform float uTerrainShadowSize;

const float CLOUD_BASE = 1800.0;

vec3 transmittanceAt(float altitude, vec3 dir) {
  float r = R_GROUND + max(altitude, 0.0);
  if (hitsGround(r, dir.y)) return vec3(0.0);
  return texture(uTransmittanceLUT, transmittanceUV(r, dir.y)).rgb;
}

/** Direct radiance of the sun (and moon) arriving at a point, before shadowing. */
vec3 sunRadiance(float altitude) {
  float horizon = smoothstep(-0.01, 0.02, uSunDir.y);
  return SUN_ILLUMINANCE * transmittanceAt(altitude, uSunDir) * horizon;
}

vec3 moonRadiance(float altitude) {
  float horizon = smoothstep(-0.01, 0.03, uMoonDir.y);
  return SUN_ILLUMINANCE * uMoonScale * transmittanceAt(altitude, uMoonDir) * horizon * vec3(0.9, 0.95, 1.08);
}

vec3 skyRadianceDir(vec3 dir) {
  float r = R_GROUND + max(uCamPos.y, 1.0) + 2.0;
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  vec2 mh = normalize(uMoonDir.xz + vec2(1e-5, 0.0));
  vec2 dh = normalize(dir.xz + vec2(0.0, 1e-5));
  vec3 s = texture(uSkyViewLUT, skyViewUV(r, dir.y, dot(dh, sh))).rgb;
  vec3 m = texture(uMoonViewLUT, skyViewUV(r, dir.y, dot(dh, mh))).rgb;
  return s + m * uMoonScale;
}

/** Hemispherical sky irradiance for a surface normal, with warm ground bounce. */
vec3 skyAmbient(vec3 n, float ao) {
  vec3 up = texture(uAmbientLUT, vec2(0.25, 0.5)).rgb;
  vec3 hz = texture(uAmbientLUT, vec2(0.75, 0.5)).rgb * PI;
  float t = n.y * 0.5 + 0.5;
  vec3 sky = mix(hz * 0.55, up, t * t);
  vec3 bounce = (up * 0.18) * vec3(1.0, 0.85, 0.62) * (1.0 - t);
  // Starlight + airglow floor so moonless nights are not pitch black.
  vec3 night = vec3(0.0009, 0.0012, 0.002) * uNight;
  return (sky + bounce + night) * ao;
}

float cloudCoverage(vec2 xz) {
  vec2 p = (xz + uCloudOffset) / 5200.0;
  float n = fbm(p, 5);
  float cover = mix(0.78, 0.32, uCloudCover);
  return smoothstep(cover, cover + 0.22, n);
}

/** Soft shadow cast by the cloud layer onto a world point. */
float cloudShadow(vec3 wp) {
  if (uCloudCover < 0.02) return 1.0;
  vec3 L = uSunDir.y > 0.0 ? uSunDir : uMoonDir;
  float t = (CLOUD_BASE + 300.0 - wp.y) / max(L.y, 0.08);
  vec2 xz = wp.xz + L.xz * t;
  return 1.0 - 0.78 * cloudCoverage(xz);
}

/** Large-scale terrain self shadowing (Buttes casting shadows across the valley). */
float terrainShadow(vec3 wp) {
  vec2 uv = wp.xz / uTerrainShadowSize + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  vec2 s = texture(uTerrainShadow, uv).rg;
  // r: horizon height above the point along the light; soften with height
  return clamp(1.0 - (s.r - wp.y) / 25.0, 0.0, 1.0);
}

float nearShadow(vec3 wp, float bias) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  if (any(lessThan(p.xy, vec2(0.001))) || any(greaterThan(p.xy, vec2(0.999)))) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float sum = 0.0;
  // 12-tap rotated Poisson PCF
  const vec2 taps[12] = vec2[](
    vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
    vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
    vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
  float ang = hash12(gl_FragCoord.xy) * 6.2831;
  mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  for (int i = 0; i < 12; i++) {
    float d = texture(uShadowMap, p.xy + R * taps[i] * texel * 1.6).r;
    sum += p.z - bias > d ? 0.0 : 1.0;
  }
  float s = sum / 12.0;
  vec2 edge = smoothstep(vec2(0.0), vec2(0.08), p.xy) * smoothstep(vec2(1.0), vec2(0.92), p.xy);
  return mix(1.0, s, edge.x * edge.y);
}

float shadowAt(vec3 wp, float bias) {
  return min(terrainShadow(wp), nearShadow(wp, bias)) * cloudShadow(wp);
}

/** Optical depth through an exponential layer along a straight segment. */
float layerDepth(float y0, float dy, float d, float H) {
  float a = exp(-max(y0, 0.0) / H);
  float k = dy / H;
  if (abs(k * d) < 1e-3) return a * d * (1.0 - 0.5 * k * d);
  return a * (1.0 - exp(-k * d)) / k;
}

/** Optical depth through the flat-topped tule fog layer. */
float fogDepth(float y0, float y1, float d) {
  if (uFogDensity <= 0.0) return 0.0;
  float top = uFogTop;
  float lo = min(y0, y1);
  float hi = max(y0, y1);
  if (lo > top + 40.0) return 0.0;
  float inside;
  if (hi - lo < 0.01) inside = smoothstep(top + 40.0, top - 20.0, lo);
  else inside = clamp((min(hi, top) - lo) / (hi - lo), 0.0, 1.0);
  return uFogDensity * d * inside;
}

/** Aerial perspective: attenuates a lit surface and adds in-scattered sky light. */
vec3 applyAtmosphere(vec3 color, vec3 wp) {
  vec3 v = wp - uCamPos;
  float d = length(v);
  vec3 dir = v / max(d, 1e-3);
  float y0 = uCamPos.y;
  float dy = dir.y;
  vec3 tau = RAYLEIGH_SCAT * layerDepth(y0, dy, d, RAYLEIGH_H)
           + vec3(MIE_EXT * uMieScale) * layerDepth(y0, dy, d, MIE_H);
  vec3 T = exp(-tau);
  // Normalise the sky-view radiance (which integrates to the ground/top) by the
  // transmittance along the full ray, giving in-scatter for this segment only.
  float rCam = R_GROUND + max(y0, 1.0) + 2.0;
  float dFull = hitsGround(rCam, dy) ? min(distanceToGround(rCam, dy), 400000.0) : 400000.0;
  vec3 tauFull = RAYLEIGH_SCAT * layerDepth(y0, dy, dFull, RAYLEIGH_H)
               + vec3(MIE_EXT * uMieScale) * layerDepth(y0, dy, dFull, MIE_H);
  vec3 sky = skyRadianceDir(dir);
  vec3 inscatter = sky * clamp((1.0 - T) / max(1.0 - exp(-tauFull), vec3(1e-4)), 0.0, 1.0);
  color = color * T + inscatter;

  float fog = fogDepth(y0, wp.y, d);
  if (fog > 0.0) {
    float Tf = exp(-fog);
    vec3 amb = texture(uAmbientLUT, vec2(0.25, 0.5)).rgb;
    float sunTop = smoothstep(-0.05, 0.15, uSunDir.y);
    float depthIn = clamp((uFogTop - min(y0, wp.y)) / 120.0, 0.0, 1.0);
    vec3 fogCol = (amb * 0.33 + sunRadiance(uFogTop) * 0.06 * sunTop) * mix(1.0, 0.55, depthIn);
    fogCol += moonRadiance(uFogTop) * 0.05;
    color = color * Tf + fogCol * (1.0 - Tf);
  }
  return color;
}

/** Shared diffuse + specular shading for opaque surfaces. */
vec3 shadeSurface(vec3 albedo, vec3 n, vec3 wp, float ao, float rough, float shadow) {
  vec3 V = normalize(uCamPos - wp);
  vec3 sun = sunRadiance(wp.y);
  vec3 moon = moonRadiance(wp.y);
  float ndl = max(dot(n, uSunDir), 0.0);
  float ndlM = max(dot(n, uMoonDir), 0.0);
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(n, H), 0.0);
  float a = rough * rough;
  float a2 = a * a;
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float spec = D * F * 0.25;
  vec3 direct = (albedo / PI + spec) * sun * ndl * shadow + albedo / PI * moon * ndlM * shadow;
  return direct + albedo * skyAmbient(n, ao) / PI;
}

#endif
`;
