import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Final tone map + photographic grade + sRGB encode. */
export function createGradePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSaturation: { value: 1.08 },
      uContrast: { value: 1.1 },
      uVignette: { value: 0.28 },
      uNight: { value: 0 },
      uNightmare: { value: 0 },
      uTime: { value: 0 },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uSaturation;
      uniform float uContrast;
      uniform float uVignette;
      uniform float uNight;
      uniform float uNightmare;
      uniform float uTime;
      uniform vec3 uLift;
      varying vec2 vUv;

      // ACES fitted (Stephen Hill), applied in ACEScg-ish space.
      const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      vec3 rrtOdt(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 c) { return clamp(ACESOut * rrtOdt(ACESIn * c), 0.0, 1.0); }

      vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        // Scotopic shift: at night colour vision fades and shifts towards blue.
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 scotopic = vec3(0.55, 0.68, 1.0) * lum * 1.1;
        c = mix(c, scotopic, uNight * 0.65);

        c = aces(c * 1.6);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c += uLift * (1.0 - c);

        vec2 q = vUv - 0.5;
        c *= 1.0 - uVignette * dot(q, q) * 1.6;
        if (uNightmare > 0.0) {
          // Drained, sickly cold, closing in from the edges, with film grain.
          float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec3 sick = vec3(g) * vec3(0.86, 0.98, 0.92) + vec3(0.0, 0.004, 0.006);
          vec3 n = c;
          n = mix(n, sick, 0.75);
          n *= 1.0 - 0.75 * smoothstep(0.05, 0.6, dot(q, q) * 1.6);
          float grain = fract(sin(dot(vUv * 731.0 + floor(uTime * 24.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          n += grain * 0.035 * (0.4 + g);
          c = mix(c, max(n, 0.0), uNightmare);
        }

        c = toSRGB(max(c, 0.0));
        // Contrast in perceptual space so it doesn't crush shadow detail.
        c = clamp((c - 0.45) * uContrast + 0.45, 0.0, 1.0);
        // Triangular dither to kill banding in skies.
        float n = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        float n2 = fract(sin(dot(vUv * 1000.0 + uTime + 0.5, vec2(39.3468, 11.135))) * 24634.6345);
        c += (n + n2 - 1.0) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}
