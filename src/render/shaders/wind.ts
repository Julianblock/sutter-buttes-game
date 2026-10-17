/**
 * Shared gust field: elongated cross-wind bands of stronger air advected
 * downwind, so grass, crops and trees all respond to the same gusts.
 * Requires noiseCommon, uWind and uTime.
 */
export const windCommon = /* glsl */ `
#ifndef WIND_COMMON
#define WIND_COMMON
vec2 windDir() {
  float ws = length(uWind);
  return ws > 0.01 ? uWind / ws : vec2(1.0, 0.0);
}

/** 0..1 gust strength at a ground position. */
float windGust(vec2 xz) {
  vec2 d = windDir();
  float ws = length(uWind);
  vec2 p = xz - uWind * uTime * 1.3;
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  float g = vnoise(q / vec2(14.0, 38.0)) * 0.6 + vnoise(q / vec2(4.5, 9.0) + 7.3) * 0.4;
  return smoothstep(0.3, 0.85, g) * smoothstep(0.2, 2.5, ws);
}
#endif
`;
