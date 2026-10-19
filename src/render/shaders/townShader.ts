import { lightingCommon } from './lighting';

/** Surface styles baked into aColor.w for the town meshes. */
export const STYLE = {
  STUCCO: 0, // painted stucco or plaster, punched windows
  BRICK: 1, // downtown brick block: shopfronts, tall upper windows, cornice
  MODERN: 2, // stores and offices: ribbon windows, plain panels
  CHURCH: 3, // white stucco with lancet stained glass
  ROOF_FLAT: 4,
  ROOF_SHINGLE: 5,
  ROOF_TILE: 6, // clay barrel tile
  ROOF_METAL: 7,
  CONCRETE: 8,
  STEEL: 9,
  RAILING: 10,
  BALLAST: 11,
  ROSE: 12, // rose window: glows at night
  LACQUER: 13, // Bok Kai porch red
  DECK: 14,
  SPIRE: 15,
  SIDING: 16, // painted lap siding on houses
  HOTEL: 17, // concrete hotel: regular window grid
} as const;

export const townVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
in vec4 aColor;   // rgb, style
in vec4 aFacade;  // u along wall (m), v above wall base (m), storey height (m), storeys
#ifdef SHADOW_PASS
uniform mat4 uShadowMatrix;
out float vShadowZ;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec4 vFacade;
flat out vec4 vColor;

void main() {
  vec3 world = position;
  vWorld = world;
  vNormal = normal;
  vFacade = aFacade;
  vColor = aColor;
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

export const townFragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
in vec3 vWorld;
in vec3 vNormal;
in vec4 vFacade;
flat in vec4 vColor;
#ifdef SHADOW_PASS
in float vShadowZ;
#endif
out vec4 outColor;

/** Warm interior light, with the odd TV. */
vec3 roomLight(vec2 id) {
  vec3 warm = mix(vec3(1.0, 0.45, 0.14), vec3(0.95, 0.68, 0.4), hash12(id + 3.7));
  float tv = step(0.94, hash12(id + 7.1));
  return mix(warm, vec3(0.45, 0.6, 1.0) * (0.6 + 0.4 * sin(uTime * 9.0 + id.x * 4.0)), tv);
}

void main() {
  #include <logdepthbuf_fragment>
#ifdef SHADOW_PASS
  outColor = vec4(vShadowZ, 0.0, 0.0, 1.0);
  return;
#endif
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float style = vColor.w;
  vec3 albedo = vColor.rgb * 0.55;
  float rough = 0.85;
  vec3 emit = vec3(0.0);
  float u = vFacade.x;
  float v = vFacade.y;
  float storey = vFacade.z;
  float storeys = vFacade.w;
  bool wall = abs(n.y) < 0.5;
  float fp = length(fwidth(vWorld));
  vec2 cellSeed = floor(vWorld.xz / 9.0);
  float night = uNight * uInvExposure * 0.45;

  if (style < 0.5 || (style > 15.5 && style < 16.5) || (style > 16.5 && style < 17.5)) {
    // Houses, apartments, the hotel: punched windows on a storey grid.
    if (style > 15.5 && style < 16.5) albedo *= 1.0 - 0.12 * smoothstep(0.75, 0.95, fract(v / 0.2)) * smoothstep(0.12, 0.04, fp);
    if (wall && storey > 0.0) {
      bool hotel = style > 16.5;
      float spacing = hotel ? 2.4 : 3.3;
      vec2 cell = vec2(u / spacing, v / storey);
      vec2 f = fract(cell);
      vec2 id = floor(cell);
      float w0 = hotel ? 0.28 : 0.3, w1 = hotel ? 0.72 : 0.7;
      bool win = f.x > w0 && f.x < w1 && f.y > 0.3 && f.y < 0.8 && id.y < storeys && v > 0.6;
      if (win) {
        albedo = vec3(0.035, 0.045, 0.055);
        rough = 0.15;
        float lit = step(hotel ? 0.8 : 0.62, hash12(id + cellSeed * 3.1));
        emit = roomLight(id + cellSeed) * roomLight(id) * lit * night * 0.5;
        if (lit > 0.5) albedo *= 0.2;
      } else if (f.y > 0.26 && f.y < 0.3 && f.x > w0 - 0.04 && f.x < w1 + 0.04 && id.y < storeys) {
        albedo = vec3(0.6) * 0.55; // sill
      }
    }
  } else if (style < 1.5) {
    // Gold Rush brick: shopfronts, tall sash windows above, corbelled cornice.
    float top = 4.8 + (storeys - 1.0) * 4.0;
    float by = v / 0.077;
    float bx = u / 0.21 + 0.5 * mod(floor(by), 2.0);
    float mortar = max(step(0.86, fract(by)), step(0.93, fract(bx))) * smoothstep(0.05, 0.015, fp);
    albedo *= 0.9 + 0.2 * hash12(floor(vec2(bx, by))) * smoothstep(0.08, 0.03, fp);
    albedo = mix(albedo, vec3(0.42, 0.40, 0.36) * 0.55, mortar * 0.6);
    if (wall) {
      if (v < 4.2) {
        // Shopfront bays between brick piers, with transoms above the doors.
        float bay = fract(u / 6.2);
        bool pier = bay < 0.07 || bay > 0.93;
        if (!pier && v > 0.45 && v < 3.3) {
          albedo = vec3(0.03, 0.035, 0.04);
          rough = 0.08;
          vec2 id = vec2(floor(u / 6.2), 0.0) + cellSeed;
          float open = step(0.25, hash12(id));
          vec3 shop = mix(vec3(1.0, 0.66, 0.36), vec3(0.95, 0.84, 0.66), hash12(id + 1.3));
          emit = shop * shop * open * night * (0.3 + 0.25 * smoothstep(3.3, 0.5, v));
          emit = max(emit, vec3(1.0, 0.8, 0.55) * 0.05 * (1.0 - uNight) * open);
        } else if (!pier && v >= 3.3 && v < 3.9) {
          // Signboard; some carry neon after dark.
          vec2 id = vec2(floor(u / 6.2), 1.0) + cellSeed;
          float h = hash12(id);
          albedo = mix(vec3(0.12, 0.09, 0.07), vec3(0.5, 0.42, 0.3), h) * 0.55;
          float neonBand = step(0.4, h) * step(abs(fract(u / 6.2) - 0.5), 0.36) * step(abs(v - 3.6), 0.2);
          vec3 neon = h > 0.85 ? vec3(1.0, 0.15, 0.45) : h > 0.7 ? vec3(0.2, 0.55, 1.0) : vec3(1.0, 0.3, 0.08);
          float flick = 0.85 + 0.15 * step(0.1, fract(uTime * 0.37 + h * 7.0));
          emit += neon * neonBand * night * 2.4 * flick;
        }
      } else if (v < top - 0.3) {
        float up = v - 4.2;
        vec2 cell = vec2(u / 2.6, up / 4.0);
        vec2 f = fract(cell);
        vec2 id = floor(cell);
        bool win = f.x > 0.28 && f.x < 0.72 && f.y > 0.18 && f.y < 0.82 && id.y < storeys - 1.0;
        // Segmental arches over the sash windows.
        float arch = f.y - 0.82 - 0.06 * (1.0 - pow((f.x - 0.5) / 0.22, 2.0));
        if (win || (f.x > 0.28 && f.x < 0.72 && arch < 0.0 && f.y > 0.8 && id.y < storeys - 1.0)) {
          albedo = vec3(0.035, 0.04, 0.05);
          rough = 0.12;
          float lit = step(0.6, hash12(id + cellSeed * 1.7));
          emit = roomLight(id + cellSeed) * lit * night * 0.35;
        }
      } else {
        // Cornice and parapet cap.
        float c = fract((v - top) / 0.35);
        albedo *= 0.75 + 0.35 * step(0.5, c);
        if (v > top + 0.6) albedo = mix(albedo, vec3(0.7, 0.66, 0.6) * 0.55, 0.6);
      }
    }
  } else if (style < 2.5) {
    // Stores and offices: a glass band at street level, plain panels above.
    if (wall) {
      float bay = fract(u / 8.0);
      if (v > 0.4 && v < 3.0 && bay > 0.1 && bay < 0.9 && hash12(floor(vec2(u / 24.0, 0.0)) + cellSeed) > 0.45) {
        albedo = vec3(0.03, 0.04, 0.05);
        rough = 0.1;
        emit = vec3(0.92, 0.86, 0.74) * night * 0.24 * step(0.3, hash12(cellSeed + floor(u / 24.0)));
      } else if (storeys > 1.5 && v > 3.6 && fract((v - 3.6) / 3.6) > 0.35 && fract((v - 3.6) / 3.6) < 0.8 && v < storeys * 3.6) {
        albedo = vec3(0.04, 0.05, 0.06);
        rough = 0.15;
        emit = vec3(0.9, 0.95, 1.0) * night * 0.2 * step(0.6, hash12(floor(vec2(u / 3.0, v / 3.6)) + cellSeed));
      } else {
        albedo *= 0.94 + 0.06 * step(0.5, fract(u / 1.2));
      }
    }
  } else if (style < 3.5) {
    // Church walls: lancet windows in the bays between the buttresses.
    if (wall && storey > 0.0) {
      float bay = fract(u / storey);
      float x = (bay - 0.5) * storey;
      float hw = 0.75;
      float spring = vFacade.w * 0.72;
      float apex = spring + hw * 1.7;
      float r = abs(x);
      bool inLancet = r < hw && v > 2.2 && (v < spring || (v < apex && length(vec2(r + hw, v - spring)) < hw * 2.0));
      if (inLancet) {
        vec2 id = floor(vec2(u / storey, 0.0));
        vec3 glass = mix(vec3(0.15, 0.25, 0.75), vec3(0.75, 0.15, 0.12), step(0.5, fract((v * 2.0 + x * 3.0) * 0.6)));
        glass = mix(glass, vec3(0.85, 0.7, 0.2), step(0.75, hash12(floor(vec2(x * 4.0, v * 3.0)) + id)));
        albedo = glass * 0.08;
        rough = 0.1;
        emit = glass * night * 0.9;
      }
    }
  } else if (style < 4.5) {
    // Flat roofs: tar and gravel, membrane patches, HVAC grime.
    albedo *= 0.75 + 0.35 * vnoise(vWorld.xz * 0.35) + 0.1 * (vnoise(vWorld.xz * 3.0) - 0.5) * smoothstep(0.5, 0.1, fp);
  } else if (style < 5.5) {
    // Composition shingles in courses.
    float course = fract(vWorld.y / 0.14);
    albedo *= 0.82 + 0.3 * vnoise(vWorld.xz * 1.3);
    albedo *= 1.0 - 0.25 * smoothstep(0.8, 1.0, course) * smoothstep(0.08, 0.02, fp);
  } else if (style < 6.5) {
    // Clay barrel tile: rounded runs down the slope.
    float run = 0.5 + 0.5 * cos(u / 0.2 * 6.2832);
    albedo *= mix(0.7, 1.1, run * smoothstep(0.1, 0.03, fp) + (1.0 - smoothstep(0.1, 0.03, fp)) * 0.6);
    albedo *= 0.9 + 0.2 * vnoise(vWorld.xz * 2.0);
    rough = 0.7;
  } else if (style < 7.5) {
    rough = 0.38;
    albedo *= 0.9 + 0.1 * sin(u * 6.0 * 3.1416);
  } else if (style < 8.5) {
    // Board-formed concrete, streaked by the rain.
    albedo *= 0.88 + 0.16 * vnoise(vec2(u * 0.6, v * 4.0)) - 0.08 * smoothstep(0.6, 0.9, vnoise(vec2(u * 2.0, v * 0.2)));
    rough = 0.9;
  } else if (style < 9.5) {
    rough = 0.45;
    albedo *= 0.85 + 0.25 * vnoise(vWorld.xz * 0.8 + vWorld.y);
  } else if (style < 10.5) {
    rough = 0.5;
  } else if (style < 11.5) {
    // Ties across the rails.
    albedo *= 0.7 + 0.5 * step(0.45, fract(u / 0.6)) + 0.2 * vnoise(vWorld.xz * 4.0);
  } else if (style < 12.5) {
    // Rose window: tracery wheel of coloured glass.
    vec2 q = vFacade.xy;
    float rr = length(q);
    float a = atan(q.y, q.x);
    float spoke = smoothstep(0.08, 0.02, abs(fract(a / 6.2832 * 12.0) - 0.5) * rr);
    vec3 glass = mix(vec3(0.15, 0.2, 0.8), vec3(0.85, 0.2, 0.15), step(0.5, fract(rr * 2.5)));
    glass = mix(glass, vec3(0.9, 0.75, 0.25), smoothstep(0.35, 0.2, rr));
    float lead = max(spoke, smoothstep(0.9, 1.0, rr));
    albedo = mix(glass * 0.08, vec3(0.6) * 0.55, lead);
    rough = 0.15;
    emit = glass * (1.0 - lead) * night * 1.1;
  } else if (style < 13.5) {
    rough = 0.35;
  } else if (style < 14.5) {
    albedo *= 0.85 + 0.25 * vnoise(vWorld.xz * 1.5);
    rough = 0.8;
  } else if (style < 15.5) {
    // Painted spire: lit from below at night.
    rough = 0.6;
    emit = vec3(0.95, 0.95, 1.0) * 0.08 * night * smoothstep(40.0, 15.0, v);
  }

  float shadow = shadowAt(vWorld + n * 0.3, 0.0012);
  float ao = mix(0.65, 1.0, clamp(v * 0.6, 0.0, 1.0));
  if (!wall) ao = 1.0;
  vec3 col = shadeSurface(albedo, n, vWorld, ao, rough, shadow) + emit;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
