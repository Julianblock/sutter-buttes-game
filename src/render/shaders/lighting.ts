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
uniform float uInvExposure;
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
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
uniform float uWet;
uniform float uSnowCover;
uniform float uRain;
uniform float uSnowFall;
uniform float uFlash;

const float CLOUD_BASE = 1800.0;
const vec3 SNOW_ALB = vec3(0.86, 0.89, 0.93);

/** Lightning lights the world from the cloud base (display units). */
vec3 flashLight(vec3 n) {
  return vec3(0.75, 0.8, 1.0) * uFlash * 4.0 * uInvExposure * (0.35 + 0.65 * max(n.y, 0.0));
}

/** Fraction of a surface under snow: settles on upward faces, patchy while thin. */
float snowAmount(vec3 n, vec2 xz) {
  if (uSnowCover <= 0.0) return 0.0;
  float patchy = vnoise(xz * 0.21) * 0.6 + vnoise(xz * 1.3) * 0.4;
  float c = uSnowCover * 1.25 - (1.0 - patchy) * 0.5;
  return smoothstep(0.0, 0.25, c) * smoothstep(0.35, 0.8, n.y);
}

/** Soaked porous surfaces go darker and slightly more saturated. */
vec3 wetten(vec3 alb, float porosity) {
  float w = uWet * porosity;
  return mix(alb, alb * alb * 2.2 + alb * 0.25, w * 0.6) * mix(1.0, 0.62, w);
}


vec3 transmittanceAt(float altitude, vec3 dir) {
  float r = R_GROUND + max(altitude, 0.0);
  if (hitsGround(r, dir.y)) return vec3(0.0);
  return texture(uTransmittanceLUT, transmittanceUV(r, dir.y)).rgb;
}

/** Direct radiance of the sun (and moon) arriving at a point, before shadowing. */
/** 0 .. 1: how fully a thick rain / snow cloud deck hides the sky. */
float overcastDeck() {
  return smoothstep(0.0, 0.2, max(uRain, uSnowFall));
}

/** Fraction of light at the cloud top that diffuses through the deck. */
float deckTransmission() {
  return mix(0.3, 0.12, uRain) + uSnowFall * 0.08;
}

/** Irradiance on the top of the cloud deck from the sun and moon. */
vec3 deckIrradiance() {
  vec3 Es = SUN_ILLUMINANCE * transmittanceAt(CLOUD_BASE, uSunDir) * max(uSunDir.y, 0.0);
  vec3 Em = SUN_ILLUMINANCE * uMoonScale * transmittanceAt(CLOUD_BASE, uMoonDir) * max(uMoonDir.y, 0.0);
  // Multiple scattering in the deck washes out most of the sunset reddening.
  vec3 E = Es + Em;
  E = mix(E, vec3(dot(E, vec3(0.2126, 0.7152, 0.0722))), 0.75);
  return E * deckTransmission() * vec3(0.93, 0.96, 1.0);
}

/** CIE overcast sky: zenith three times brighter than the horizon. */
vec3 deckRadiance(vec3 dir) {
  vec3 Lz = deckIrradiance() * 9.0 / (7.0 * PI);
  float up = dir.y >= 0.0 ? (1.0 + 2.0 * dir.y) / 3.0 : 0.33 - dir.y * 0.1;
  return Lz * up + vec3(0.0006, 0.0005, 0.0004) * uNight;
}

vec3 sunRadiance(float altitude) {
  float horizon = smoothstep(-0.01, 0.02, uSunDir.y);
  return SUN_ILLUMINANCE * transmittanceAt(altitude, uSunDir) * horizon * (1.0 - 0.95 * overcastDeck());
}

vec3 moonRadiance(float altitude) {
  float horizon = smoothstep(-0.01, 0.03, uMoonDir.y);
  return SUN_ILLUMINANCE * uMoonScale * transmittanceAt(altitude, uMoonDir) * horizon * vec3(0.9, 0.95, 1.08) * (1.0 - 0.97 * overcastDeck());
}

vec3 skyRadianceDir(vec3 dir) {
  float r = R_GROUND + max(uCamPos.y, 1.0) + 2.0;
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  vec2 mh = normalize(uMoonDir.xz + vec2(1e-5, 0.0));
  vec2 dh = normalize(dir.xz + vec2(0.0, 1e-5));
  vec3 s = texture(uSkyViewLUT, skyViewUV(r, dir.y, dot(dh, sh))).rgb;
  vec3 m = texture(uMoonViewLUT, skyViewUV(r, dir.y, dot(dh, mh))).rgb;
  float deck = overcastDeck();
  vec3 clear = s + m * uMoonScale;
  return deck > 0.0 ? mix(clear, deckRadiance(dir), deck) : clear;
}

/** Hemispherical sky irradiance for a surface normal, with warm ground bounce. */
vec3 skyAmbient(vec3 n, float ao) {
  vec3 up = texture(uAmbientLUT, vec2(0.25, 0.5)).rgb;
  vec3 hz = texture(uAmbientLUT, vec2(0.75, 0.5)).rgb * PI;
  float t = n.y * 0.5 + 0.5;
  vec3 sky = mix(hz * 0.55, up, t * t);
  // Light bounced off sunlit ground (albedo ~0.2) onto surfaces that face it.
  vec3 groundIrr = up + SUN_ILLUMINANCE * transmittanceAt(0.0, uSunDir) * max(uSunDir.y, 0.0);
  vec3 bounce = groundIrr * 0.2 * vec3(1.0, 0.86, 0.66) * (1.0 - t);
  float deck = overcastDeck();
  if (deck > 0.0) {
    vec3 E = deckIrradiance();
    sky = mix(sky, E * mix(0.4, 1.0, t * t), deck);
    bounce = mix(bounce, E * 0.15 * (1.0 - t), deck);
  }
  // Starlight + airglow floor so moonless nights are not pitch black.
  vec3 night = vec3(0.0009, 0.0012, 0.002) * uNight;
  return (sky + bounce + night + flashLight(n)) * ao;
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
  // Smooth 3x3-texel PCF with bilinear weights: soft, stable edges with no
  // per-pixel noise (random rotations read as grain, especially from altitude).
  vec2 uv = p.xy / texel - 0.5;
  vec2 f = fract(uv);
  vec2 base = (floor(uv) + 0.5) * texel;
  float sum = 0.0;
  for (int j = -1; j <= 2; j++) {
    float wy = j == -1 ? 1.0 - f.y : j == 2 ? f.y : 1.0;
    for (int i = -1; i <= 2; i++) {
      float wx = i == -1 ? 1.0 - f.x : i == 2 ? f.x : 1.0;
      float d = texture(uShadowMap, base + vec2(float(i), float(j)) * texel).r;
      sum += (p.z - bias > d ? 0.0 : 1.0) * wx * wy;
    }
  }
  float s = sum / 9.0;
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

/** Optical depth of falling rain / snow (visibility ~2.5 km in heavy rain, ~1 km in snow). */
float precipDepth(float d) {
  return (uRain * 0.0011 + uSnowFall * 0.0028) * min(d, 30000.0);
}

/** Transmittance of the camera-to-point segment (air and tule fog), for emitters. */
vec3 segmentTransmittance(vec3 wp) {
  vec3 v = wp - uCamPos;
  float d = length(v);
  float dy = v.y / max(d, 1e-3);
  vec3 tau = RAYLEIGH_SCAT * layerDepth(uCamPos.y, dy, d, RAYLEIGH_H)
           + vec3(MIE_EXT * uMieScale) * layerDepth(uCamPos.y, dy, d, MIE_H);
  return exp(-tau - fogDepth(uCamPos.y, wp.y, d) - precipDepth(d));
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

  float pd = precipDepth(d);
  if (pd > 0.0) {
    float Tp = exp(-pd);
    color = color * Tp + deckRadiance(vec3(0.0, 0.15, 0.0)) * 0.95 * (1.0 - Tp);
  }

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

/** Player truck low beams: wide, sharp cutoff just above the horizon. */
vec3 headlight(vec3 albedo, vec3 n, vec3 wp) {
  if (uHeadOn <= 0.0) return vec3(0.0);
  vec3 d = wp - uHeadPos;
  float dist = length(d);
  if (dist > 140.0) return vec3(0.0);
  vec3 l = d / dist;
  vec3 right = normalize(cross(uHeadDir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, uHeadDir);
  float fwd = dot(l, uHeadDir);
  float h = dot(l, right) / max(fwd, 0.05);
  float v = dot(l, up) / max(fwd, 0.05);
  float beam = exp(-h * h * 3.2) * smoothstep(0.035, -0.01, v) * smoothstep(-1.2, -0.1, v);
  beam += exp(-h * h * 40.0 - v * v * 300.0) * 1.5; // hot spot
  beam *= smoothstep(0.1, 0.5, fwd);
  float ndl = max(dot(n, -l), 0.0);
  float att = smoothstep(0.8, 2.5, dist) / (dist * dist + 4.0);
  return albedo / PI * vec3(1.0, 0.93, 0.8) * 2400.0 * uInvExposure * beam * att * ndl * uHeadOn * smoothstep(140.0, 60.0, dist);
}

/** Expanding rings where raindrops hit standing water (normal xz offset). */
vec2 rainRipples(vec2 xz) {
  if (uRain <= 0.01) return vec2(0.0);
  vec2 g = xz * 2.2;
  vec2 id = floor(g);
  vec2 sum = vec2(0.0);
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j));
      vec2 o = hash22(c);
      float t = fract(uTime * 1.4 + hash12(c + 7.3));
      vec2 d = (g - c) - o;
      float r = length(d);
      float ring = t * 0.7;
      float w = sin((r - ring) * 38.0) * smoothstep(0.1, 0.0, abs(r - ring)) * (1.0 - t);
      sum += d / max(r, 1e-3) * w;
    }
  }
  return sum * 0.35 * min(1.0, uRain * 1.6);
}

/**
 * Wet surface layer: mirror sky reflection, sun glint and headlight glare on a
 * film of water. \`film\` is 0 (damp) .. 1 (standing puddle).
 */
vec3 wetSurface(vec3 col, vec3 n, vec3 wp, float film, float shadow) {
  if (film <= 0.001) return col;
  vec3 V = normalize(uCamPos - wp);
  vec2 rip = rainRipples(wp.xz) * smoothstep(60.0, 12.0, distance(uCamPos, wp));
  vec3 wn = normalize(mix(n, vec3(0.0, 1.0, 0.0), film) + vec3(rip.x, 0.0, rip.y));
  vec3 R = reflect(-V, wn);
  R.y = abs(R.y) + 0.01;
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
  vec3 refl = skyRadianceDir(normalize(R)) * cloudShadow(wp + R * 400.0);
  refl += flashLight(vec3(0.0, 1.0, 0.0)) * 0.4;
  float glint = pow(max(dot(R, uSunDir), 0.0), mix(60.0, 900.0, film)) * mix(1.5, 140.0, film);
  refl += sunRadiance(wp.y) * shadow * glint;
  // Oncoming headlight glare streaks along wet asphalt toward the viewer.
  if (uHeadOn > 0.0) {
    vec3 L = normalize(uHeadPos - wp);
    float hd = distance(uHeadPos, wp);
    float g = pow(max(dot(R, L), 0.0), mix(20.0, 300.0, film));
    refl += vec3(1.0, 0.93, 0.8) * g * 60.0 * uInvExposure * uHeadOn / (1.0 + hd * hd * 0.02);
  }
  float k = F * mix(0.55, 1.0, film);
  return mix(col * mix(1.0, 0.7, film), refl, k);
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
  return direct + albedo * skyAmbient(n, ao) / PI + headlight(albedo, n, wp);
}

#endif
`;
