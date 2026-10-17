import sharp from 'sharp';

export async function readHeight(file, enc) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const N = info.width;
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    h[i] = (data[i * info.channels] * 256 + data[i * info.channels + 1]) / enc.scale - enc.offset;
  }
  return { h, N, raw: data, channels: info.channels };
}

/** Horizon-based ambient occlusion, 0 (fully occluded) .. 1 (open sky). */
export function horizonAO(h, N, cellSize, { dirs = 16, steps = 24, maxDist = 600 } = {}) {
  const ao = new Float32Array(N * N);
  const dx = [];
  const dz = [];
  for (let d = 0; d < dirs; d++) {
    const a = (d / dirs) * Math.PI * 2;
    dx.push(Math.cos(a));
    dz.push(Math.sin(a));
  }
  const dists = [];
  for (let s = 1; s <= steps; s++) dists.push(maxDist * (s / steps) ** 1.8 + cellSize);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h0 = h[j * N + i];
      let sum = 0;
      for (let d = 0; d < dirs; d++) {
        let maxSlope = 0;
        for (const dist of dists) {
          const x = Math.round(i + (dx[d] * dist) / cellSize);
          const z = Math.round(j + (dz[d] * dist) / cellSize);
          if (x < 0 || z < 0 || x >= N || z >= N) break;
          const slope = (h[z * N + x] - h0) / dist;
          if (slope > maxSlope) maxSlope = slope;
        }
        // cos^2 of the horizon elevation angle approximates the visible sky fraction
        sum += 1 / (1 + maxSlope * maxSlope);
      }
      ao[j * N + i] = sum / dirs;
    }
  }
  return ao;
}

/**
 * Canopy fraction per height cell: counts imagery pixels that are clearly darker
 * than their surroundings (oak crowns and their shadows on dry grass).
 */
export async function canopyMask(imageryFile, outRes, allow) {
  const { data, info } = await sharp(imageryFile).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const C = info.channels;
  const L = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) {
    L[i] = 0.3 * data[i * C] + 0.55 * data[i * C + 1] + 0.15 * data[i * C + 2];
  }
  // Separable box blur for local mean brightness (~60m window).
  const r = 6;
  const tmp = new Float32Array(W * W);
  const mean = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += L[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / (2 * r + 1);
      acc += L[y * W + Math.min(W - 1, x + r + 1)] - L[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(W - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < W; y++) {
      mean[y * W + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(W - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  const k = W / outRes;
  const out = new Uint8Array(outRes * outRes);
  for (let j = 0; j < outRes; j++) {
    for (let i = 0; i < outRes; i++) {
      if (!allow(i, j)) continue;
      let n = 0;
      for (let y = 0; y < k; y++) {
        for (let x = 0; x < k; x++) {
          const p = (j * k + y) * W + i * k + x;
          const b = data[p * C + 2];
          const g = data[p * C + 1];
          const isWater = b > g + 8;
          if (!isWater && L[p] < mean[p] * 0.82 && L[p] < 110) n++;
        }
      }
      out[j * outRes + i] = Math.round((255 * n) / (k * k));
    }
  }
  return out;
}
