import * as THREE from 'three';

/**
 * Uniforms shared by every custom material. Materials reference these exact
 * objects, so updating a value here updates the whole scene.
 */
export const G = {
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonIllum: { value: 0.5 }, // illuminated fraction of the lunar disk
  uMoonPhaseAngle: { value: 0 },
  uCelestial: { value: new THREE.Matrix3() }, // equatorial -> local horizon frame
  uMieScale: { value: 1 },
  uFogTop: { value: -1000 }, // tule fog layer top (m MSL); below ground = disabled
  uFogDensity: { value: 0 },
  uCloudCover: { value: 0.25 },
  uCloudOffset: { value: new THREE.Vector2() },
  uWind: { value: new THREE.Vector2(2.5, 1.0) },
  uNight: { value: 0 }, // 0 day .. 1 full night, drives emissive lights
  uInvExposure: { value: 1 }, // emissive sources are authored in display units
  uSeason: { value: new THREE.Vector4(0, 0, 1, 0) }, // winter, spring, summer, fall weights
  uYearPhase: { value: 0.5 }, // 0 = Jan 1 .. 1 = Dec 31
  uTransmittanceLUT: { value: null as THREE.Texture | null },
  uSkyViewLUT: { value: null as THREE.Texture | null },
  uMoonViewLUT: { value: null as THREE.Texture | null },
  uAmbientLUT: { value: null as THREE.Texture | null },
  uMoonScale: { value: 0 },
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uTerrainShadow: { value: null as THREE.Texture | null },
  uTerrainShadowSize: { value: 22000 },
  uHeadPos: { value: new THREE.Vector3() }, // player truck headlights
  uHeadDir: { value: new THREE.Vector3(1, 0, 0) },
  uHeadOn: { value: 0 },
  uWet: { value: 0 }, // 0 dry .. 1 soaked ground, puddles standing
  uSnowCover: { value: 0 }, // 0 bare .. 1 full blanket of snow
  uRain: { value: 0 }, // current rainfall intensity 0..1
  uSnowFall: { value: 0 }, // current snowfall intensity 0..1
  uFlash: { value: 0 }, // lightning flash brightness (display units)
};

export type GlobalUniforms = typeof G;
