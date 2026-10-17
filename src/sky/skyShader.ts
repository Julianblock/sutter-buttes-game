import { lightingCommon } from '../render/shaders/lighting';

export const skyVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
out vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
  #include <logdepthbuf_vertex>
}
`;

export const skyFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform mat3 uCelestial;
uniform float uMoonIllum;
uniform float uStarBrightness;
in vec3 vDir;
out vec4 outColor;

// --- Stars -------------------------------------------------------------------------
vec3 starField(vec3 eq) {
  vec3 a = abs(eq);
  vec3 col = vec3(0.0);
  vec2 uv;
  float face;
  if (a.x > a.y && a.x > a.z) { uv = eq.yz / a.x; face = sign(eq.x); }
  else if (a.y > a.z) { uv = eq.xz / a.y; face = 2.0 + sign(eq.y); }
  else { uv = eq.xy / a.z; face = 4.0 + sign(eq.z); }
  for (int layer = 0; layer < 2; layer++) {
    float res = layer == 0 ? 180.0 : 520.0;
    vec2 g = uv * res;
    vec2 cell = floor(g);
    vec2 seed = cell + face * 1013.0 + float(layer) * 77.0;
    float h = hash12(seed);
    float density = layer == 0 ? 0.18 : 0.5;
    if (h < density) {
      vec2 pos = 0.2 + 0.6 * hash22(seed + 3.1);
      float d = length(g - cell - pos);
      float mag = pow(hash12(seed + 7.7), layer == 0 ? 7.0 : 14.0);
      float bright = (layer == 0 ? 2.5 : 0.6) * mag + 0.0015;
      float size = layer == 0 ? 0.11 : 0.2;
      float s = exp(-d * d / (size * size));
      float t = hash12(seed + 11.0);
      vec3 tint = t < 0.15 ? vec3(1.0, 0.72, 0.5) : t < 0.35 ? vec3(1.0, 0.9, 0.78) : t > 0.85 ? vec3(0.72, 0.82, 1.0) : vec3(1.0);
      col += tint * bright * s;
    }
  }
  return col;
}

// Galactic plane: north galactic pole RA 192.86, Dec 27.13; centre RA 266.4, Dec -28.94.
vec3 milkyWay(vec3 eq) {
  const vec3 ngp = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 gc = vec3(-0.0548, -0.8734, -0.4838);
  float b = asin(clamp(dot(eq, ngp), -1.0, 1.0));
  vec3 gy = cross(ngp, gc);
  float l = atan(dot(eq, gy), dot(eq, gc));
  float core = exp(-l * l / 0.9);
  float width = 0.13 + 0.12 * core;
  float band = exp(-b * b / (width * width));
  vec2 p = vec2(l * 6.0, b * 9.0);
  float clouds = fbm(p * 2.0, 6);
  float dust = smoothstep(0.42, 0.66, fbm(p * 3.1 + 5.0, 5)) * exp(-b * b / 0.006);
  float i = band * (0.35 + 0.9 * core) * (0.45 + 0.9 * clouds) * (1.0 - 0.8 * dust);
  return vec3(0.82, 0.86, 1.0) * mix(1.0, 1.25, core) * i * 0.012 + vec3(1.0, 0.85, 0.65) * core * band * 0.004;
}

// --- Moon --------------------------------------------------------------------------
vec3 moonDisk(vec3 dir) {
  const float R = 0.0045 * 1.25;
  float c = dot(dir, uMoonDir);
  if (c < cos(R * 1.6)) return vec3(0.0);
  vec3 up = abs(uMoonDir.y) > 0.99 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  vec3 bx = normalize(cross(up, uMoonDir));
  vec3 by = cross(uMoonDir, bx);
  vec2 q = vec2(dot(dir, bx), dot(dir, by)) / R;
  float r2 = dot(q, q);
  float edge = smoothstep(1.0, 0.96, sqrt(r2));
  if (r2 > 1.0) return vec3(0.0);
  vec3 sn = vec3(q, sqrt(1.0 - r2));
  // Sun direction projected into the moon's frame gives the terminator.
  vec3 L = normalize(vec3(dot(uSunDir, bx), dot(uSunDir, by), -dot(uSunDir, uMoonDir)));
  float lit = smoothstep(-0.03, 0.08, dot(sn, L));
  float maria = fbm(q * 2.3 + 4.0, 4);
  float albedo = mix(1.0, 0.62, smoothstep(0.45, 0.7, maria)) * (0.85 + 0.15 * vnoise(q * 18.0));
  vec3 earthshine = vec3(0.004, 0.005, 0.007);
  return (vec3(1.0, 0.96, 0.9) * lit * albedo * 2.2 + earthshine) * edge;
}

// --- Clouds ------------------------------------------------------------------------
vec4 cloudLayer(vec3 dir) {
  if (uCloudCover < 0.02 || dir.y < 0.005) return vec4(0.0);
  float base = CLOUD_BASE;
  float top = CLOUD_BASE + 650.0;
  float t0 = (base - uCamPos.y) / dir.y;
  float t1 = (top - uCamPos.y) / dir.y;
  if (t1 < 0.0) return vec4(0.0);
  t0 = max(t0, 0.0);
  float dist = t0;
  const int STEPS = 7;
  float dt = (t1 - t0) / float(STEPS);
  float trans = 1.0;
  vec3 light = vec3(0.0);
  vec3 L = uSunDir.y > -0.1 ? uSunDir : uMoonDir;
  float cosT = dot(dir, L);
  float phase = mix(miePhase(cosT, 0.6), miePhase(cosT, -0.2), 0.3) * 4.0 * PI;
  vec3 sunC = sunRadiance(base + 300.0) + moonRadiance(base + 300.0);
  vec3 amb = texture(uAmbientLUT, vec2(0.25, 0.5)).rgb;
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + hash12(gl_FragCoord.xy + float(i)) ) * dt;
    vec3 p = uCamPos + dir * t;
    float hFrac = (p.y - base) / (top - base);
    float profile = smoothstep(0.0, 0.25, hFrac) * smoothstep(1.0, 0.45, hFrac);
    float cov = cloudCoverage(p.xz);
    float detail = fbm((p.xz + uCloudOffset * 1.6) / 600.0 + hFrac * 1.7, 4);
    float dens = clamp(cov * profile * (0.55 + detail) - 0.25 * (1.0 - cov), 0.0, 1.0) * 0.012 * (0.6 + uCloudCover);
    if (dens > 0.0001) {
      vec3 ps = p + L * 220.0;
      float occl = cloudCoverage(ps.xz) * 1.4 + (1.0 - hFrac) * 0.6;
      float beer = exp(-occl * 2.2);
      float powder = 1.0 - exp(-dens * 300.0);
      vec3 S = sunC * beer * phase * mix(1.0, powder, 0.6) + amb * (0.35 + 0.4 * hFrac) / PI;
      float sT = exp(-dens * dt);
      light += trans * S * (1.0 - sT);
      trans *= sT;
      if (trans < 0.03) break;
    }
  }
  // Fade distant cloud cover into the haze.
  float fade = exp(-dist / 60000.0);
  return vec4(light * fade, (1.0 - trans) * fade);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec3 skyDir = vec3(dir.x, max(dir.y, -0.02), dir.z);
  vec3 col = skyRadianceDir(normalize(skyDir));

  float r = R_GROUND + max(uCamPos.y, 1.0);
  vec3 Tview = hitsGround(r, dir.y) ? vec3(0.0) : texture(uTransmittanceLUT, transmittanceUV(r, dir.y)).rgb;

  // Sun disk with limb darkening.
  float cs = dot(dir, uSunDir);
  float sunR = SUN_ANGULAR_RADIUS * 1.3;
  if (cs > cos(sunR)) {
    float x = acos(clamp(cs, -1.0, 1.0)) / sunR;
    float limb = pow(max(1.0 - x * x, 0.0), 0.35);
    col += vec3(1.0, 0.98, 0.95) * SUN_ILLUMINANCE * 2500.0 * limb * Tview;
  }

  vec3 eq = transpose(uCelestial) * dir;
  vec3 night = (starField(eq) + milkyWay(eq)) * uStarBrightness;
  float twinkle = 0.75 + 0.5 * vnoise(eq.xy * 800.0 + uTime * 3.0);
  col += night * Tview * mix(1.0, twinkle, 1.0 - dir.y);
  col += moonDisk(dir) * Tview * 0.06;

  // Sodium/LED skyglow from Yuba City (E-SE) and Sacramento (S) near the horizon.
  float hz = exp(-max(dir.y, 0.0) * 22.0);
  vec2 dh = normalize(dir.xz + 1e-5);
  float yuba = pow(max(dot(dh, normalize(vec2(1.0, 0.35))), 0.0), 6.0);
  float sac = pow(max(dot(dh, normalize(vec2(0.15, 1.0))), 0.0), 10.0);
  col += vec3(1.0, 0.62, 0.32) * (yuba * 0.0016 + sac * 0.0024 + 0.0002) * hz * uNight;

  vec4 cl = cloudLayer(dir);
  col = col * (1.0 - cl.a) + cl.rgb;

  if (uFogDensity > 0.0 && uCamPos.y < uFogTop + 30.0) {
    col = applyAtmosphere(col, uCamPos + dir * 3000.0);
  }
  outColor = vec4(col, 1.0);
}
`;
