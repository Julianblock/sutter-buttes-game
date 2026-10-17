// Physically based single-scattering atmosphere (Bruneton / Hillaire style) with
// ozone absorption and an approximate multiple-scattering term. Distances in metres.
export const atmosphereCommon = /* glsl */ `
#ifndef ATMOSPHERE_COMMON
#define ATMOSPHERE_COMMON

#define PI 3.141592653589793
const float R_GROUND = 6360000.0;
const float R_TOP = 6460000.0;
const vec3 RAYLEIGH_SCAT = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float RAYLEIGH_H = 8000.0;
const float MIE_SCAT = 3.996e-6;
const float MIE_EXT = 4.440e-6;
const float MIE_H = 1200.0;
const vec3 OZONE_ABS = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float SUN_ILLUMINANCE = 20.0;
const float SUN_ANGULAR_RADIUS = 0.004675;

uniform float uMieScale;   // weather haze multiplier (1 = clear valley air)

float rayleighDensity(float h) { return exp(-max(h, 0.0) / RAYLEIGH_H); }
float mieDensity(float h) { return exp(-max(h, 0.0) / MIE_H); }
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }

vec3 extinctionAt(float h) {
  return RAYLEIGH_SCAT * rayleighDensity(h)
       + vec3(MIE_EXT * uMieScale) * mieDensity(h)
       + OZONE_ABS * ozoneDensity(h);
}

float distanceToTop(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

float distanceToGround(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + R_GROUND * R_GROUND;
  return max(0.0, -r * mu - sqrt(max(disc, 0.0)));
}

bool hitsGround(float r, float mu) {
  return mu < 0.0 && r * r * (mu * mu - 1.0) + R_GROUND * R_GROUND >= 0.0;
}

// Transmittance LUT parameterisation (Bruneton 2017).
vec2 transmittanceUV(float r, float mu) {
  float H = sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND);
  float rho = sqrt(max(0.0, r * r - R_GROUND * R_GROUND));
  float d = distanceToTop(r, mu);
  float dMin = R_TOP - r;
  float dMax = rho + H;
  return vec2((d - dMin) / (dMax - dMin), rho / H);
}

void transmittanceRMu(vec2 uv, out float r, out float mu) {
  float H = sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND);
  float rho = H * uv.y;
  r = sqrt(rho * rho + R_GROUND * R_GROUND);
  float dMin = R_TOP - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}

float rayleighPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }

float miePhase(float c, float g) {
  float g2 = g * g;
  float k = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

// Sky-view LUT parameterisation (Hillaire 2020): dense near the horizon and the sun.
vec2 skyViewUV(float r, float viewZenithCos, float lightViewCos) {
  float vHorizon = sqrt(max(0.0, r * r - R_GROUND * R_GROUND));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float vza = acos(clamp(viewZenithCos, -1.0, 1.0));
  vec2 uv;
  if (vza < zenithHorizon) {
    float c = vza / zenithHorizon;
    c = 1.0 - sqrt(max(0.0, 1.0 - c));
    uv.y = c * 0.5;
  } else {
    float c = (vza - zenithHorizon) / beta;
    uv.y = sqrt(clamp(c, 0.0, 1.0)) * 0.5 + 0.5;
  }
  uv.x = sqrt(clamp(-lightViewCos * 0.5 + 0.5, 0.0, 1.0));
  return uv;
}

#endif
`;
