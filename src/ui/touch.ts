import type { Controls } from '../birds/input';

interface Button {
  label: string;
  code: string;
  cls?: string;
}

const FLY: Button[] = [
  { label: 'Flap', code: 'Space', cls: 'big' },
  { label: 'Dive', code: 'ShiftLeft' },
  { label: 'Flare', code: 'KeyF' },
  { label: 'Sprint', code: 'KeyR', cls: 'small' },
  { label: 'Call', code: 'KeyV', cls: 'small' },
];

const DRIVE: Button[] = [
  { label: 'Gas', code: 'ArrowUp', cls: 'big' },
  { label: 'Brake', code: 'ArrowDown' },
  { label: 'Hand­brake', code: 'Space' },
  { label: 'Horn', code: 'KeyV', cls: 'small' },
  { label: 'Lights', code: 'KeyL', cls: 'small' },
];

const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

const key = (type: 'keydown' | 'keyup', code: string) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // The pointer already went away.
  }
}

function div(cls: string, html = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

/**
 * On-screen controls for phones and tablets: a floating thumb-stick on the
 * left for pitch and bank (or steering), action buttons on the right, and
 * menu / camera / swap buttons up top. Buttons press the same keys the
 * keyboard does, so every action goes through the existing handlers.
 */
export class TouchControls {
  readonly root = div('touch hidden');
  private zone = div('t-zone');
  private base = div('t-base');
  private knob = div('t-knob');
  private pad = div('t-pad');
  private top = div('t-top');
  private swap: HTMLButtonElement;
  private stickId = -1;
  private origin = { x: 0, y: 0 };
  private held = new Map<number, string>();

  constructor(private controls: Controls) {
    this.base.append(this.knob);
    this.zone.append(this.base, div('t-hint', 'Drag to steer'));
    this.root.append(this.zone, this.pad, this.top, div('t-rotate', 'Turn your phone sideways for the best view'));
    this.top.append(this.topButton(ICON.menu, 'Escape', 'Menu'), this.topButton(ICON.camera, 'KeyC', 'Camera'));
    this.swap = this.topButton('Drive', 'KeyG', 'Swap bird / truck');
    this.swap.classList.add('wide');
    this.top.append(this.swap, this.topButton('?', 'KeyH', 'Controls'));
    this.idle();

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(this.zone, e.pointerId);
      const r = this.zone.getBoundingClientRect();
      // Keep the whole ring on screen.
      this.origin.x = Math.min(Math.max(e.clientX, r.left + 70), r.right - 70);
      this.origin.y = Math.min(Math.max(e.clientY, r.top + 70), r.bottom - 70);
      this.zone.classList.add('active');
      this.place(this.origin.x, this.origin.y);
      this.move(e.clientX, e.clientY);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.controls.touch.x = this.controls.touch.y = 0;
      this.zone.classList.remove('active');
      this.idle();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setDriving(false);
  }

  private topButton(html: string, code: string, title: string) {
    const b = document.createElement('button');
    b.className = 't-btn';
    b.innerHTML = html;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      key('keydown', code);
      key('keyup', code);
    });
    return b;
  }

  /** Rest position of the ring when no thumb is on it. */
  private idle() {
    const r = this.zone.getBoundingClientRect();
    this.place(r.left + Math.min(150, r.width * 0.45), r.bottom - Math.min(150, r.height * 0.45));
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private place(x: number, y: number) {
    const r = this.zone.getBoundingClientRect();
    this.base.style.left = `${x - r.left}px`;
    this.base.style.top = `${y - r.top}px`;
  }

  private move(x: number, y: number) {
    const R = 58;
    let dx = x - this.origin.x;
    let dy = y - this.origin.y;
    const l = Math.hypot(dx, dy);
    if (l > R) (dx *= R / l), (dy *= R / l);
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Small dead zone, then a gentle curve so small movements are fine corrections.
    const curve = (v: number) => {
      const a = Math.max(0, Math.abs(v) - 0.08) / 0.92;
      return Math.sign(v) * Math.pow(a, 1.35);
    };
    this.controls.touch.x = curve(dx / R);
    this.controls.touch.y = curve(dy / R);
  }

  setDriving(d: boolean) {
    for (const code of this.held.values()) key('keyup', code);
    this.held.clear();
    this.pad.replaceChildren(...(d ? DRIVE : FLY).map((b) => this.padButton(b)));
    this.swap.textContent = d ? 'Fly' : 'Drive';
    this.root.classList.toggle('driving', d);
  }

  private padButton(b: Button) {
    const el = document.createElement('button');
    el.className = `t-act ${b.cls ?? ''}`;
    el.textContent = b.label;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      this.held.set(e.pointerId, b.code);
      el.classList.add('on');
      key('keydown', b.code);
      navigator.vibrate?.(8);
    });
    const up = (e: PointerEvent) => {
      if (!this.held.has(e.pointerId)) return;
      this.held.delete(e.pointerId);
      el.classList.remove('on');
      key('keyup', b.code);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return el;
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.controls.touch.x = this.controls.touch.y = 0;
      for (const code of this.held.values()) key('keyup', code);
      this.held.clear();
    } else requestAnimationFrame(() => this.idle());
  }
}
