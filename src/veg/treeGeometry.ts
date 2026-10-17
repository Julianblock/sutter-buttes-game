import * as THREE from 'three';

// Unit tree: ground at y=0, top at y=1, crown radius 1 in x/z. Instances scale
// x/z by crown radius and y by height in the vertex shader.

export const TREE_PART = { BARK: 0, LEAF: 1 } as const;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  center: number[] = [];
  part: number[] = [];
  idx: number[] = [];

  addMesh(g: THREE.BufferGeometry, m: THREE.Matrix4, center: THREE.Vector3, part: number, displace?: (p: THREE.Vector3) => void) {
    const base = this.pos.length / 3;
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (displace) displace(v);
      v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(0, 1, 0);
      this.center.push(center.x, center.y, center.z);
      this.part.push(part);
    }
    const index = g.index;
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.center, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function limb(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides: number) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const cyl = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  cyl.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1));
  b.addMesh(cyl.toNonIndexed(), m, new THREE.Vector3(0, 0.5, 0), TREE_PART.BARK);
}

/**
 * Builds an oak-like tree: trunk, a few spreading limbs and a lumpy crown made
 * of overlapping leaf clusters. `detail` selects the level of detail.
 */
export function buildTree(detail: 0 | 1 | 2, seed = 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const r = rng(seed);
  const crownY = 0.62;
  const crownR = new THREE.Vector3(0.84, 0.36, 0.84);

  if (detail === 2) {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, crownY, 0), new THREE.Quaternion(), new THREE.Vector3(0.95, 0.36, 0.95));
    b.addMesh(ico, m, new THREE.Vector3(0, crownY, 0), TREE_PART.LEAF);
    return b.build();
  }

  // Trunk and limbs.
  const trunkTop = new THREE.Vector3((r() - 0.5) * 0.08, 0.3, (r() - 0.5) * 0.08);
  limb(b, new THREE.Vector3(0, -0.1, 0), trunkTop, 0.075, 0.055, detail === 0 ? 7 : 4);
  const limbs = detail === 0 ? 5 : 2;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + r() * 0.8;
    const out = 0.45 + r() * 0.3;
    const end = new THREE.Vector3(Math.cos(a) * out, crownY + (r() - 0.3) * 0.18, Math.sin(a) * out);
    limb(b, trunkTop, end, 0.045, 0.018, detail === 0 ? 5 : 3);
    if (detail === 0) {
      const a2 = a + (r() - 0.5) * 1.2;
      const end2 = end.clone().add(new THREE.Vector3(Math.cos(a2) * 0.25, 0.12 + r() * 0.1, Math.sin(a2) * 0.25));
      limb(b, end, end2, 0.018, 0.008, 3);
    }
  }

  // Crown clusters biased toward the outer shell of an oblate ellipsoid.
  const n = detail === 0 ? 26 : 7;
  const clusterGeo = new THREE.IcosahedronGeometry(1, detail === 0 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    let dir: THREE.Vector3;
    if (i === 0) dir = new THREE.Vector3(0, 0.7, 0);
    else {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      dir = new THREE.Vector3(s * Math.cos(th), Math.abs(u) * 0.9 - 0.15, s * Math.sin(th));
    }
    const shell = 0.55 + 0.35 * r();
    const c = new THREE.Vector3(dir.x * crownR.x * shell, crownY + dir.y * crownR.y * shell, dir.z * crownR.z * shell);
    const cr = (detail === 0 ? 0.24 : 0.4) * (0.8 + 0.4 * r());
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(cr, cr * 0.8, cr));
    const k = r() * 10;
    b.addMesh(clusterGeo, m, c, TREE_PART.LEAF, (p) => {
      const w = 1 + 0.18 * Math.sin(p.x * 5 + k) * Math.sin(p.y * 4 + k * 1.3) * Math.sin(p.z * 6 - k);
      p.multiplyScalar(w);
    });
  }
  return b.build();
}
