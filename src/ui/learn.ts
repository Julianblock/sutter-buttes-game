import type { DiscoveryKind } from './discoveries';
import type { TourAt, TourStop } from '../world/lore';

export type LearnKind = DiscoveryKind | 'place';
export type LearnStop = Omit<TourStop, 'kind'> & { kind: LearnKind };

type Pt = { x: number; z: number };

/**
 * Landscape and landmark stops for Learn mode: not journal finds, but the
 * things a guide would point out on the way round.
 */
export function placeStops(landmark: (id: string) => Pt | null, findLand: (codes: number[], x: number, z: number, r: number) => Pt | null, lc: { RICE: number; FRUIT: number; ALMOND: number; WALNUT: number }): LearnStop[] {
  const out: LearnStop[] = [];
  const add = (id: string, p: Pt | null, alt: number, kicker: string, title: string, text: string) => {
    if (p) out.push({ id: 'place-' + id, kind: 'place', kicker, title, text, at: { x: p.x, z: p.z, alt, hint: '' } });
  };
  add('peace-valley', { x: 900, z: -2100 }, 140, 'Inside the Buttes', 'Peace Valley', 'A hidden valley in the moat between the volcanic core and the outer ring of hills. The Buttes are almost all private ranch land; guided hikes are the only way most people ever walk in here.');
  add('butte-sink', { x: -7300, z: -5000 }, 90, 'Wetlands · west of the Buttes', 'Butte Sink', 'Where Butte Creek spreads out into tule marsh and flooded duck clubs. In winter it holds one of the densest gatherings of ducks and geese in North America, birds down the Pacific Flyway from Alaska and Canada.');
  add('gray-lodge', { x: -2200, z: -12700 }, 90, 'Wildlife area', 'Gray Lodge', 'State marshes in sight of the Buttes. From November to February snow geese, white-fronted geese and ducks lift off the ponds in clouds.');
  add('bypass', { x: -3500, z: 9000 }, 90, 'Flood control', 'Sutter Bypass', 'When the Sacramento River rises, weirs spill its floodwater into this broad channel between levees, which carries it south past the Buttes instead of through the towns. In wet winters it becomes a lake.');
  add('sutter-nwr', { x: 4700, z: 11600 }, 90, 'National Wildlife Refuge · 1945', 'Sutter Refuge', 'Seasonal marsh inside the bypass, sheltering wintering waterfowl and, in spring, nesting herons and egrets.');
  add('rice', findLand([lc.RICE], -9000, 2000, 9000), 70, 'Sutter & Colusa counties', 'Rice country', 'Fields are flooded in spring and seeded from aeroplanes, then flooded again after harvest so the straw breaks down. That turns the valley into winter habitat for millions of birds.');
  add('orchards', findLand([lc.FRUIT, lc.ALMOND, lc.WALNUT], 9000, 4000, 9000), 45, 'Around Yuba City', 'Orchard country', 'Prunes, cling peaches, walnuts and almonds. Yuba City is one of the great prune-growing regions of the world; in late winter the orchards bloom white and pink.');
  add('ellis-lake', { x: 19560, z: 6430 }, 60, 'Marysville · 1920s', 'Ellis Lake', 'A city lake laid out on an old swampy slough to plans by John McLaren, the designer of San Francisco’s Golden Gate Park.');
  add('hotel', landmark('hotel'), 45, 'Marysville · 1927', 'Hotel Marysville', 'Once the grandest hotel in the northern valley. Its tower and red rooftop letters still rise over downtown.');
  add('state', landmark('state'), 25, 'D Street · 1927', 'State Theatre', 'A downtown movie palace. Its vertical STATE sign and marquee of chaser bulbs light up after dark.');
  add('aaron', landmark('aaron'), 25, 'Marysville · 1850s', 'Mary Aaron Museum', 'A brick house from the Gold Rush years, now a museum of early Marysville and the families who lived through floods, fires and booms.');
  add('chinese', landmark('chinesemuseum'), 25, 'Old Chinatown', 'Chinese American Museum', 'Beside Bok Kai Temple, it tells the story of the Chinese pioneers who built the levees, railroads and farms of the valley.');
  return out;
}

const KIND_LABEL: Record<LearnKind, string> = { lore: 'Lore', secret: 'Secret', fish: 'Fish', place: 'Landmark' };

/**
 * Learn mode: a guided tour of every easter egg, lore spot and landmark. A
 * card shows where you are in the tour, what the place is and how to unlock
 * it; Go there flies you in.
 */
export class LearnTour {
  readonly root = document.createElement('div');
  active = false;
  index = 0;
  auto = false;
  private autoT = 0;
  onGo: (s: LearnStop) => void = () => {};
  onMap: () => void = () => {};

  constructor(
    readonly stops: LearnStop[],
    private found: (id: string) => boolean,
  ) {
    this.root.className = 'learn hidden';
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.x')) return void t.closest('.x')!.classList.toggle('open');
      const b = t.closest('button');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'prev') this.step(-1, true);
      if (a === 'next') this.step(1, true);
      if (a === 'go') this.go();
      if (a === 'auto') this.setAuto(!this.auto);
      if (a === 'map') this.onMap();
      if (a === 'close') this.show(false);
      b.blur();
    });
  }

  show(v: boolean) {
    this.active = v;
    if (!v) this.setAuto(false);
    this.root.classList.toggle('hidden', !v);
    this.render();
  }

  /** Jumps to a stop by id (from the map) and flies there. */
  pick(id: string) {
    const i = this.stops.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.index = i;
    if (!this.active) this.show(true);
    this.go();
  }

  step(d: number, go = false) {
    this.index = (this.index + d + this.stops.length) % this.stops.length;
    if (go) this.go();
    else this.render();
  }

  go() {
    this.autoT = 0;
    this.render();
    const s = this.stops[this.index];
    if (s) this.onGo(s);
  }

  setAuto(v: boolean) {
    this.auto = v;
    this.autoT = 0;
    this.render();
    if (v) this.go();
  }

  update(dt: number) {
    if (!this.active || !this.auto) return;
    this.autoT += dt;
    const s = this.stops[this.index];
    if (this.autoT > 14 + (s?.text.length ?? 0) * 0.05) this.step(1, true);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (e.code === 'BracketRight' || e.code === 'PageDown') this.step(1, true);
    else if (e.code === 'BracketLeft' || e.code === 'PageUp') this.step(-1, true);
    else if (e.code === 'Enter') this.go();
    else if (e.code === 'KeyY') this.setAuto(!this.auto);
    else return false;
    return true;
  }

  render() {
    if (!this.active) return;
    const s = this.stops[this.index];
    if (!s) return;
    const lore = this.stops.filter((q) => q.kind !== 'place');
    const got = lore.filter((q) => this.found(q.id)).length;
    const done = s.kind === 'place' || this.found(s.id);
    const status =
      s.kind === 'place'
        ? ''
        : done
          ? '<div class="st ok">✓ Discovered</div>'
          : `<div class="st">${hintFor(s.at)}</div>`;
    this.root.className = `learn ${s.kind}`;
    this.root.innerHTML = `
      <div class="hd"><span class="tag">Learn mode</span><span class="pg">Stop ${this.index + 1} of ${this.stops.length} · ${got}/${lore.length} eggs found</span><button data-a="close" title="Leave Learn mode">✕</button></div>
      <div class="k">${KIND_LABEL[s.kind]} · ${s.kicker}</div>
      <div class="t">${s.title}</div>
      <div class="x">${s.text}</div>
      ${status}
      <div class="bt">
        <button data-a="prev" title="Previous stop ( [ )">‹ Prev</button>
        <button data-a="go" class="go" title="Fly there (Enter)">Go there</button>
        <button data-a="next" title="Next stop ( ] )">Next ›</button>
        <button data-a="auto" class="${this.auto ? 'on' : ''}" title="Tour every stop automatically (Y)">${this.auto ? '❚❚ Auto' : '▶ Auto'}</button>
        <button data-a="map" title="Map of every stop (Tab)">Map</button>
      </div>`;
  }
}

function hintFor(at: TourAt) {
  const need = at.setup === 'night' ? ' <i>Learn mode makes it night.</i>' : at.setup === 'snow' ? ' <i>Learn mode brings the snow.</i>' : at.setup === 'day' ? ' <i>Learn mode makes it day.</i>' : '';
  return `<b>To unlock:</b> ${at.hint}${need}`;
}
