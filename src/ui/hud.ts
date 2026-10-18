import type { AirField } from '../birds/air';
import type { FlightModel } from '../birds/flight';
import type { Places, PlaceInfo } from '../world/places';
import type { CarPhysics } from '../vehicle/car';

const DIRS = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];

function el(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

/** In-flight overlay: place name, compass, instruments, lift indicator, help. */
export class Hud {
  readonly root = el('hud hidden');
  readonly help = el('help hidden');
  private flyHelp =
    `<div class="box"><h2>Flying</h2><table>
    <tr><td><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd></td><td>Dive / climb (pitch)</td></tr>
    <tr><td><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></td><td>Bank left / right</td></tr>
    <tr><td><kbd>Q</kbd><kbd>E</kbd></td><td>Rudder (fine turn)</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Flap (hold) · take off when perched</td></tr>
    <tr><td><kbd>R</kbd></td><td>Sprint (hard flapping)</td></tr>
    <tr><td><kbd>Shift</kbd></td><td>Tuck wings and stoop</td></tr>
    <tr><td><kbd>F</kbd> / <kbd>Ctrl</kbd></td><td>Flare / air-brake · land gently</td></tr>
    <tr><td><kbd>C</kbd></td><td>Camera: chase · far · side · head · cinematic</td></tr>
    <tr><td>Drag · Wheel</td><td>Look around · zoom</td></tr>
    <tr><td><kbd>V</kbd></td><td>Call</td></tr>
    <tr><td><kbd>G</kbd></td><td>Land and take the pickup</td></tr>
    <tr><td><kbd>M</kbd></td><td>Mute sound</td></tr>
    <tr><td><kbd>T</kbd></td><td>Toggle HUD</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Menu</td></tr>
    </table><p style="font:300 12px/1.6 var(--sans);color:var(--ink-dim);margin:16px 0 0;max-width:380px">
    Soar like the locals: circle in thermals over sunny fields (the vario turns green), or ride ridge lift along the windward slopes of the Buttes. Land by flaring slowly near the ground.</p></div>`;
  private driveHelp =
    `<div class="box"><h2>Driving</h2><table>
    <tr><td><kbd>W</kbd> / <kbd>↑</kbd></td><td>Gas</td></tr>
    <tr><td><kbd>S</kbd> / <kbd>↓</kbd></td><td>Brake · reverse when stopped</td></tr>
    <tr><td><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></td><td>Steer</td></tr>
    <tr><td>Mouse</td><td>Look around (click to capture)</td></tr>
    <tr><td><kbd>Shift</kbd></td><td>Floor it</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Handbrake</td></tr>
    <tr><td><kbd>C</kbd></td><td>Camera: cockpit · chase · hood</td></tr>
    <tr><td><kbd>L</kbd></td><td>Headlights</td></tr>
    <tr><td><kbd>V</kbd></td><td>Horn</td></tr>
    <tr><td><kbd>G</kbd></td><td>Get out and fly</td></tr>
    <tr><td><kbd>M</kbd></td><td>Mute sound</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Menu</td></tr>
    </table><p style="font:300 12px/1.6 var(--sans);color:var(--ink-dim);margin:16px 0 0;max-width:380px">
    Pass Road climbs right through the middle of the Buttes. Off the asphalt the truck slows in grass and orchards, and bogs down in flooded rice.</p></div>`;
  private place = el('place fade', '<div class="t"></div><div class="s"></div>');
  private compass = el('compass', '<div class="tape"></div>');
  private chip = el('status-chip', 'Thermal');
  private alt = el('inst', '<div class="v">0</div><div class="u">ft above ground</div>');
  private spd = el('inst', '<div class="v">0</div><div class="u">mph</div>');
  private vario = el('inst vario', '<div class="v">0.0</div><div class="u">climb</div>');
  private msl = el('inst', '<div class="v">0</div><div class="u">ft elevation</div>');
  private keys = el('keys');
  private lastPlace = '';
  private placeTimer = 0;
  private placeCheck = 0;
  private tape: HTMLDivElement;
  units: 'imperial' | 'metric' = 'imperial';
  visible = false;
  hidden = false;

  constructor(private places: Places) {
    const inst = el('instruments');
    inst.append(this.alt, this.spd, this.vario, this.msl);
    this.root.append(this.place, this.compass, this.chip, inst, this.keys);
    this.setDriving(false);
    this.tape = this.compass.querySelector('.tape')!;
    // Three copies of the 16-point rose so the tape can wrap seamlessly.
    let html = '';
    for (let r = 0; r < 3; r++) for (const d of DIRS) html += `<span class="${d.length && d !== '·' ? 'c' : ''}">${d}</span>`;
    this.tape.innerHTML = html;
  }

  private driving: boolean | null = null;

  setDriving(d: boolean) {
    if (d === this.driving) return;
    this.driving = d;
    this.help.innerHTML = d ? this.driveHelp : this.flyHelp;
    this.keys.innerHTML = `<kbd>H</kbd> controls · <kbd>C</kbd> camera · <kbd>G</kbd> ${d ? 'fly' : 'drive'} · <kbd>Esc</kbd> menu`;
    this.vario.classList.toggle('vario', !d);
    this.lastPlace = '';
  }

  private setInst(e: HTMLElement, v: string, u: string) {
    (e.firstChild as HTMLElement).textContent = v;
    (e.lastChild as HTMLElement).textContent = u;
  }

  private setHeading(psi: number) {
    // Heading: psi=0 faces +Z (south). Compass bearing = 180° - psi.
    const bearing = ((180 - (psi * 180) / Math.PI) % 360 + 360) % 360;
    const px = (bearing / 22.5) * 30;
    this.tape.style.transform = `translateX(${180 - 15 - (px + 16 * 30)}px)`;
  }

  updateCar(dt: number, c: CarPhysics) {
    if (!this.visible) return;
    this.placeCheck -= dt;
    if (this.placeCheck <= 0) {
      this.placeCheck = 0.5;
      this.setPlace(this.places.at(c.pos.x, c.pos.z, 2));
      const onRoad = c.road && c.road.dist < c.road.halfWidth + 0.6;
      this.chip.textContent = onRoad ? c.road!.name || 'Unnamed road' : `Off road · ${c.surface.name}`;
      this.chip.classList.add('show');
    }
    this.placeTimer -= dt;
    if (this.placeTimer < 0 && this.placeTimer > -1) this.place.classList.add('fade');
    const imp = this.units === 'imperial';
    const L = imp ? 3.281 : 1;
    this.setInst(this.spd, String(Math.round(Math.abs(c.speed) * (imp ? 2.237 : 3.6))), imp ? 'mph' : 'km/h');
    const gear = c.speed < -0.3 ? 'R' : Math.abs(c.speed) < 0.3 ? 'N' : 'D' + c.gear;
    this.setInst(this.alt, gear, 'gear');
    this.setInst(this.vario, String(Math.round(c.rpm * 5200 + 600)), 'rpm');
    (this.vario.firstChild as HTMLElement).className = 'v';
    this.setInst(this.msl, Math.round(c.pos.y * L).toLocaleString(), imp ? 'ft elevation' : 'm elevation');
    this.setHeading(c.psi);
  }

  show(v: boolean) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v || this.hidden);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.show(this.visible);
  }

  toggleHelp(force?: boolean) {
    const on = force ?? this.help.classList.contains('hidden');
    this.help.classList.toggle('hidden', !on);
  }

  private setPlace(p: PlaceInfo) {
    const key = p.title + '|' + p.subtitle;
    if (key === this.lastPlace) return;
    const titleChanged = p.title !== this.lastPlace.split('|')[0];
    this.lastPlace = key;
    if (titleChanged) {
      this.place.classList.add('fade');
      setTimeout(() => {
        this.place.querySelector('.t')!.textContent = p.title;
        this.place.querySelector('.s')!.textContent = p.subtitle;
        this.place.classList.remove('fade');
      }, 700);
      this.placeTimer = 9;
    } else {
      this.place.querySelector('.s')!.textContent = p.subtitle;
    }
  }

  update(dt: number, f: FlightModel, air: AirField) {
    if (!this.visible) return;
    this.placeCheck -= dt;
    if (this.placeCheck <= 0) {
      this.placeCheck = 0.5;
      this.setPlace(this.places.at(f.pos.x, f.pos.z, f.agl));
    }
    this.placeTimer -= dt;
    if (this.placeTimer < 0 && this.placeTimer > -1) this.place.classList.add('fade');

    const imp = this.units === 'imperial';
    const L = imp ? 3.281 : 1;
    (this.alt.firstChild as HTMLElement).textContent = Math.max(0, Math.round(f.agl * L)).toLocaleString();
    (this.alt.lastChild as HTMLElement).textContent = imp ? 'ft above ground' : 'm above ground';
    (this.msl.firstChild as HTMLElement).textContent = Math.round(f.pos.y * L).toLocaleString();
    (this.msl.lastChild as HTMLElement).textContent = imp ? 'ft elevation' : 'm elevation';
    (this.spd.firstChild as HTMLElement).textContent = String(Math.round(f.speed * (imp ? 2.237 : 3.6)));
    (this.spd.lastChild as HTMLElement).textContent = f.state === 'perched' ? 'perched' : imp ? 'mph' : 'km/h';
    const vz = f.climbRate * (imp ? 196.85 / 100 : 1);
    const vEl = this.vario.firstChild as HTMLElement;
    vEl.textContent = (vz >= 0 ? '+' : '') + vz.toFixed(1);
    vEl.classList.toggle('up', f.climbRate > 0.4);
    vEl.classList.toggle('down', f.climbRate < -1.5);
    (this.vario.lastChild as HTMLElement).textContent = imp ? 'climb ×100 ft/min' : 'climb m/s';

    this.chip.textContent = air.lastRidge > air.lastThermal ? 'Ridge lift' : 'Thermal';
    this.chip.classList.toggle('show', f.airLift > 1.0 && f.state === 'flying');

    this.setHeading(f.psi);
  }
}
