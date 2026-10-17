import { buildMosaic } from './tiles.mjs';

/**
 * Detects individual tree crowns in high-resolution aerial imagery.
 * Crowns (and their shadows) read as compact blobs clearly darker than the
 * surrounding dry grass. Returns [x, z, radius, darkness] per tree.
 */
export async function detectTrees({ size, cell, zoom, allow }) {
  const sample = await buildMosaic('usgsImagery', zoom, size * 1.01);
  const N = Math.round(size / cell);
  const L = new Uint8Array(N * N);
  const water = new Uint8Array(N * N);
  const rgb = [0, 0, 0];
  console.log(`  sampling ${N}x${N}`);
  for (let j = 0; j < N; j++) {
    const z = -size / 2 + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const x = -size / 2 + (i + 0.5) * cell;
      sample(x, z, rgb);
      const p = j * N + i;
      L[p] = Math.min(255, 0.3 * rgb[0] + 0.55 * rgb[1] + 0.15 * rgb[2]);
      water[p] = rgb[2] > rgb[1] + 6 ? 1 : 0;
    }
  }

  // Local mean brightness over ~45 m (separable box blur).
  const r = Math.round(22 / cell);
  const tmp = new Float32Array(N);
  const rowMean = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += L[y * N + Math.min(N - 1, Math.max(0, x))];
    for (let x = 0; x < N; x++) {
      rowMean[y * N + x] = acc / (2 * r + 1);
      acc += L[y * N + Math.min(N - 1, x + r + 1)] - L[y * N + Math.max(0, x - r)];
    }
  }
  const mean = new Uint8Array(N * N);
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += rowMean[Math.min(N - 1, Math.max(0, y)) * N + x];
    for (let y = 0; y < N; y++) {
      tmp[y] = acc / (2 * r + 1);
      acc += rowMean[Math.min(N - 1, y + r + 1) * N + x] - rowMean[Math.max(0, y - r) * N + x];
    }
    for (let y = 0; y < N; y++) mean[y * N + x] = tmp[y];
  }

  // Tree mask.
  const mask = new Uint8Array(N * N);
  let count = 0;
  for (let j = 0; j < N; j++) {
    const z = -size / 2 + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const p = j * N + i;
      if (water[p]) continue;
      // Relative darkness finds lone oaks on grass; absolute darkness fills
      // closed-canopy woodland where the local mean is itself dark.
      const l = (L[p] * 4 + (L[p - 1] ?? L[p]) + (L[p + 1] ?? L[p]) + (L[p - N] ?? L[p]) + (L[p + N] ?? L[p])) / 8;
      if ((l < mean[p] * 0.8 && l < 110) || l < 78) {
        const x = -size / 2 + (i + 0.5) * cell;
        if (!allow(x, z)) continue;
        mask[p] = 1;
        count++;
      }
    }
  }
  console.log(`  tree pixels ${count} (${((100 * count) / (N * N)).toFixed(1)}%)`);

  // Chamfer distance to the crown edge (in cells, capped).
  const CAP = 6;
  const depth = new Uint8Array(N * N);
  for (let p = 0; p < N * N; p++) depth[p] = mask[p] ? CAP : 0;
  for (let j = 1; j < N; j++) {
    for (let i = 1; i < N - 1; i++) {
      const p = j * N + i;
      if (!depth[p]) continue;
      depth[p] = Math.min(depth[p], depth[p - 1] + 1, depth[p - N] + 1, depth[p - N - 1] + 1, depth[p - N + 1] + 1);
    }
  }
  for (let j = N - 2; j >= 0; j--) {
    for (let i = N - 2; i >= 1; i--) {
      const p = j * N + i;
      if (!depth[p]) continue;
      depth[p] = Math.min(depth[p], depth[p + 1] + 1, depth[p + N] + 1, depth[p + N + 1] + 1, depth[p + N - 1] + 1);
    }
  }

  // Greedy placement, biggest crowns first, with overlap control.
  const buckets = Array.from({ length: CAP + 1 }, () => []);
  for (let p = 0; p < N * N; p++) if (depth[p]) buckets[depth[p]].push(p);
  const G = 8; // spatial hash cell (m)
  const GN = Math.ceil(size / G);
  const grid = new Map();
  const trees = [];
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let d = CAP; d >= 1; d--) {
    for (const p of buckets[d]) {
      const i = p % N;
      const j = (p / N) | 0;
      const x = -size / 2 + (i + 0.5) * cell + (rand() - 0.5) * cell;
      const z = -size / 2 + (j + 0.5) * cell + (rand() - 0.5) * cell;
      const rad = Math.min(9, Math.max(2.2, (d + 0.4) * cell * 0.95));
      const gx = Math.floor((x + size / 2) / G);
      const gz = Math.floor((z + size / 2) / G);
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++) {
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const list = grid.get((gz + dz) * GN + gx + dx);
          if (!list) continue;
          for (const t of list) {
            const min = (t[2] + rad) * 0.72;
            if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < min * min) {
              ok = false;
              break;
            }
          }
        }
      }
      if (!ok) continue;
      const dark = Math.max(0, Math.min(1, 1 - L[p] / Math.max(mean[p], 1)));
      const t = [x, z, rad, dark];
      trees.push(t);
      const k = gz * GN + gx;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(t);
    }
  }
  return trees;
}
