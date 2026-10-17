import * as THREE from 'three';
import type { HeightGrid, Pixels, WorldData } from './loader';
import { LC } from './meta';

export interface WorldTextures {
  heightInner: THREE.DataTexture;
  heightMid: THREE.DataTexture;
  heightFar: THREE.DataTexture;
  imgInner: THREE.Texture;
  imgMid: THREE.Texture;
  imgFar: THREE.Texture;
  /** R rice, G orchard, B natural grass/woodland, A water/wetland */
  maskA: THREE.DataTexture;
  /** R almond, G stone fruit, B urban, A wetland (seasonal flooding) */
  maskB: THREE.DataTexture;
  canopy: THREE.DataTexture;
}

function heightTexture(g: HeightGrid): THREE.DataTexture {
  const data = new Float32Array(g.res * g.res * 2);
  for (let i = 0; i < g.res * g.res; i++) {
    data[i * 2] = g.heights[i];
    data[i * 2 + 1] = g.ao[i];
  }
  const t = new THREE.DataTexture(data, g.res, g.res, THREE.RGFormat, THREE.FloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function imageTexture(bmp: ImageBitmap, anisotropy: number): THREE.Texture {
  const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = anisotropy;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function maskTextures(lc: Pixels): [THREE.DataTexture, THREE.DataTexture] {
  const n = lc.width * lc.height;
  const a = new Uint8Array(n * 4);
  const b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = lc.data[i * 4];
    const o = i * 4;
    a[o] = c === LC.RICE ? 255 : 0;
    a[o + 1] = c === LC.WALNUT || c === LC.ALMOND || c === LC.FRUIT ? 255 : 0;
    a[o + 2] = c === LC.GRASS || c === LC.WOODLAND || c === LC.HAY ? 255 : 0;
    a[o + 3] = c === LC.WATER ? 255 : 0;
    b[o] = c === LC.ALMOND ? 255 : 0;
    b[o + 1] = c === LC.FRUIT ? 255 : 0;
    b[o + 2] = c >= LC.URBAN_LOW && c <= LC.URBAN_HIGH ? 255 : 0;
    b[o + 3] = c === LC.WETLAND ? 255 : 0;
  }
  const make = (d: Uint8Array) => {
    const t = new THREE.DataTexture(d, lc.width, lc.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return [make(a), make(b)];
}

export function createWorldTextures(world: WorldData, renderer: THREE.WebGLRenderer): WorldTextures {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const [maskA, maskB] = maskTextures(world.landcover);
  const cd = new Uint8Array(world.canopy.width * world.canopy.height);
  for (let i = 0; i < cd.length; i++) cd[i] = world.canopy.data[i * 4];
  const canopy = new THREE.DataTexture(cd, world.canopy.width, world.canopy.height, THREE.RedFormat, THREE.UnsignedByteType);
  canopy.minFilter = canopy.magFilter = THREE.LinearFilter;
  canopy.needsUpdate = true;
  return {
    heightInner: heightTexture(world.heights.inner),
    heightMid: heightTexture(world.heights.mid),
    heightFar: heightTexture(world.heights.far),
    imgInner: imageTexture(world.imagery.inner, aniso),
    imgMid: imageTexture(world.imagery.mid, aniso),
    imgFar: imageTexture(world.imagery.far, aniso),
    maskA,
    maskB,
    canopy,
  };
}
