export type DiscoveryKind = 'lore' | 'fish' | 'secret';

export interface Discovery {
  id: string;
  kind: DiscoveryKind;
  title: string;
  /** Small caps line above the title. */
  kicker: string;
  text: string;
}

const KEY = 'sb-discoveries';

/**
 * Journal of easter eggs, lore spots and fish species found so far, kept in
 * localStorage. New finds pop a card at the top of the screen.
 */
export class Discoveries {
  readonly root = document.createElement('div');
  private found: Set<string>;
  private queue: Discovery[] = [];
  private showing = false;
  /** Total number of discoverable things, for the "n of N" line. */
  total = 0;
  onFind?: (d: Discovery) => void;

  constructor() {
    this.root.className = 'discovery hide';
    try {
      this.found = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
    } catch {
      this.found = new Set();
    }
  }

  has(id: string) {
    return this.found.has(id);
  }

  get count() {
    return this.found.size;
  }

  list() {
    return [...this.found];
  }

  /** Records a find; returns false (and stays quiet) if it was already known. */
  discover(d: Discovery): boolean {
    if (this.found.has(d.id)) return false;
    this.found.add(d.id);
    localStorage.setItem(KEY, JSON.stringify([...this.found]));
    this.queue.push(d);
    this.onFind?.(d);
    if (!this.showing) this.next();
    return true;
  }

  /** Shows a card without recording anything (repeat visits, ambient lore). */
  whisper(d: Omit<Discovery, 'id'>) {
    this.queue.push({ ...d, id: '' });
    if (!this.showing) this.next();
  }

  private next() {
    const d = this.queue.shift();
    if (!d) {
      this.showing = false;
      return;
    }
    this.showing = true;
    const count = d.id && this.total ? `<div class="n">Discovery ${this.found.size} of ${this.total}</div>` : '';
    this.root.className = `discovery hide ${d.kind}`;
    this.root.innerHTML = `<div class="k">${d.kicker}</div><div class="t">${d.title}</div><div class="x">${d.text}</div>${count}`;
    requestAnimationFrame(() => this.root.classList.remove('hide'));
    const hold = 6500 + d.text.length * 35;
    setTimeout(() => {
      this.root.classList.add('hide');
      setTimeout(() => this.next(), 1300);
    }, hold);
  }
}
