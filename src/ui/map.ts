import { latLonToLocal, localToLatLon, formatLatLon } from '../world/geo';
import type { LearnStop } from './learn';

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
  /** Invented places (Nightmare), drawn in red and labelled as fiction. */
  fiction: { name: string; x: number; z: number }[] = [];
  showFiction = false;
  /** Easter eggs, lore spots and landmarks: found ones gold, the rest still a question. */
  stops: LearnStop[] = [];
  found: (id: string) => boolean = () => false;
  current: string | null = null;
  onPick?: (id: string) => void;
  private legend = document.createElement('div');
  private view = { x0: 0, z0: 0, m: 1 };

  constructor(
    private sources: MapSource[],
    private marks: { name: string; x: number; z: number }[],
  ) {
    this.root.className = 'map hidden';
    this.readout.className = 'map-readout';
    this.legend.className = 'map-legend';
    this.legend.innerHTML = '<b>Discoveries</b><span><i class="lg found">★</i>found</span><span><i class="lg todo">?</i>still to find</span><span><i class="lg place">◆</i>landmark</span><em>Click a marker to fly there</em>';
    this.root.append(this.canvas, this.readout, this.legend);
    this.root.addEventListener('click', (e) => {
      const { x0, z0, m } = this.view;
      let best: LearnStop | null = null;
      let bd = 16;
      for (const st of this.stops) {
        const d = Math.hypot((st.at.x - x0) / m - e.clientX, (st.at.z - z0) / m - e.clientY);
        if (d < bd) (bd = d), (best = st);
      }
      if (best) this.onPick?.(best.id);
      else if (document.body.classList.contains('touch')) this.toggle(false);
    });
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

  /** Zooms out until every stop fits round the player. */
  fit(px: number, pz: number) {
    let r = 0;
    for (const st of this.stops) r = Math.max(r, Math.abs(st.at.x - px) / (innerWidth * 0.45), Math.abs(st.at.z - pz) / (innerHeight * 0.42));
    if (r > 0) this.mpp = Math.min(400, r);
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

    this.view = { x0, z0, m };
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    const boxes: number[][] = [];
    const sel = this.stops.find((s) => s.id === this.current);
    g.font = '600 12px system-ui, sans-serif';
    if (sel) {
      const [x, y] = toS(sel.at.x, sel.at.z);
      boxes.push([x - 10, y - 10, x + 16 + g.measureText(sel.title).width, y + 10]);
    }
    for (const st of this.stops) {
      const [x, y] = toS(st.at.x, st.at.z);
      if (x < -60 || y < -30 || x > W + 60 || y > H + 30) continue;
      const got = st.kind !== 'place' && this.found(st.id);
      if (st.id === this.current) {
        g.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 13 + pulse * 5, 0, Math.PI * 2);
        g.stroke();
      }
      g.lineWidth = 2;
      if (st.kind === 'place') {
        g.fillStyle = '#6fb6ff';
        g.strokeStyle = '#0d2236';
        g.beginPath();
        g.moveTo(x, y - 7);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 7);
        g.lineTo(x - 6, y);
        g.closePath();
        g.fill();
        g.stroke();
      } else if (got) {
        g.fillStyle = st.kind === 'secret' ? '#b9c4ff' : '#ffd36b';
        g.strokeStyle = '#2a1e05';
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 ? 4 : 9;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        g.fillStyle = 'rgba(20,24,30,0.85)';
        g.strokeStyle = st.kind === 'secret' ? '#b9c4ff' : '#ffd36b';
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#fff';
        g.font = '700 11px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('?', x, y + 4);
        g.textAlign = 'left';
      }
      if (m > 60 && st.id !== this.current) continue;
      g.font = got || st.kind === 'place' ? '600 12px system-ui, sans-serif' : 'italic 500 12px system-ui, sans-serif';
      if (st.id !== this.current) {
        const bx = [x - 10, y - 10, x + 16 + g.measureText(st.title).width, y + 10];
        if (boxes.some((o) => bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1])) continue;
        boxes.push(bx);
      }
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillText(st.title, x + 13, y + 5);
      g.fillStyle = got ? '#ffe7a8' : st.kind === 'place' ? '#cfe6ff' : 'rgba(255,255,255,0.8)';
      g.fillText(st.title, x + 12, y + 4);
    }

    if (this.showFiction) {
      for (const l of this.fiction) {
        const [x, y] = toS(l.x, l.z);
        if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
        g.fillStyle = '#c0241a';
        g.fillRect(x - 4, y - 4, 8, 8);
        if (m > 5) continue;
        g.fillStyle = '#ff8a7a';
        g.fillText(`${l.name} (fiction)`, x + 8, y + 4);
      }
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
