import * as THREE from 'three';
import { G } from '../render/globals';
import { lightingCommon } from '../render/shaders/lighting';

export interface SignSpec {
  text: string;
  /** Centre of the sign face. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Direction the face looks (radians, atan2 of x/z). */
  yaw: number;
  bg: string;
  fg: string;
  /** Letters glow after dark (neon, backlit). */
  glow?: boolean;
  /** Letters stacked top to bottom (blade signs). */
  vertical?: boolean;
  font?: string;
  /** Open letters on a frame (rooftop signs): background is see-through. */
  open?: boolean;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCamPos;
out vec2 vUv;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec2 dc = w.xz - uCamPos.xz;
  w.y -= dot(dc, dc) / (2.0 * 7310000.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
${lightingCommon}
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
uniform vec3 uFg;
uniform float uGlow;
uniform float uOpen;
uniform float uNightmare;
in vec2 vUv;
in vec3 vWorld;
in vec3 vNormal;
out vec4 outColor;
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture(uTex, gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y));
  if (uOpen > 0.5 && t.a < 0.5) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = t.rgb * 0.6;
  float shadow = shadowAt(vWorld + n * 0.2, 0.0012);
  vec3 col = shadeSurface(albedo, n, vWorld, 1.0, 0.6, shadow);
  // Letters light up at night; dead tubes in Nightmare.
  float letter = smoothstep(0.7, 0.95, t.a);
  float flick = mix(1.0, step(0.93, fract(uTime * 0.7 + vWorld.x)) * step(0.5, fract(uTime * 19.0)), uNightmare);
  col += uFg * uFg * letter * uGlow * uNight * uInvExposure * 0.7 * flick;
  col = applyAtmosphere(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

/** Lettered signs: rooftop and blade signs, placards over doors. */
export class Signs {
  readonly group = new THREE.Group();

  add(s: SignSpec) {
    const vertical = !!s.vertical;
    const aspect = s.w / s.h;
    const cw = vertical ? 128 : Math.min(2048, Math.round(128 * aspect));
    const ch = vertical ? Math.min(2048, Math.round(128 / aspect)) : 128;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d')!;
    // Alpha marks the letters: 1 on letters and border, 0.5 on the board, 0 on open frames.
    if (!s.open) {
      g.globalAlpha = 0.5;
      g.fillStyle = s.bg;
      g.fillRect(0, 0, cw, ch);
      g.globalAlpha = 1;
      // Border.
      g.strokeStyle = s.fg;
      g.lineWidth = Math.max(3, Math.min(cw, ch) * 0.05);
      g.strokeRect(g.lineWidth, g.lineWidth, cw - g.lineWidth * 2, ch - g.lineWidth * 2);
    }
    g.fillStyle = s.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const font = s.font ?? 'Georgia, "Times New Roman", serif';
    if (vertical) {
      const letters = [...s.text];
      const step = ch / letters.length;
      g.font = `bold ${Math.floor(Math.min(step * 0.85, cw * 0.8))}px ${font}`;
      letters.forEach((l, i) => g.fillText(l, cw / 2, step * (i + 0.5)));
    } else {
      let size = ch * (s.open ? 0.95 : 0.62);
      g.font = `bold ${size}px ${font}`;
      const tw = g.measureText(s.text).width;
      // Open letters fill their frame; boards keep a margin.
      const fit = s.open ? 0.98 : 0.9;
      if (tw > cw * fit || s.open) size *= (cw * fit) / tw;
      size = Math.min(size, ch * (s.open ? 1.1 : 0.62));
      g.font = `bold ${size}px ${font}`;
      g.fillText(s.text, cw / 2, ch / 2 + size * 0.04);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    const fg = new THREE.Color(s.fg);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...G,
        uTex: { value: tex },
        uFg: { value: new THREE.Vector3(fg.r, fg.g, fg.b) },
        uGlow: { value: s.glow ? 1 : 0.15 },
        uOpen: { value: s.open ? 1 : 0 },
      },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.yaw;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  }
}
