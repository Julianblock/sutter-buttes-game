import { latLonToLocal, localToLatLon, formatLatLon } from '../world/geo';

export interface MapSource {
  bmp: ImageBitmap;
  /** Centre x, z and side (m) of the square the image covers. */
  cx: number;
  cz: number;
  size: number;
}

/**
 * Full-screen map (Tab): the survey orthophotos at whatever detail covers the
 * view, a latitude/longitude graticule, landmarks and you. Wheel zooms.
 */
export class MapView {
  readonly root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private readout = document.createElement('div');
  private ctx: CanvasRenderingContext2D;
  /** Metres per CSS pixel. */
  private mpp = 1.6;
  private mouse: { x: number; y: number } | null = null;
  open = false;

  constructor(
    private sources: MapSource[],
    private marks: { name: string; x: number; z: number }[],
  ) {
    this.root.className = 'map hidden';
    this.readout.className = 'map-readout';
    this.root.append(this.canvas, this.readout);
    this.ctx = this.canvas.getContext('2d')!;
    // Coarse first so finer imagery paints over it.
    this.sources.sort((a, b) => b.size - a.size);
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mpp = Math.max(0.25, Math.min(400, this.mpp * Math.exp(e.deltaY * 0.0015)));
    });
    this.root.addEventListener('mousemove', (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
    this.root.addEventListener('mouseleave', () => (this.mouse = null));
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.root.classList.toggle('hidden', !this.open);
  }

  draw(px: number, pz: number, heading: number) {
    if (!this.open) return;
    const dpr = Math.min(2, devicePixelRatio);
    const W = innerWidth, H = innerHeight;
    if (this.canvas.width !== Math.round(W * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10140f';
    g.fillRect(0, 0, W, H);
    const m = this.mpp;
    const x0 = px - (W / 2) * m, z0 = pz - (H / 2) * m;
    const toS = (x: number, z: number) => [(x - x0) / m, (z - z0) / m];
    g.imageSmoothingQuality = 'high';
    for (const s of this.sources) {
      const half = s.size / 2;
      const sx0 = Math.max(x0, s.cx - half), sz0 = Math.max(z0, s.cz - half);
      const sx1 = Math.min(x0 + W * m, s.cx + half), sz1 = Math.min(z0 + H * m, s.cz + half);
      if (sx1 <= sx0 || sz1 <= sz0) continue;
      const k = s.bmp.width / s.size;
      const [dx, dz] = toS(sx0, sz0);
      g.drawImage(s.bmp, (sx0 - s.cx + half) * k, (sz0 - s.cz + half) * k, (sx1 - sx0) * k, (sz1 - sz0) * k, dx, dz, (sx1 - sx0) / m, (sz1 - sz0) / m);
    }

    // Graticule at a round step that leaves ~150 px between lines.
    const steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
    const step = steps.find((d) => (d * 111000) / m > 150) ?? 1;
    const nw = localToLatLon(x0, z0), se = localToLatLon(x0 + W * m, z0 + H * m);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '11px ui-monospace, monospace';
    g.lineWidth = 1;
    for (let lat = Math.ceil(se.lat / step) * step; lat <= nw.lat; lat += step) {
      const y = toS(0, latLonToLocal(lat, nw.lon).z)[1];
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      g.fillText(`${lat.toFixed(dec)}°N`, 6, y - 4);
    }
    for (let lon = Math.ceil(nw.lon / step) * step; lon <= se.lon; lon += step) {
      const x = toS(latLonToLocal(nw.lat, lon).x, 0)[0];
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.fillText(`${Math.abs(lon).toFixed(dec)}°W`, x + 4, H - 8);
    }

    g.font = '600 12px system-ui, sans-serif';
    for (const l of this.marks) {
      const [x, y] = toS(l.x, l.z);
      if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
      if (m > 5) continue;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(l.name, x + 8, y + 5);
      g.fillStyle = '#fff';
      g.fillText(l.name, x + 7, y + 4);
    }

    // You: an arrow pointing along the heading (psi = 0 faces south, +z).
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-heading);
    g.fillStyle = '#ff5a3c';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 12);
    g.lineTo(7, -8);
    g.lineTo(0, -4);
    g.lineTo(-7, -8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    const here = formatLatLon(px, pz);
    const cur = this.mouse ? formatLatLon(x0 + this.mouse.x * m, z0 + this.mouse.y * m) : '';
    const scale = m * 100 >= 1000 ? `${((m * 100) / 1000).toFixed(1)} km` : `${Math.round(m * 100)} m`;
    this.readout.innerHTML = `<b>You</b> ${here}${cur ? `<br><b>Cursor</b> ${cur}` : ''}<br><span>100 px = ${scale} · wheel to zoom · Tab to close</span>`;
  }
}
