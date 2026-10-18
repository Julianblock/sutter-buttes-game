/**
 * Procedural soundscape: airflow over the wings, wingbeats, and the valley's
 * voices by season and hour — meadowlarks, crickets, chorus frogs, geese,
 * cattle, passing cars — plus each species' own call. Everything is
 * synthesised with WebAudio; no samples.
 */

export interface AudioState {
  speed: number;
  agl: number;
  flapPhase: number;
  flapAmount: number;
  perched: boolean;
  night: number;
  month: number; // 1..12
  hour: number; // 0..24 solar
  wet: number; // 0..1 wetland / water nearby
  grass: number; // 0..1 open grassland nearby
  geese: number; // distance to nearest goose flock (m)
  cattle: number; // distance to nearest cow (m)
  car: number; // distance to nearest vehicle (m)
  carSpeed: number;
  active: boolean; // flying (not in the menu)
  drive: number; // 1 while in the pickup
  rpm: number; // 0..1
  throttle: number;
  tyre: number; // surface roughness 0..1
  slip: number; // 0..1 lateral slide
  horn: boolean;
  rain: number; // rainfall 0..1
  snow: number; // snow cover 0..1 (hushes everything)
  roadWet: number; // ground wetness 0..1 (tyre swish)
  windSpeed: number; // surface wind (m/s)
}

type CallType = 'scream' | 'kak' | 'whistle' | 'honk' | 'bugle' | 'croak' | 'shriek' | 'chitter' | 'hiss';

const CALLS: Record<string, CallType> = {
  redtail: 'scream',
  goldeneagle: 'whistle',
  vulture: 'hiss',
  prairiefalcon: 'kak',
  peregrine: 'kak',
  kite: 'whistle',
  harrier: 'kak',
  snowgoose: 'honk',
  crane: 'bugle',
  egret: 'croak',
  pelican: 'croak',
  barnowl: 'shriek',
  baldeagle: 'chitter',
};

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

export class SoundScape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private whistleFilter!: BiquadFilterNode;
  private roadGain!: GainNode;
  private roadFilter!: BiquadFilterNode;
  private ambience!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineOsc: { o: OscillatorNode; mul: number }[] = [];
  private tyreGain!: GainNode;
  private tyreFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private hornGain!: GainNode;
  private rainHiss!: GainNode;
  private rainHissFilter!: BiquadFilterNode;
  private rainPatter!: GainNode;
  private roofDrum!: GainNode;
  private dripT = 0;
  private lastSin = 0;
  private timers = { lark: 4, cricket: 0, frog: 0, honk: 0, moo: 8, coyote: 30, blackbird: 6 };
  private crickets: { rate: number; pan: number; next: number }[] = [];
  muted = false;
  volume = 0.8;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);

    // Pink-ish noise buffer shared by wind, flaps and hisses.
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.noise.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029591;
        b1 = 0.985 * b1 + w * 0.032534;
        b2 = 0.95 * b2 + w * 0.048056;
        d[i] = (b0 + b1 + b2 + w * 0.05) * 0.9;
      }
    }
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    };
    // Rushing air: low roar that opens up with speed.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);
    // High whistle of a stoop.
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.Q.value = 6;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    loop().connect(this.whistleFilter).connect(this.whistleGain).connect(this.master);
    // Tyre roar from the nearest road.
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 700;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    loop().connect(this.roadFilter).connect(this.roadGain).connect(this.ambience);

    // Pickup: V8 firing note, tyre roar, skid squeal and horn.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sine', 0.25, 0.6]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.engineFilter);
      o.start();
      this.engineOsc.push({ o, mul });
    }
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'lowpass';
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    loop().connect(this.tyreFilter).connect(this.tyreGain).connect(this.master);
    const sq = ctx.createBiquadFilter();
    sq.type = 'bandpass';
    sq.frequency.value = 1300;
    sq.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    loop().connect(sq).connect(this.squealGain).connect(this.master);
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 2200;
    hf.connect(this.hornGain).connect(this.master);
    for (const f of [349, 440]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }

    // Rain: broadband hiss of drops on grass and leaves, a softer patter
    // underneath, and a hollow drumming on the cab roof.
    this.rainHissFilter = ctx.createBiquadFilter();
    this.rainHissFilter.type = 'bandpass';
    this.rainHissFilter.frequency.value = 4200;
    this.rainHissFilter.Q.value = 0.45;
    this.rainHiss = ctx.createGain();
    this.rainHiss.gain.value = 0;
    loop().connect(this.rainHissFilter).connect(this.rainHiss).connect(this.master);
    const pf = ctx.createBiquadFilter();
    pf.type = 'bandpass';
    pf.frequency.value = 1100;
    pf.Q.value = 0.8;
    this.rainPatter = ctx.createGain();
    this.rainPatter.gain.value = 0;
    loop().connect(pf).connect(this.rainPatter).connect(this.master);
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 420;
    rf.Q.value = 1.4;
    this.roofDrum = ctx.createGain();
    this.roofDrum.gain.value = 0;
    loop().connect(rf).connect(this.roofDrum).connect(this.master);

    for (let i = 0; i < 7; i++) this.crickets.push({ rate: rand(0.9, 1.1), pan: rand(-1, 1), next: rand(0, 1) });
  }

  /**
   * Thunder from a strike `dist` metres away, arriving at the speed of sound:
   * a ripping crack when close, a long low rumble rolling in from afar.
   */
  thunder(dist: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + dist / 343;
    const near = Math.max(0, 1 - dist / 2500);
    const loud = Math.min(0.9, 900 / Math.max(dist, 300));
    const pan = rand(-0.7, 0.7);
    const out = this.panner(pan, this.master);
    if (near > 0) {
      this.noiseBurst(t, 0.25 + near * 0.3, 2500, 0.4, loud * near * 0.8, out, 'bandpass');
      this.noiseBurst(t + 0.05, 0.6, 600, 0.5, loud * near * 0.6, out, 'bandpass');
    }
    const len = 2.5 + Math.min(5, dist / 1500);
    const cutoff = 90 + 500 * near;
    for (let i = 0; i < 5; i++) {
      const ti = t + 0.1 + i * len * 0.17 + rand(0, 0.3);
      this.noiseBurst(ti, len * rand(0.35, 0.6), cutoff * rand(0.7, 1.3), 0.7, loud * rand(0.35, 0.7), out, 'lowpass');
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.1);
  }

  private panner(pan: number, dest: AudioNode = this.ambience) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  private noiseBurst(t: number, dur: number, f: number, q: number, gain: number, out: AudioNode, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = type;
    bf.frequency.value = f;
    bf.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bf).connect(g).connect(out);
    s.start(t, Math.random() * 2, dur + 0.05);
    return bf;
  }

  /** A tone with pitch and gain envelopes: [time offset, value] pairs. */
  private tone(t: number, type: OscillatorType, freq: [number, number][], gain: [number, number][], out: AudioNode, filter?: { f: number; q: number }) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq[0][1], t);
    for (const [dt, f] of freq.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t + dt);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (const [dt, v] of gain) g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + dt);
    let node: AudioNode = o;
    if (filter) {
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.value = filter.f;
      bf.Q.value = filter.q;
      o.connect(bf);
      node = bf;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + gain[gain.length - 1][0] + 0.05);
  }

  /** The player's own species call (key V). */
  /** Truck hitting something: low body thud plus a crunch, scaled by impact speed. */
  crash(speed: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = Math.min(1, speed / 12);
    this.noiseBurst(t, 0.35 + k * 0.3, 140, 0.8, 0.5 * k + 0.1, this.master, 'lowpass');
    this.noiseBurst(t + 0.01, 0.18 + k * 0.25, 1800, 0.7, 0.25 * k + 0.03, this.master, 'bandpass');
    this.tone(t, 'sine', [[0, 70], [0.25, 38]], [[0.01, 0.4 * k + 0.08], [0.35, 0.0001]], this.master);
  }

  call(speciesId: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const out = this.master;
    switch (CALLS[speciesId] ?? 'whistle') {
      case 'scream': {
        // Red-tail: a hoarse, descending keee-eeer.
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(3200, t);
        o.frequency.exponentialRampToValueAtTime(2900, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(1700, t + 1.6);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 90;
        const lg = ctx.createGain();
        lg.gain.value = 220;
        lfo.connect(lg).connect(o.frequency);
        const bf = ctx.createBiquadFilter();
        bf.type = 'bandpass';
        bf.frequency.value = 2600;
        bf.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.12);
        g.gain.setValueAtTime(0.22, t + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
        o.connect(bf).connect(g).connect(out);
        this.noiseBurst(t, 1.6, 2800, 3, 0.12, out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 1.8);
        lfo.stop(t + 1.8);
        break;
      }
      case 'kak':
        for (let i = 0; i < 7; i++) {
          const ti = t + i * 0.16;
          this.tone(ti, 'sawtooth', [[0, 2300], [0.1, 1900]], [[0.01, 0.12], [0.11, 0.0001]], out, { f: 2200, q: 2 });
        }
        break;
      case 'whistle':
        this.tone(t, 'sine', [[0, 1900], [0.15, 2600], [0.5, 2100]], [[0.05, 0.16], [0.45, 0.12], [0.6, 0.0001]], out);
        this.tone(t + 0.75, 'sine', [[0, 2000], [0.2, 2500]], [[0.04, 0.12], [0.3, 0.0001]], out);
        break;
      case 'honk':
        for (let i = 0; i < 3; i++) this.honk(t + i * 0.32, 0, 0.25, out);
        break;
      case 'bugle': {
        // Sandhill crane: a wooden, rolling garooo-a-a.
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(820, t);
        o.frequency.exponentialRampToValueAtTime(700, t + 1.4);
        const am = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 22;
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        am.gain.value = 0.5;
        lfo.connect(lg).connect(am.gain);
        const bf = ctx.createBiquadFilter();
        bf.type = 'bandpass';
        bf.frequency.value = 1500;
        bf.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(bf).connect(am).connect(g).connect(out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 1.6);
        lfo.stop(t + 1.6);
        break;
      }
      case 'croak':
        this.tone(t, 'sawtooth', [[0, 260], [0.4, 180]], [[0.03, 0.25], [0.45, 0.0001]], out, { f: 700, q: 1.5 });
        break;
      case 'shriek':
        this.noiseBurst(t, 1.8, 4200, 2.5, 0.3, out);
        break;
      case 'chitter':
        for (let i = 0; i < 8; i++) {
          const ti = t + i * 0.09 + (i > 3 ? 0.2 : 0);
          const f = 3400 - i * 120;
          this.tone(ti, 'sine', [[0, f], [0.06, f * 0.9]], [[0.01, 0.12], [0.07, 0.0001]], out);
        }
        break;
      case 'hiss':
        this.noiseBurst(t, 0.9, 1800, 0.7, 0.15, out);
        break;
    }
  }

  private honk(t: number, pan: number, gain: number, out?: AudioNode) {
    const f = rand(520, 760);
    this.tone(t, 'sawtooth', [[0, f], [0.05, f * 1.12], [0.16, f * 0.92]], [[0.02, gain], [0.12, gain * 0.7], [0.2, 0.0001]], out ?? this.panner(pan), { f: 1300, q: 2.2 });
  }

  /** Western meadowlark: a run of fluty, falling whistles ending in a gurgle. */
  private meadowlark(t: number, pan: number, gain: number) {
    const out = this.panner(pan);
    const notes = [
      [2600, 3200, 0.22],
      [3100, 2500, 0.18],
      [2200, 2700, 0.12],
      [3300, 2900, 0.09],
      [2900, 2300, 0.08],
      [2500, 1900, 0.15],
    ];
    let ti = t;
    for (const [a, b, d] of notes) {
      this.tone(ti, 'sine', [[0, a * rand(0.97, 1.03)], [d, b]], [[0.02, gain], [d, 0.0001]], out);
      ti += d + 0.035;
    }
  }

  /** Red-winged blackbird conk-la-ree from the marsh. */
  private blackbird(t: number, pan: number, gain: number) {
    const out = this.panner(pan);
    this.tone(t, 'triangle', [[0, 1500], [0.08, 2400]], [[0.02, gain], [0.12, 0.0001]], out);
    this.tone(t + 0.16, 'triangle', [[0, 2800], [0.05, 3000]], [[0.01, gain * 0.7], [0.06, 0.0001]], out);
    // Buzzy trill.
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 3600;
    const am = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 55;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    am.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 3800;
    bf.Q.value = 3;
    const g = ctx.createGain();
    const t2 = t + 0.26;
    g.gain.setValueAtTime(0.0001, t2);
    g.gain.exponentialRampToValueAtTime(gain * 0.8, t2 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.7);
    o.connect(bf).connect(am).connect(g).connect(out);
    o.start(t2);
    lfo.start(t2);
    o.stop(t2 + 0.75);
    lfo.stop(t2 + 0.75);
  }

  /** Pacific chorus frog: a two-part rib-it. */
  private frog(t: number, pan: number, gain: number) {
    const out = this.panner(pan);
    const f = rand(1600, 2200);
    for (let i = 0; i < 2; i++) {
      const ti = t + i * 0.13;
      for (let k = 0; k < 6; k++)
        this.tone(ti + k * 0.012, 'square', [[0, f * (i ? 1.12 : 1)], [0.01, f * 0.95]], [[0.002, gain], [0.009, 0.0001]], out, { f: f * 1.1, q: 4 });
    }
  }

  private moo(t: number, pan: number, gain: number) {
    const out = this.panner(pan);
    const f = rand(105, 150);
    this.tone(t, 'sawtooth', [[0, f], [0.4, f * 1.25], [1.4, f * 0.85]], [[0.25, gain], [1.1, gain * 0.8], [1.6, 0.0001]], out, { f: 480, q: 1.2 });
  }

  private coyote(t: number, pan: number, gain: number) {
    const out = this.panner(pan);
    // Yips building into a wavering howl.
    for (let i = 0; i < 5; i++) {
      const ti = t + i * 0.18;
      const f = rand(700, 1100);
      this.tone(ti, 'sine', [[0, f], [0.08, f * 1.4]], [[0.02, gain * 0.7], [0.1, 0.0001]], out);
    }
    this.tone(t + 1.1, 'sine', [[0, 600], [0.5, 1200], [1.6, 1050], [2.3, 700]], [[0.3, gain], [1.8, gain * 0.8], [2.4, 0.0001]], out);
  }

  update(dt: number, s: AudioState) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = 0.15;

    // Pickup sounds; the cab muffles the wind.
    const drv = s.active ? s.drive : 0;
    const firing = 26 + s.rpm * 230;
    for (const e of this.engineOsc) e.o.frequency.setTargetAtTime(firing * e.mul * (1 + Math.sin(t * 31) * 0.004), t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + s.rpm * 900 + s.throttle * 1100, t, 0.08);
    this.engineGain.gain.setTargetAtTime(drv * (0.05 + s.throttle * 0.07 + s.rpm * 0.05), t, 0.08);
    const sp = Math.abs(s.speed) * drv;
    // Wet tarmac: tyres hiss and swish through the film of water.
    const swish = s.roadWet * (1 - s.tyre);
    this.tyreGain.gain.setTargetAtTime(Math.min(0.35, sp * 0.006 * (1 + s.tyre * 2.5 + swish * 1.8)), t, 0.15);
    this.tyreFilter.frequency.setTargetAtTime(250 + sp * 18 + s.tyre * 500 + swish * 2600, t, 0.15);
    this.squealGain.gain.setTargetAtTime(drv * Math.max(0, s.slip - 0.25) * (1 - s.tyre) * 0.5 * Math.min(1, sp / 6), t, 0.05);
    this.hornGain.gain.setTargetAtTime(s.horn && drv ? 0.07 : 0, t, 0.02);

    // Wind: louder and brighter with airspeed; quieter when perched or in the menu.
    const v = (s.active && !s.perched ? s.speed : 1.5) * (1 - drv * 0.55);
    const gale = Math.pow(s.windSpeed / 12, 2) * 0.25 * (1 - drv * 0.6);
    this.windGain.gain.setTargetAtTime(Math.min(0.9, 0.04 + Math.pow(v / 22, 2) * 0.5 + gale), t, k);
    this.windFilter.frequency.setTargetAtTime(180 + v * v * 3.2, t, k);
    const stoop = Math.max(0, (v - 28) / 30);
    this.whistleGain.gain.setTargetAtTime(stoop * 0.25, t, k);
    this.whistleFilter.frequency.setTargetAtTime(900 + v * 28, t, k);

    // Wingbeat: a soft whump on each downstroke.
    const sn = Math.sin(s.flapPhase);
    if (s.active && s.flapAmount > 0.25 && this.lastSin > 0 && sn <= 0) {
      this.noiseBurst(t, 0.16, rand(380, 620), 0.9, 0.18 * s.flapAmount, this.master, 'bandpass');
    }
    this.lastSin = sn;

    // Rain: hiss and patter outside, a muffled drumming on the roof in the cab.
    const r = s.active ? s.rain : s.rain * 0.4;
    const ground = Math.max(0.35, Math.min(1, 1.2 - s.agl / 300));
    this.rainHiss.gain.setTargetAtTime(r * 0.16 * ground * (1 - drv * 0.7), t, 0.4);
    this.rainHissFilter.frequency.setTargetAtTime(drv ? 1800 : 4200, t, 0.2);
    this.rainPatter.gain.setTargetAtTime(r * 0.12 * ground * (1 - drv * 0.5), t, 0.4);
    this.roofDrum.gain.setTargetAtTime(r * drv * 0.45, t, 0.3);
    // Individual fat drops ticking on the glass and roof.
    this.dripT -= dt * r * (drv ? 22 : 9);
    while (this.dripT < 0) {
      this.dripT += rand(0.3, 1.7);
      const ti = t + rand(0, 0.08);
      this.noiseBurst(ti, 0.03, drv ? rand(1500, 3200) : rand(2500, 6000), 3, (drv ? 0.06 : 0.025) * rand(0.4, 1), this.panner(rand(-0.8, 0.8), this.master));
    }

    // Ground ambience fades with height above ground; fresh snow hushes it.
    const near = Math.max(0, Math.min(1, 1.15 - s.agl / 260));
    this.ambience.gain.setTargetAtTime((near * 0.9 + 0.1) * (1 - 0.55 * s.snow), t, 0.5);
    const raining = s.rain > 0.15;

    // Road noise from the nearest vehicle.
    const road = s.car < 300 ? Math.min(0.35, (40 / Math.max(s.car, 8)) * (s.carSpeed / 25)) : 0;
    this.roadGain.gain.setTargetAtTime(road, t, 0.3);
    this.roadFilter.frequency.setTargetAtTime(400 + s.carSpeed * 25, t, 0.3);

    const T = this.timers;
    for (const key of Object.keys(T) as (keyof typeof T)[]) T[key] -= dt;
    const m = s.month;
    const day = s.night < 0.3;
    const breeding = m >= 3 && m <= 7;

    if (day && breeding && !raining && s.grass > 0.3 && T.lark <= 0) {
      this.meadowlark(t, rand(-0.8, 0.8), 0.05 * s.grass * near);
      T.lark = rand(5, 14);
    }
    if (day && !raining && s.wet > 0.3 && T.blackbird <= 0) {
      this.blackbird(t, rand(-0.9, 0.9), 0.04 * s.wet * near);
      T.blackbird = rand(3, 9);
    }
    // Chorus frogs: winter and spring nights near water, loudest in the rain.
    const frogWet = Math.min(1, s.wet + s.rain * 0.6);
    if ((s.night > 0.5 || s.rain > 0.3) && (m <= 5 || m >= 11 || s.rain > 0.3) && frogWet > 0.15 && T.frog <= 0) {
      const n = 1 + Math.floor(frogWet * 4);
      for (let i = 0; i < n; i++) this.frog(t + rand(0, 0.8), rand(-1, 1), 0.04 * near * rand(0.4, 1));
      T.frog = rand(0.4, 1.4);
    }
    // Field crickets on warm nights; Dolbear's law sets the chirp rate.
    if (s.night > 0.4 && m >= 5 && m <= 10 && !raining && s.snow < 0.1) {
      const tempC = [3, 5, 7, 9, 12, 15, 17, 16, 14, 10, 6, 3][m - 1] + 4;
      const perMin = Math.max(20, 7 * tempC + 30) * 0.5;
      for (const c of this.crickets) {
        c.next -= dt;
        if (c.next <= 0) {
          const out = this.panner(c.pan);
          for (let i = 0; i < 3; i++) this.tone(t + i * 0.045, 'sine', [[0, 4600], [0.03, 4500]], [[0.005, 0.02 * near], [0.03, 0.0001]], out);
          c.next = (60 / perMin) * c.rate;
        }
      }
    }
    if (s.geese < 1500 && T.honk <= 0) {
      const g = Math.min(0.1, 30 / Math.max(s.geese, 30));
      const n = 1 + Math.floor(g * 40);
      for (let i = 0; i < n; i++) this.honk(t + rand(0, 0.9), rand(-1, 1), g * rand(0.3, 1));
      T.honk = rand(0.3, 1.2);
    }
    if (s.cattle < 250 && T.moo <= 0) {
      this.moo(t, rand(-0.7, 0.7), Math.min(0.12, 12 / Math.max(s.cattle, 20)));
      T.moo = rand(7, 25);
    }
    if (s.night > 0.6 && T.coyote <= 0) {
      if (Math.random() < 0.5) this.coyote(t, rand(-1, 1), 0.035);
      T.coyote = rand(40, 120);
    }
  }
}
