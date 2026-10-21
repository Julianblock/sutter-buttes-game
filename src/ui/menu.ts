import { SPECIES, speciesById, type Palette } from '../birds/species';
import { MOONS, SEASONS, TIMES, WEATHERS } from '../world/environment';
import { PAINTS } from '../vehicle/carModel';
import { DESTINATIONS } from '../world/destinations';
import type { GameSettings } from './settings';

type Tab = 'bird' | 'plumage' | 'truck' | 'places' | 'season' | 'time' | 'sky';

const TABS: [Tab, string][] = [
  ['bird', 'Bird'],
  ['plumage', 'Plumage'],
  ['truck', 'Truck'],
  ['places', 'Places'],
  ['season', 'Season'],
  ['time', 'Time'],
  ['sky', 'Sky'],
];

const FLOWS: [number, string][] = [
  [0, 'Frozen'],
  [60, '1 min / sec'],
  [300, '5 min / sec'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function swatch(p: Palette): string {
  const cols = [p.head, p.back, p.coverts, p.primaries, p.breast, p.belly, p.underFlight, p.tail];
  return `<div class="swatch">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`;
}

/** Main menu: choose bird, plumage, season, time of day and sky. */
export class Menu {
  readonly root = el('div', 'menu');
  private pane = el('div', 'pane');
  private tabBar = el('div', 'tabs');
  private tab: Tab = 'bird';
  visible = true;
  onChange: (s: GameSettings, what: keyof GameSettings) => void = () => {};
  onFly: () => void = () => {};
  onDrive: () => void = () => {};
  onWalk: () => void = () => {};
  /** Start point picked in the Places tab, used by the next Take Flight / Drive. */
  place: string | null = null;

  constructor(private s: GameSettings) {
    const panel = el('div', 'panel');
    panel.append(
      el('div', 'eyebrow', 'Sutter Buttes · California'),
      el('div', 'title', 'Flight of the <em>Middle Mountain</em>'),
      el(
        'p',
        'lede',
        'The smallest mountain range in the world rises alone from the rice fields of the Sacramento Valley. Choose your bird, the season and the hour, then take to the air.',
      ),
      this.tabBar,
      this.pane,
    );
    for (const [id, label] of TABS) {
      const b = el('button', '', label);
      b.dataset.tab = id;
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
      this.tabBar.append(b);
    }
    const foot = el('div', 'foot');
    const fly = el('button', 'cta', 'Take Flight');
    fly.onclick = () => this.onFly();
    const drive = el('button', 'cta alt', 'Drive');
    drive.onclick = () => this.onDrive();
    const walk = el('button', 'cta alt', 'Walk');
    walk.onclick = () => this.onWalk();
    foot.append(fly, drive, walk, el('div', 'hint', '<kbd>Esc</kbd> returns here · <kbd>G</kbd> truck<br><kbd>B</kbd> on foot · <kbd>H</kbd> controls'));
    panel.append(foot);
    this.root.append(panel);
    this.render();
  }

  show(v: boolean) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    this.root.querySelector<HTMLElement>('.panel')!.style.pointerEvents = v ? 'auto' : 'none';
  }

  private set<K extends keyof GameSettings>(k: K, v: GameSettings[K]) {
    this.s[k] = v;
    this.onChange(this.s, k);
    this.render();
  }

  private render() {
    for (const b of this.tabBar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    this.root.classList.toggle('wide', this.tab === 'places');
    const scroll = this.pane.scrollTop;
    this.pane.innerHTML = '';
    switch (this.tab) {
      case 'bird':
        this.renderBirds();
        break;
      case 'plumage':
        this.renderPlumage();
        break;
      case 'truck': {
        this.pane.append(el('div', 'section-label', 'Paint'));
        const grid = el('div', 'grid');
        for (const p of PAINTS) {
          const hex = '#' + p.hex.toString(16).padStart(6, '0');
          const c = el('button', `card${p.id === this.s.truck ? ' on' : ''}`, `<b><i class="paint" style="background:${hex}"></i>${p.name}</b>`);
          c.onclick = () => this.set('truck', p.id);
          grid.append(c);
        }
        this.pane.append(grid);
        this.pane.append(
          el('p', 'lede', 'A well-worn ranch pickup. Pass Road and West Butte Road wind through the range; press <kbd>G</kbd> any time to swap between wings and wheels.'),
        );
        break;
      }
      case 'places':
        this.pane.append(el('p', 'lede places-lede', 'Pick a place, then <b>Take Flight</b> to soar in above it or <b>Drive</b> to start there in the truck.'));
        for (const group of ['Towns', 'Marysville', 'The Buttes'] as const) {
          this.pane.append(el('div', 'section-label places-label', group));
          const grid = el('div', 'grid places');
          for (const d of DESTINATIONS.filter((x) => x.group === group)) {
            const c = el('button', `card place-card${d.id === this.place ? ' on' : ''}`, `<b>${d.label}</b><small>${d.blurb}</small>`);
            c.onclick = () => {
              this.place = this.place === d.id ? null : d.id;
              this.render();
            };
            grid.append(c);
          }
          this.pane.append(grid);
        }
        break;
      case 'season':
        this.renderChoice(
          Object.entries(SEASONS).map(([id, v]) => [id, v.label, v.blurb]),
          this.s.season,
          (id) => this.set('season', id as GameSettings['season']),
        );
        break;
      case 'time':
        this.renderChoice(
          Object.entries(TIMES).map(([id, v]) => [id, v.label, '']),
          this.s.time,
          (id) => this.set('time', id as GameSettings['time']),
        );
        this.pane.append(el('div', 'section-label', 'Passage of time'));
        this.pane.append(this.seg(FLOWS, this.s.timeFlow, (v) => this.set('timeFlow', v)));
        break;
      case 'sky':
        this.pane.append(el('div', 'section-label', 'Weather'));
        this.renderChoice(
          Object.entries(WEATHERS).map(([id, v]) => [id, v.label, '']),
          this.s.weather,
          (id) => this.set('weather', id as GameSettings['weather']),
        );
        this.pane.append(el('div', 'section-label', 'Moon'));
        this.pane.append(
          this.seg(
            Object.entries(MOONS).map(([id, v]) => [id, v.label]),
            this.s.moon,
            (v) => this.set('moon', v as GameSettings['moon']),
          ),
        );
        this.pane.append(el('div', 'section-label', 'Controls'));
        this.pane.append(
          this.seg(
            [
              [false, 'W = dive'],
              [true, 'W = climb'],
            ],
            this.s.invertPitch,
            (v) => this.set('invertPitch', v),
          ),
        );
        this.pane.append(el('div', 'section-label', 'Units'));
        this.pane.append(
          this.seg(
            [
              ['imperial', 'Feet · mph'],
              ['metric', 'Metres · km/h'],
            ],
            this.s.units,
            (v) => this.set('units', v as GameSettings['units']),
          ),
        );
        break;
    }
    this.pane.scrollTop = scroll;
  }

  private seg<T>(opts: [T, string][], cur: T, pick: (v: T) => void) {
    const wrap = el('div', 'seg');
    for (const [v, label] of opts) {
      const b = el('button', v === cur ? 'on' : '', label);
      b.onclick = () => pick(v);
      wrap.append(b);
    }
    return wrap;
  }

  private renderChoice(items: [string, string, string][], cur: string, pick: (id: string) => void) {
    const grid = el('div', 'grid');
    for (const [id, label, blurb] of items) {
      const c = el('button', `card${id === cur ? ' on' : ''}${blurb ? ' wide' : ''}`, `<b>${label}</b>${blurb ? `<small>${blurb}</small>` : ''}`);
      c.onclick = () => pick(id);
      grid.append(c);
    }
    this.pane.append(grid);
  }

  private renderBirds() {
    const grid = el('div', 'grid');
    for (const sp of SPECIES) {
      const c = el('button', `card${sp.id === this.s.bird ? ' on' : ''}`, `<b>${sp.name}</b><small>${sp.latin}</small>`);
      c.onclick = () => {
        this.s.palette = 0;
        this.s.custom = {};
        this.set('bird', sp.id);
      };
      grid.append(c);
    }
    this.pane.append(grid);
    const sp = speciesById(this.s.bird) ?? SPECIES[0];
    const ft = (m: number) => (this.s.units === 'imperial' ? `${(m * 3.281).toFixed(1)} ft` : `${m.toFixed(2)} m`);
    const spd = (v: number) => (this.s.units === 'imperial' ? `${Math.round(v * 2.237)} mph` : `${Math.round(v * 3.6)} km/h`);
    const d = el(
      'div',
      'detail',
      `<h3>${sp.name}</h3><div class="latin">${sp.latin}</div><p>${sp.blurb}</p>
      <div class="stats"><div><span>${ft(sp.shape.wingspan)}</span>Wingspan</div><div><span>${sp.flight.massKg} kg</span>Weight</div>
      <div><span>${sp.flight.glideRatio}:1</span>Glide</div><div><span>${spd(sp.flight.maxDive)}</span>Dive</div></div>
      <ul>${sp.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`,
    );
    this.pane.append(d);
  }

  private renderPlumage() {
    const sp = speciesById(this.s.bird) ?? SPECIES[0];
    const grid = el('div', 'grid');
    sp.palettes.forEach((p, i) => {
      const c = el('button', `card${i === this.s.palette ? ' on' : ''}`, `<b>${p.name}</b>${swatch(p)}`);
      c.onclick = () => {
        this.s.custom = {};
        this.set('palette', i);
      };
      grid.append(c);
    });
    this.pane.append(grid);
    this.pane.append(el('div', 'section-label', 'Custom colours'));
    const pal = sp.palettes[this.s.palette] ?? sp.palettes[0];
    const wrap = el('div', 'custom');
    const fields: [keyof GameSettings['custom'], string, string][] = [
      ['back', 'Back & wings', pal.back],
      ['belly', 'Underparts', pal.belly],
      ['head', 'Head', pal.head],
      ['tail', 'Tail', pal.tail],
    ];
    for (const [k, label, def] of fields) {
      const l = el('label');
      const inp = el('input') as HTMLInputElement;
      inp.type = 'color';
      inp.value = this.s.custom[k] ?? def;
      inp.oninput = () => {
        this.s.custom = { ...this.s.custom, [k]: inp.value };
        this.onChange(this.s, 'custom');
      };
      l.append(inp, label);
      wrap.append(l);
    }
    this.pane.append(wrap);
  }
}
