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
  SCHOOL: 18, // Marysville High: brick with arched windows on every floor
  DOOR: 19, // panelled front door
  GARAGE: 20, // sectional garage door
  CHIMNEY: 21, // plain brick
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
uniform float uNightmare;
out vec4 outColor;

/** Nightmare: rough horizontal boards nailed over a window. */
vec3 boards(float v, vec2 id) {
  float row = floor(v / 0.21);
  float gap = step(0.86, fract(v / 0.21));
  vec3 wood = vec3(0.30, 0.24, 0.17) * 0.55 * (0.65 + 0.45 * hash12(vec2(row, id.x * 7.0 + id.y)));
  return mix(wood, vec3(0.006), gap);
}

/** Nightmare: most rooms dark; the odd one with a cold light that will not hold steady. */
vec3 nightmareRoom(vec2 id, float night) {
  float h = hash12(id + 17.3);
  float flick = step(0.35, fract(sin(floor(uTime * (7.0 + h * 9.0)) * 91.7 + h * 57.0) * 43758.5453));
  return vec3(0.5, 0.62, 0.5) * step(0.965, h) * night * 0.3 * flick;
}

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

  if (style > 18.5) {
    if (style < 19.5) {
      // Panelled door: rails and stiles, a glass lite up top on some, brass knob.
      float h = hash12(floor(vWorld.xz * 0.5));
      float pu = u / 1.0, pv = v / 2.15;
      float frame = min(min(pu, 1.0 - pu), min(pv, 1.0 - pv) * 2.15);
      float rail = step(0.14, frame);
      float panel = step(0.12, abs(fract(pv * 2.0) - 0.5)) * step(0.12, abs(fract(pu * 2.0) - 0.5) * 0.5 + 0.06);
      albedo *= mix(0.78, 1.0, rail * (1.0 - 0.25 * (1.0 - panel)));
      if (h > 0.5 && pv > 0.68 && pv < 0.92 && pu > 0.18 && pu < 0.82) {
        albedo = vec3(0.03);
        rough = 0.05;
        emit = vec3(1.0, 0.7, 0.4) * night * 0.4;
      }
      if (length(vec2((pu - 0.82) * 1.0, (pv - 0.45) * 2.15)) < 0.04) { albedo = vec3(0.6, 0.48, 0.2) * 0.55; rough = 0.25; }
    } else if (style < 20.5) {
      // Sectional garage door: four horizontal sections with raised panels.
      float sec = fract(v / 0.575);
      albedo *= 1.0 - 0.3 * smoothstep(0.9, 1.0, sec) * smoothstep(0.08, 0.02, fp);
      albedo *= 1.0 - 0.1 * step(0.15, fract(u / 1.25)) * step(fract(u / 1.25), 0.2);
    } else {
      float by = v / 0.077;
      float bx = u / 0.21 + 0.5 * mod(floor(by), 2.0);
      float mortar = max(step(0.86, fract(by)), step(0.93, fract(bx))) * smoothstep(0.05, 0.015, fp);
      albedo *= 0.85 + 0.25 * hash12(floor(vec2(bx, by)));
      albedo = mix(albedo, vec3(0.42, 0.40, 0.36) * 0.55, mortar * 0.6);
    }
  } else if (style < 0.5 || (style > 15.5 && style < 17.5)) {
    // Houses, apartments, the hotel: framed sash windows on a storey grid.
    bool hotel = style > 16.5;
    bool siding = style > 15.5 && style < 16.5;
    float aa = smoothstep(0.12, 0.04, fp);
    if (siding) albedo *= 1.0 - 0.14 * smoothstep(0.72, 0.95, fract(v / 0.2)) * aa;
    else albedo *= 0.93 + 0.1 * vnoise(vec2(u, v) * 1.3);
    // Trim: crisp white on Victorians, white or chocolate on stucco.
    float th = hash12(cellSeed + 0.7);
    vec3 trim = (siding || th < 0.6) ? vec3(0.92, 0.91, 0.87) * 0.55 : vec3(0.32, 0.24, 0.18) * 0.55;
    if (wall && !hotel && v < 0.45 && v > -2.0) {
      // Concrete foundation.
      albedo = vec3(0.5, 0.49, 0.46) * 0.55 * (0.88 + 0.18 * vnoise(vec2(u, v) * 7.0));
    } else if (wall && storey > 0.0) {
      float spacing = hotel ? 2.4 : siding ? 2.9 : 3.4;
      vec2 cell = vec2(u / spacing, v / storey);
      vec2 f = fract(cell);
      vec2 id = floor(cell);
      float col = hash12(vec2(id.x, 3.0) + cellSeed * 1.3);
      bool blank = !hotel && col < 0.28;
      float wide = (!hotel && col > 0.82) ? 0.12 : 0.0;
      float w0 = (hotel ? 0.28 : siding ? 0.34 : 0.3) - wide, w1 = 1.0 - w0;
      float y0 = siding ? 0.24 : 0.3, y1 = siding ? 0.86 : 0.8;
      float tx = 0.1 / spacing, ty = 0.1 / storey;
      bool rows = id.y < storeys && v > 0.6 && !blank;
      bool win = rows && f.x > w0 && f.x < w1 && f.y > y0 && f.y < y1;
      bool frame = rows && f.x > w0 - tx && f.x < w1 + tx && f.y > y0 - ty * 1.8 && f.y < y1 + ty;
      float sw = (w1 - w0) * 0.42;
      bool shutter = !hotel && siding && rows && th > 0.35 && f.y > y0 && f.y < y1 && ((f.x > w0 - tx - sw && f.x < w0 - tx) || (f.x > w1 + tx && f.x < w1 + tx + sw));
      if (win) {
        vec2 g = vec2((f.x - w0) / (w1 - w0), (f.y - y0) / (y1 - y0));
        float lit = step(hotel ? 0.8 : 0.62, hash12(id + cellSeed * 3.1));
        // Meeting rail and muntins (two-over-two sash).
        float mx = hotel ? 9.0 : abs(g.x - 0.5) * (w1 - w0) * spacing;
        float my = abs(g.y - 0.5) * (y1 - y0) * storey;
        bool bar = aa > 0.3 && (my < 0.035 || mx < 0.025);
        if (bar) {
          albedo = trim;
        } else {
          vec3 V = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
          vec3 inside = vec3(0.03, 0.032, 0.035);
          // Curtains and blinds catch a little daylight.
          float ch = hash12(id + cellSeed * 2.1);
          if (ch > 0.45 && (g.x < 0.2 || g.x > 0.8)) inside = mix(vec3(0.5, 0.42, 0.32), vec3(0.75, 0.72, 0.65), fract(ch * 7.0)) * 0.25;
          else if (ch < 0.2 && g.y > 0.55) inside = vec3(0.7, 0.68, 0.62) * 0.2 * (0.8 + 0.2 * step(0.5, fract(g.y * 14.0)));
          albedo = inside;
          rough = 0.06;
          emit = roomLight(id + cellSeed) * roomLight(id) * lit * night * 0.5;
          if (lit > 0.5) albedo *= 0.2;
          // The sky and street mirrored in the glass.
          emit += skyRadianceDir(reflect(-V, n)) * (0.05 + 0.55 * fres) * (1.0 - lit * night * 4.0);
        }
        if (uNightmare > 0.0) {
          vec2 bid = id + cellSeed * 5.3;
          emit = mix(emit, nightmareRoom(bid, night), uNightmare);
          if (hash12(bid) < 0.5) {
            albedo = mix(albedo, boards(v, bid), uNightmare);
            rough = mix(rough, 0.9, uNightmare);
            emit *= 1.0 - uNightmare;
          }
        }
      } else if (frame) {
        albedo = trim;
        // Projecting sill.
        if (f.y < y0) albedo *= 0.85;
      } else if (shutter) {
        vec3 sc = th > 0.8 ? vec3(0.08, 0.2, 0.12) : th > 0.6 ? vec3(0.05, 0.05, 0.06) : vec3(0.1, 0.14, 0.26);
        albedo = sc * (0.9 + 0.2 * step(0.5, fract(v / 0.12))) * 0.55;
      }
    }
  } else if (style < 1.5 || style > 17.5) {
    // Gold Rush brick: shopfronts, tall sash windows above, corbelled cornice.
    // The school is the same brick with arched windows from the ground up.
    bool school = style > 17.5;
    float top = school ? 0.6 + storeys * 4.0 : 4.8 + (storeys - 1.0) * 4.0;
    float by = v / 0.077;
    float bx = u / 0.21 + 0.5 * mod(floor(by), 2.0);
    float mortar = max(step(0.86, fract(by)), step(0.93, fract(bx))) * smoothstep(0.05, 0.015, fp);
    albedo *= 0.9 + 0.2 * hash12(floor(vec2(bx, by))) * smoothstep(0.08, 0.03, fp);
    albedo = mix(albedo, vec3(0.42, 0.40, 0.36) * 0.55, mortar * 0.6);
    if (wall) {
      if (v < 4.2 && !school) {
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
          if (uNightmare > 0.0) {
            emit = mix(emit, nightmareRoom(id, night), uNightmare);
            if (hash12(id + 2.9) < 0.6) albedo = mix(albedo, boards(v, id), uNightmare);
          }
        } else if (!pier && v >= 3.3 && v < 3.9) {
          // Signboard; some carry neon after dark.
          vec2 id = vec2(floor(u / 6.2), 1.0) + cellSeed;
          float h = hash12(id);
          albedo = mix(vec3(0.12, 0.09, 0.07), vec3(0.5, 0.42, 0.3), h) * 0.55;
          float neonBand = step(0.4, h) * step(abs(fract(u / 6.2) - 0.5), 0.36) * step(abs(v - 3.6), 0.2);
          vec3 neon = h > 0.85 ? vec3(1.0, 0.15, 0.45) : h > 0.7 ? vec3(0.2, 0.55, 1.0) : vec3(1.0, 0.3, 0.08);
          float flick = 0.85 + 0.15 * step(0.1, fract(uTime * 0.37 + h * 7.0));
          // Dead tubes that catch for an instant, then die again.
          flick *= mix(1.0, step(0.96, fract(uTime * 0.9 + h * 13.0)) * step(0.5, fract(uTime * 23.0)), uNightmare);
          emit += neon * neonBand * night * 2.4 * flick;
        }
      } else if (v < top - 0.3) {
        float up = v - (school ? 0.6 : 4.2);
        float rows = school ? storeys : storeys - 1.0;
        vec2 cell = vec2(u / 2.6, up / 4.0);
        vec2 f = fract(cell);
        vec2 id = floor(cell);
        bool win = up > 0.0 && f.x > 0.28 && f.x < 0.72 && f.y > 0.18 && f.y < 0.82 && id.y < rows;
        // Segmental arches over the sash windows.
        float arch = f.y - 0.82 - 0.06 * (1.0 - pow((f.x - 0.5) / 0.22, 2.0));
        if (win || (up > 0.0 && f.x > 0.28 && f.x < 0.72 && arch < 0.0 && f.y > 0.8 && id.y < rows)) {
          albedo = vec3(0.035, 0.04, 0.05);
          rough = 0.12;
          float lit = step(0.6, hash12(id + cellSeed * 1.7));
          emit = roomLight(id + cellSeed) * lit * night * 0.35;
          if (uNightmare > 0.0) {
            emit = mix(emit, nightmareRoom(id + cellSeed, night), uNightmare);
            if (hash12(id + cellSeed * 2.3) < 0.45) albedo = mix(albedo, boards(up, id + cellSeed), uNightmare);
          }
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
        emit = vec3(0.92, 0.86, 0.74) * night * 0.24 * step(0.3, hash12(cellSeed + floor(u / 24.0))) * (1.0 - uNightmare);
      } else if (storeys > 1.5 && v > 3.6 && fract((v - 3.6) / 3.6) > 0.35 && fract((v - 3.6) / 3.6) < 0.8 && v < storeys * 3.6) {
        albedo = vec3(0.04, 0.05, 0.06);
        rough = 0.15;
        emit = vec3(0.9, 0.95, 1.0) * night * 0.2 * step(0.6, hash12(floor(vec2(u / 3.0, v / 3.6)) + cellSeed)) * (1.0 - uNightmare);
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
        emit = glass * night * 0.9 * (1.0 - 0.92 * uNightmare);
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
    emit = glass * (1.0 - lead) * night * 1.1 * (1.0 - 0.92 * uNightmare);
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

  if (uNightmare > 0.0) {
    // Years of neglect: rain streaks, peeling paint, damp rising from the ground.
    float streak = vnoise(vec2(u * 0.9 + 3.0 * vnoise(vec2(u * 0.2, 0.0)), v * 0.18));
    float peel = smoothstep(0.66, 0.72, vnoise(vec2(u, v) * 4.5 + vWorld.xz * 0.05)) * smoothstep(0.1, 0.03, fp);
    vec3 aged = mix(albedo, vec3(dot(albedo, vec3(0.333))), 0.65) * (0.35 + 0.35 * streak);
    if (wall) {
      aged = mix(aged, vec3(0.13, 0.12, 0.10) * 0.55, peel * 0.5);
      aged *= mix(0.5, 1.0, smoothstep(0.0, 1.6, v));
    }
    albedo = mix(albedo, aged, uNightmare);
  }

  float shadow = shadowAt(vWorld + n * 0.3, 0.0012);
  float ao = mix(0.65, 1.0, clamp(v * 0.6, 0.0, 1.0));
  if (!wall) ao = 1.0;
  vec3 col = shadeSurface(albedo, n, vWorld, ao, rough, shadow) + emit;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;
