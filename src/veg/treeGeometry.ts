import * as THREE from 'three';

// Unit tree: ground at y=0, top at y=1, crown radius 1 in x/z. Instances scale
// x/z by crown radius and y by height in the vertex shader.

export const TREE_PART = { BARK: 0, LEAF: 1, INNER: 2, FROND: 3, THATCH: 4 } as const;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class GeoBuilder {
  pos: number[] = [];
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
      this.center.push(center.x, center.y, center.z);
      this.part.push(part);
    }
    const index = g.index;
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, center: THREE.Vector3, part: number) {
    const base = this.pos.length / 3;
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.center.push(center.x, center.y, center.z);
      this.part.push(part);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  /**
   * Scales everything into the unit tree (top at y=1, widest reach 1) and
   * records the foliage envelope so the shader can light the crown as a whole.
   */
  build(): THREE.BufferGeometry {
    let maxY = 0, maxR = 0;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < this.pos.length; i += 3) {
      maxY = Math.max(maxY, this.pos[i + 1]);
      maxR = Math.max(maxR, Math.hypot(this.pos[i], this.pos[i + 2]));
      if (this.part[i / 3] !== TREE_PART.BARK) {
        lo.min(new THREE.Vector3(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
        hi.max(new THREE.Vector3(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
      }
    }
    const sx = 1 / (maxR || 1), sy = 1 / (maxY || 1);
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] *= sx;
      this.pos[i + 1] *= sy;
      this.pos[i + 2] *= sx;
      this.center[i] *= sx;
      this.center[i + 1] *= sy;
      this.center[i + 2] *= sx;
    }
    const cy = ((lo.y + hi.y) / 2) * sy;
    const rx = Math.max(0.2, Math.max(-lo.x, hi.x, -lo.z, hi.z) * sx);
    const ry = Math.max(0.1, ((hi.y - lo.y) / 2) * sy);
    const crown = new Float32Array((this.pos.length / 3) * 4);
    for (let i = 0; i < crown.length; i += 4) {
      crown[i] = cy;
      crown[i + 1] = rx;
      crown[i + 2] = ry;
      crown[i + 3] = rx;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.center, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aCrown', new THREE.Float32BufferAttribute(crown, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function limb(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides: number) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-4) return;
  const cyl = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  cyl.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1));
  b.addMesh(cyl.toNonIndexed(), m, new THREE.Vector3(0, 0.5, 0), TREE_PART.BARK);
}

/** A crooked limb: two segments with a kink, so branches never look like dowels. */
function bough(b: GeoBuilder, r: () => number, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides: number, kink = 0.12) {
  const mid = from.clone().lerp(to, 0.5);
  const len = from.distanceTo(to);
  mid.add(new THREE.Vector3((r() - 0.5) * len * kink, (r() - 0.3) * len * kink, (r() - 0.5) * len * kink));
  const rm = (r0 + r1) / 2;
  limb(b, from, mid, r0, rm, sides);
  limb(b, mid, to, rm, r1, sides);
}

export interface TreeForm {
  /** Height (unit tree, before normalising) where the trunk forks. */
  fork: number;
  trunkR: number;
  /** Separate trunks rising from the base (live oaks, multi-stem cottonwoods). */
  stems: number;
  /** Leaning trunk / crooked growth (radians of wander). */
  lean: number;
  /** Major limbs, each ending in a lobe of foliage. */
  lobes: number;
  /** Horizontal reach of lobe centres, min..max (crown radius units). */
  reach: [number, number];
  /** Lobe heights, min..max. */
  lobeY: [number, number];
  /** Lobe ellipsoid radius (horizontal) and vertical squash. */
  lobeR: number;
  lobeSquash: number;
  /** Leaf clusters per lobe at full detail. */
  clusters: number;
  clusterR: number;
  /** Outer clusters hang below their lobe (valley oak's weeping branchlets). */
  droop: number;
  /** Extra central lobe crowning the tree. */
  top: boolean;
  /** Flattened tops (orchards pruned to a picking height, umbrella walnuts). */
  flat: number;
}

const FORMS: Record<string, TreeForm> = {
  // Blue oak: a short crooked trunk, a rounded but ragged crown of small
  // clumps with sky between them.
  blueOak: { fork: 0.3, trunkR: 0.07, stems: 1, lean: 0.25, lobes: 6, reach: [0.25, 0.7], lobeY: [0.55, 0.85], lobeR: 0.32, lobeSquash: 0.7, clusters: 6, clusterR: 0.15, droop: 0.05, top: true, flat: 0 },
  // Live oak: a dense evergreen dome, wider than tall, skirts nearly to the
  // ground, often on several trunks.
  liveOak: { fork: 0.18, trunkR: 0.06, stems: 3, lean: 0.35, lobes: 7, reach: [0.35, 0.78], lobeY: [0.42, 0.75], lobeR: 0.42, lobeSquash: 0.62, clusters: 7, clusterR: 0.2, droop: 0.12, top: true, flat: 0.1 },
  // Valley oak: massive trunk, huge arching limbs, a broad crown whose
  // outer branchlets weep almost to the grass.
  valleyOak: { fork: 0.32, trunkR: 0.09, stems: 1, lean: 0.12, lobes: 7, reach: [0.4, 0.82], lobeY: [0.5, 0.82], lobeR: 0.36, lobeSquash: 0.65, clusters: 6, clusterR: 0.17, droop: 0.32, top: true, flat: 0 },
  // Fremont cottonwood: tall, upright and open, foliage in separate billows
  // stacked up the stems.
  cottonwood: { fork: 0.26, trunkR: 0.08, stems: 2, lean: 0.18, lobes: 9, reach: [0.25, 0.8], lobeY: [0.4, 0.92], lobeR: 0.24, lobeSquash: 0.8, clusters: 5, clusterR: 0.13, droop: 0.05, top: true, flat: 0 },
  // Willow / coyote brush thicket: a mound of foliage straight off the ground.
  shrub: { fork: 0.05, trunkR: 0.04, stems: 4, lean: 0.5, lobes: 5, reach: [0.2, 0.6], lobeY: [0.3, 0.6], lobeR: 0.45, lobeSquash: 0.75, clusters: 5, clusterR: 0.24, droop: 0, top: true, flat: 0 },
  // Almond: open-centre vase, three or four scaffolds splaying at 45 degrees.
  almond: { fork: 0.24, trunkR: 0.07, stems: 1, lean: 0.05, lobes: 4, reach: [0.55, 0.7], lobeY: [0.62, 0.82], lobeR: 0.36, lobeSquash: 0.7, clusters: 7, clusterR: 0.16, droop: 0.06, top: false, flat: 0.3 },
  // English walnut on black-walnut rootstock: tall clean trunk, broad umbrella.
  walnut: { fork: 0.27, trunkR: 0.07, stems: 1, lean: 0.06, lobes: 7, reach: [0.45, 0.85], lobeY: [0.5, 0.78], lobeR: 0.34, lobeSquash: 0.6, clusters: 6, clusterR: 0.16, droop: 0.15, top: true, flat: 0.2 },
  // Prune and peach: a low, squat vase.
  prune: { fork: 0.2, trunkR: 0.07, stems: 1, lean: 0.08, lobes: 4, reach: [0.5, 0.65], lobeY: [0.55, 0.78], lobeR: 0.4, lobeSquash: 0.75, clusters: 7, clusterR: 0.18, droop: 0.08, top: false, flat: 0.2 },
};

/** Species index → crown form (palm and conifer are built separately). */
const FORM_OF = ['blueOak', 'liveOak', 'valleyOak', 'cottonwood', 'shrub', 'almond', 'walnut', 'prune'];

function broadleaf(b: GeoBuilder, f: TreeForm, detail: 0 | 1 | 2, r: () => number) {
  if (detail === 2) {
    // Far trees: a few lumpy blobs in the crown's silhouette.
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const rr = (f.reach[0] + f.reach[1]) * 0.25;
      const c = new THREE.Vector3(Math.cos(a) * rr, (f.lobeY[0] + f.lobeY[1]) / 2 + (r() - 0.5) * 0.1, Math.sin(a) * rr);
      const s = f.lobeR * 1.5;
      b.addMesh(ico, new THREE.Matrix4().compose(c, new THREE.Quaternion(), new THREE.Vector3(s, s * f.lobeSquash, s)), c, TREE_PART.LEAF);
    }
    limb(b, new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, f.fork + 0.1, 0), f.trunkR, f.trunkR * 0.7, 3);
    return;
  }
  const full = detail === 0;
  const sides = full ? 7 : 4;
  // Trunks.
  const forks: THREE.Vector3[] = [];
  for (let s = 0; s < f.stems; s++) {
    const a = (s / f.stems) * Math.PI * 2 + r() * 1.5;
    const spread = f.stems > 1 ? 0.08 + r() * 0.08 : (r() - 0.5) * f.lean * 0.3;
    const top = new THREE.Vector3(Math.cos(a) * (spread + f.lean * 0.15), f.fork * (0.85 + r() * 0.3), Math.sin(a) * (spread + f.lean * 0.15));
    const base = new THREE.Vector3(Math.cos(a) * 0.02 * (f.stems - 1), -0.1, Math.sin(a) * 0.02 * (f.stems - 1));
    const tr = f.trunkR / Math.sqrt(f.stems);
    // Root flare.
    if (full) limb(b, base.clone().setY(-0.1), base.clone().setY(0.03), tr * 1.6, tr * 1.05, sides);
    bough(b, r, base, top, tr * 1.05, tr * 0.8, sides, f.lean);
    forks.push(top);
  }
  const clusterGeo = new THREE.IcosahedronGeometry(1, full ? 1 : 0);
  const innerGeo = new THREE.IcosahedronGeometry(1, 0);
  const lobes = f.lobes + (f.top ? 1 : 0);
  const per = full ? f.clusters : Math.max(1, Math.round(f.clusters / 4));
  for (let i = 0; i < lobes; i++) {
    const isTop = f.top && i === lobes - 1;
    const a = (i / f.lobes) * Math.PI * 2 + (r() - 0.5) * 0.9;
    const reach = isTop ? r() * 0.15 : f.reach[0] + r() * (f.reach[1] - f.reach[0]);
    let y = isTop ? f.lobeY[1] + 0.05 : f.lobeY[0] + r() * (f.lobeY[1] - f.lobeY[0]);
    if (f.flat > 0) y = Math.min(y, f.lobeY[1] - f.flat * 0.1);
    const lc = new THREE.Vector3(Math.cos(a) * reach, y, Math.sin(a) * reach);
    const from = forks[i % forks.length];
    // Main limb out to the lobe, with secondary branches into it.
    const lr = (f.trunkR / Math.sqrt(f.stems)) * (isTop ? 0.55 : 0.62);
    const limbEnd = from.clone().lerp(lc, 0.85);
    bough(b, r, from, limbEnd, lr, lr * 0.35, full ? 5 : 3, 0.25);
    if (full) {
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Vector3((r() - 0.5) * 2, (r() - 0.2) * 1.2, (r() - 0.5) * 2).normalize().multiplyScalar(f.lobeR * (0.5 + r() * 0.4));
        limb(b, limbEnd, lc.clone().add(t), lr * 0.35, lr * 0.1, 3);
      }
    }
    // Foliage clusters: through the lobe, biased to its outer, upper shell.
    const n = isTop ? Math.max(1, Math.round(per * 0.8)) : per;
    const lobeR = f.lobeR * (0.8 + r() * 0.4) * (full ? 1 : 1.1);
    for (let k = 0; k < n; k++) {
      let dir: THREE.Vector3;
      if (k === 0) dir = new THREE.Vector3(0, 0.3, 0);
      else {
        const u = r() * 2 - 1;
        const th = r() * Math.PI * 2;
        const sq = Math.sqrt(1 - u * u);
        dir = new THREE.Vector3(sq * Math.cos(th), u * 0.8 + 0.2, sq * Math.sin(th));
      }
      const shell = full ? 0.45 + 0.55 * r() : 0.4 + 0.3 * r();
      const c = lc.clone().add(new THREE.Vector3(dir.x * lobeR * shell, dir.y * lobeR * f.lobeSquash * shell, dir.z * lobeR * shell));
      // Weeping: the further out, the lower the branchlets hang.
      const outward = Math.max(0, Math.hypot(c.x, c.z) - f.reach[0]);
      c.y -= f.droop * outward * (0.6 + r() * 0.8);
      if (f.flat > 0) c.y = Math.min(c.y, f.lobeY[1] + lobeR * f.lobeSquash * (1 - f.flat));
      const cr = (full ? f.clusterR : lobeR * 0.85) * (full ? 0.7 + 0.6 * r() : 0.85 + 0.3 * r());
      const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(cr, cr * 0.78, cr));
      const kk = r() * 10;
      b.addMesh(clusterGeo, m, c, TREE_PART.LEAF, (p) => {
        const w = 1 + 0.2 * Math.sin(p.x * 5 + kk) * Math.sin(p.y * 4 + kk * 1.3) * Math.sin(p.z * 6 - kk);
        p.multiplyScalar(w);
      });
      if (full && k % 2 === 0) {
        const mi = new THREE.Matrix4().compose(c, new THREE.Quaternion(), new THREE.Vector3(cr * 0.7, cr * 0.55, cr * 0.7));
        b.addMesh(innerGeo, mi, c, TREE_PART.INNER);
      }
    }
  }
}

/**
 * California fan palm (Washingtonia): a tall slim trunk, a round head of
 * pleated fans, and a skirt of dead fronds hanging beneath it.
 */
function palm(b: GeoBuilder, detail: 0 | 1 | 2, r: () => number) {
  // Unit space before normalising: height ~1, head radius ~0.18.
  const H = 1;
  const lean = new THREE.Vector3((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06);
  const top = new THREE.Vector3(lean.x, H * 0.86, lean.z);
  const sides = detail === 0 ? 8 : 4;
  limb(b, new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(lean.x * 0.4, H * 0.45, lean.z * 0.4), 0.024, 0.019, sides);
  limb(b, new THREE.Vector3(lean.x * 0.4, H * 0.45, lean.z * 0.4), top, 0.019, 0.017, sides);
  // Dead-frond skirt: a shaggy cone of thatch.
  const skirt = new THREE.CylinderGeometry(0.07, 0.04, H * 0.2, detail === 0 ? 10 : 5, 2, true);
  skirt.translate(0, -H * 0.1, 0);
  b.addMesh(skirt.toNonIndexed(), new THREE.Matrix4().makeTranslation(top.x, top.y + 0.02, top.z), top, TREE_PART.THATCH, (p) => {
    if (p.y > -H * 0.15) return;
    p.x *= 0.92 + 0.16 * Math.sin(p.z * 80);
    p.z *= 0.92 + 0.16 * Math.sin(p.x * 70);
  });
  if (detail === 2) {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const c = top.clone().add(new THREE.Vector3(0, 0.05, 0));
    b.addMesh(ico, new THREE.Matrix4().compose(c, new THREE.Quaternion(), new THREE.Vector3(0.18, 0.1, 0.18)), c, TREE_PART.FROND);
    return;
  }
  const fronds = detail === 0 ? 22 : 9;
  const segs = detail === 0 ? 14 : 6;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.3;
    // Newest fronds stand up; old ones droop.
    const up = (i % 3 === 0 ? 0.9 : i % 3 === 1 ? 0.3 : -0.35) + (r() - 0.5) * 0.3;
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(up), Math.sin(up), Math.sin(a) * Math.cos(up));
    const base = top.clone().add(new THREE.Vector3(0, 0.03, 0));
    const fan = base.clone().addScaledVector(d, 0.08);
    // Petiole.
    if (detail === 0) limb(b, base, fan, 0.006, 0.004, 3);
    // Pleated fan: leaflets radiating from the end of the petiole.
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const out = d.clone();
    for (let k = 0; k < segs; k++) {
      const t0 = (k / segs - 0.5) * 2.4, t1 = ((k + 0.85) / segs - 0.5) * 2.4;
      const L = 0.11 * (0.85 + r() * 0.3);
      const dir0 = out.clone().multiplyScalar(Math.cos(t0)).addScaledVector(side, Math.sin(t0));
      const dir1 = out.clone().multiplyScalar(Math.cos(t1)).addScaledVector(side, Math.sin(t1));
      const tip0 = fan.clone().addScaledVector(dir0, L);
      const tip1 = fan.clone().addScaledVector(dir1, L);
      // Leaflet tips flop down a little.
      tip0.y -= L * 0.25;
      tip1.y -= L * 0.25;
      b.tri(fan, tip0, tip1, fan, TREE_PART.FROND);
    }
  }
}

/**
 * Conifer (incense cedar, deodar, pines in yards and cemeteries): a spire of
 * drooping, ragged-edged skirts of foliage, narrowing to a leader.
 */
function conifer(b: GeoBuilder, detail: 0 | 1 | 2, r: () => number) {
  limb(b, new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.97, 0), 0.035, 0.006, detail === 0 ? 6 : 3);
  const tiers = detail === 0 ? 10 : detail === 1 ? 5 : 2;
  const seg = detail === 0 ? 14 : detail === 1 ? 8 : 6;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = 0.1 + f * 0.8;
    const rad = 0.36 * Math.pow(1 - f, 0.9) + 0.03;
    const hgt = (0.8 / tiers) * 2.1;
    const cone = new THREE.ConeGeometry(rad, hgt, seg, 2, true);
    const k = r() * 10;
    // Skirts droop at the rim and fray into separate branch tips.
    b.addMesh(cone, new THREE.Matrix4().compose(new THREE.Vector3(0, y + hgt / 2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(1, 1, 1)), new THREE.Vector3(0, y + hgt * 0.4, 0), TREE_PART.LEAF, (p) => {
      const rim = Math.hypot(p.x, p.z) / rad;
      const a = Math.atan2(p.z, p.x);
      const fray = 1 + 0.22 * Math.sin(a * 7 + k) * rim + 0.12 * Math.sin(a * 13 - k) * rim;
      p.x *= fray;
      p.z *= fray;
      p.y -= rim * rim * hgt * 0.18 * (1 + Math.sin(a * 5 + k) * 0.5);
    });
  }
}

/** Builds the unit tree for a species at a level of detail. */
export function buildTree(detail: 0 | 1 | 2, species: number, seed = 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const r = rng(seed * 7919 + species * 104729);
  if (species === 8) palm(b, detail, r);
  else if (species === 9) conifer(b, detail, r);
  else broadleaf(b, FORMS[FORM_OF[species] ?? 'valleyOak'], detail, r);
  return b.build();
}
