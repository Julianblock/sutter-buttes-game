import * as THREE from 'three';

/** Non-indexed copy of `g` tagged with a material part id (0 wall, 1 roof, 2 metal). */
export function withPart(g: THREE.BufferGeometry, part: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(ng.attributes.position.count).fill(part), 1));
  ng.deleteAttribute('uv');
  return ng;
}

export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const part = new Float32Array(count);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    part.set(g.attributes.aPart.array as Float32Array, o);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  m.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return m;
}

/** Collects thin cylinders between points into one part-tagged geometry. */
export class StrutBuilder {
  parts: THREE.BufferGeometry[] = [];
  private up = new THREE.Vector3(0, 1, 0);

  strut(a: THREE.Vector3, b: THREE.Vector3, r: number, part = 2, sides = 3) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(this.up, d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    this.parts.push(withPart(g, part));
  }

  add(g: THREE.BufferGeometry, part: number) {
    this.parts.push(withPart(g, part));
  }

  build() {
    return merge(this.parts);
  }
}
