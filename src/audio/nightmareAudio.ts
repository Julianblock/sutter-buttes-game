/**
 * Sounds for walking the towns, waking and nightmare: your own footsteps,
 * dogs and farm machinery by day; drones, bangs, creaks, knocks, whispers,
 * small running feet and giggling after the nightmare starts. All
 * synthesised, all placed in 3D around the listener (HRTF panners).
 */

export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class NightmareAudio {
  private g: AudioGraph | null = null;
  private bus!: GainNode;
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private clusterGain!: GainNode;
  private machineGain!: GainNode;
  private pulseGain!: GainNode;
  private nextDog = 8;
  private nextPulse = 0;
  private silenceUntil = 0;
  /** Nightmare blend and tension (0..100), set every frame. */
  level = 0;
  tension = 0;

  constructor(private graph: () => AudioGraph | null) {}

  private ready(): AudioGraph | null {
    if (this.g) return this.g.ctx.state === 'running' ? this.g : null;
    const g = this.graph();
    if (!g) return null;
    this.g = g;
    const { ctx } = g;
    this.bus = ctx.createGain();
    this.bus.connect(g.master);

    // The drone: two detuned saws an octave under a sick cluster.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 160;
    this.droneFilter.Q.value = 4;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.bus);
    for (const f of [41.2, 41.7, 61.9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
    }
    this.clusterGain = ctx.createGain();
    this.clusterGain.gain.value = 0;
    this.clusterGain.connect(this.bus);
    for (const f of [311.1, 329.6, 349.2]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rand(0.05, 0.13);
      const lg = ctx.createGain();
      lg.gain.value = 4;
      lfo.connect(lg).connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = 0.33;
      o.connect(og).connect(this.clusterGain);
      o.start();
      lfo.start();
    }
    // Far-off machinery by day: a pump or a tractor, a field or two away.
    const mf = ctx.createBiquadFilter();
    mf.type = 'lowpass';
    mf.frequency.value = 240;
    this.machineGain = ctx.createGain();
    this.machineGain.gain.value = 0;
    mf.connect(this.machineGain).connect(g.master);
    for (const [f, k] of [[29, 1], [58.3, 0.6], [87.5, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = k;
      o.connect(og).connect(mf);
      o.start();
    }
    // Heartbeat-like low pulse when it is close.
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 1;
    this.pulseGain.connect(this.bus);
    return ctx.state === 'running' ? g : null;
  }

  /** Listener pose from the camera. */
  private listen(ctx: AudioContext, p: { x: number; y: number; z: number }, f: { x: number; y: number; z: number }) {
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  private at(x: number, y: number, z: number, ref = 3): AudioNode {
    const { ctx } = this.g!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.1;
    p.maxDistance = 400;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.bus);
    return p;
  }

  private burst(t: number, dur: number, f: number, q: number, gain: number, out: AudioNode, type: BiquadFilterType = 'bandpass', attack = 0.01) {
    const { ctx, noise } = this.g!;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const bf = ctx.createBiquadFilter();
    bf.type = type;
    bf.frequency.value = f;
    bf.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bf).connect(g).connect(out);
    s.start(t, Math.random() * 2, dur + 0.05);
    return bf;
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, out: AudioNode, bp?: [number, number], vib = 0) {
    const { ctx } = this.g!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vib) {
      const l = ctx.createOscillator();
      l.frequency.value = vib;
      const lg = ctx.createGain();
      lg.gain.value = f0 * 0.04;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (bp) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = bp[0];
      f.Q.value = bp[1];
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A child's breathy giggle, a few high syllables tumbling down. */
  private giggle(t: number, out: AudioNode, k: number, n = 5 + Math.floor(Math.random() * 4), base = rand(560, 760)) {
    for (let i = 0; i < n; i++) {
      const ti = t + i * rand(0.09, 0.13);
      const f = base * (1 - i * 0.025) * rand(0.97, 1.05);
      this.tone(ti, 'sawtooth', f * 1.08, f * 0.9, 0.08, 0.09 * k, out, [f * 2.6, 3], 0);
      this.burst(ti, 0.07, 3000, 1.2, 0.05 * k, out);
    }
  }

  /** Several voices laughing together, lower and longer. */
  private laugh(t: number, out: AudioNode, k: number) {
    const base = rand(330, 430);
    for (let i = 0; i < 12; i++) {
      const ti = t + i * rand(0.13, 0.17);
      const f = base * (1 + 0.15 * Math.sin(i * 0.9)) * rand(0.98, 1.03);
      this.tone(ti, 'sawtooth', f, f * 0.82, 0.12, 0.11 * k, out, [f * 2.2, 2.5], 7);
      this.burst(ti, 0.1, 1400, 0.9, 0.06 * k, out);
    }
    this.giggle(t + 0.4, out, k * 0.7, 9, rand(700, 820));
  }

  private whisper(t: number, out: AudioNode, k: number) {
    const syll = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < syll; i++) {
      const ti = t + i * rand(0.16, 0.24);
      const bf = this.burst(ti, rand(0.12, 0.22), rand(1800, 3800), rand(2, 5), 0.07 * k, out, 'bandpass', 0.03);
      bf.frequency.exponentialRampToValueAtTime(rand(1200, 2600), ti + 0.15);
    }
  }

  private bang(t: number, out: AudioNode, k: number) {
    // Sheet metal: a thud, then inharmonic partials ringing out.
    this.burst(t, 0.25, 220, 0.7, 0.5 * k, out, 'lowpass', 0.004);
    for (const [f, d] of [[173, 1.8], [419, 1.3], [655, 1.0], [1029, 0.7], [1611, 0.45]]) this.tone(t, 'sine', f, f * 0.995, d, 0.08 * k, out);
  }

  private creak(t: number, out: AudioNode, k: number) {
    const { ctx } = this.g!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = rand(70, 120);
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.6, t + 0.6);
    o.frequency.linearRampToValueAtTime(f * 1.1, t + 1.3);
    const am = ctx.createGain();
    const l = ctx.createOscillator();
    l.type = 'square';
    l.frequency.value = rand(18, 34);
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    am.gain.value = 0.5;
    l.connect(lg).connect(am.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * k, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(bp).connect(am).connect(g).connect(out);
    o.start(t);
    l.start(t);
    o.stop(t + 1.5);
    l.stop(t + 1.5);
  }

  private knock(t: number, out: AudioNode, k: number) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ti = t + i * rand(0.2, 0.28);
      this.burst(ti, 0.09, 380, 1.2, 0.5 * k, out, 'lowpass', 0.002);
      this.tone(ti, 'sine', 140, 90, 0.12, 0.3 * k, out);
    }
  }

  private step(t: number, out: AudioNode, k: number, light = true) {
    this.burst(t, light ? 0.06 : 0.1, light ? 900 : 500, 0.8, (light ? 0.12 : 0.2) * k, out, 'lowpass', 0.004);
    this.burst(t + 0.01, 0.04, 2400, 1.5, 0.03 * k, out);
  }

  /** Fires from the walker for each footfall. */
  footstep(run: boolean, wet: boolean) {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime;
    const k = run ? 0.9 : 0.6;
    if (wet) this.burst(t, 0.18, 1200, 0.6, 0.12 * k, g.master, 'bandpass', 0.01);
    else {
      this.burst(t, 0.09, 700, 0.7, 0.16 * k, g.master, 'lowpass', 0.003);
      this.burst(t + 0.005, 0.06, 3200, 1.0, 0.04 * k, g.master);
    }
  }

  /** A figure's sound at its position. */
  smiler(e: 'giggle' | 'laugh' | 'step' | 'breath' | 'whisper', x: number, y: number, z: number, k: number) {
    const g = this.ready();
    if (!g || g.ctx.currentTime < this.silenceUntil) return;
    const t = g.ctx.currentTime + 0.02;
    const out = this.at(x, y, z);
    if (e === 'giggle') this.giggle(t, out, k);
    else if (e === 'laugh') this.laugh(t, out, k);
    else if (e === 'step') this.step(t, out, 0.5 * k);
    else if (e === 'whisper') this.whisper(t, out, k);
    else {
      this.burst(t, 1.0, 1100, 1.0, 0.05 * k, out, 'bandpass', 0.6);
      this.burst(t + 1.1, 1.2, 800, 1.0, 0.04 * k, out, 'bandpass', 0.2);
    }
  }

  /** Town noises from the director. */
  ambient(e: 'bang' | 'creak' | 'knock' | 'whisper' | 'silence' | 'footsteps', k: number, x: number, y: number, z: number) {
    const g = this.ready();
    if (!g) return;
    const t = g.ctx.currentTime + 0.02;
    if (e === 'silence') {
      // Everything stops. Even the drone.
      this.silenceUntil = t + 2.8;
      return;
    }
    if (t < this.silenceUntil) return;
    const out = this.at(x, y + 1.5, z, 6);
    if (e === 'bang') this.bang(t, out, k);
    else if (e === 'creak') this.creak(t, out, k);
    else if (e === 'knock') this.knock(t, out, k);
    else if (e === 'whisper') this.whisper(t, this.at(x, y + 1.6, z, 1), k * 0.8);
    else for (let i = 0; i < 6; i++) this.step(t + i * 0.42, out, k, false);
  }

  /** Per frame: listener, drones, the silence, dogs and machinery by day. */
  update(dt: number, s: { cam: { x: number; y: number; z: number }; fwd: { x: number; y: number; z: number }; inTown: boolean; rural: number; night: number; hour: number; active: boolean; snow: number }) {
    const g = this.ready();
    if (!g) return;
    const { ctx } = g;
    const t = ctx.currentTime;
    this.listen(ctx, s.cam, s.fwd);
    const silent = t < this.silenceUntil ? 0 : 1;
    const nm = this.level * (s.active ? 1 : 0.4);
    const tens = this.tension / 100;
    this.bus.gain.setTargetAtTime(silent * (s.active ? 1 : 0.5), t, silent ? 0.6 : 0.05);
    this.droneGain.gain.setTargetAtTime(nm * (0.05 + 0.1 * tens), t, 0.8);
    this.droneFilter.frequency.setTargetAtTime(110 + 380 * tens * tens, t, 1.5);
    this.clusterGain.gain.setTargetAtTime(nm * 0.012 * (0.3 + tens), t, 1.2);
    // Pulse: two soft low thumps, quickening as tension rises.
    if (nm > 0.5 && tens > 0.55 && silent) {
      this.nextPulse -= dt;
      if (this.nextPulse <= 0) {
        this.nextPulse = 1.25 - 0.6 * tens;
        this.tone(t, 'sine', 62, 44, 0.16, 0.22 * tens, this.pulseGain);
        this.tone(t + 0.22, 'sine', 58, 42, 0.14, 0.15 * tens, this.pulseGain);
      }
    }
    // Daytime farm machinery, out in the fields only; nothing in the nightmare.
    const day = 1 - s.night;
    this.machineGain.gain.setTargetAtTime(0.022 * s.rural * day * (1 - this.level) * (s.active ? 1 : 0.3) * (1 - s.snow), t, 2);
    // Dogs in town by day and evening; never in the nightmare (that is the point).
    this.nextDog -= dt;
    if (this.nextDog <= 0) {
      this.nextDog = rand(14, 45);
      if (s.inTown && s.active && this.level < 0.05 && (s.hour > 6 && s.hour < 23)) this.dog();
    }
  }

  private dog() {
    const g = this.g!;
    const t = g.ctx.currentTime + 0.05;
    const a = Math.random() * Math.PI * 2, d = rand(40, 160);
    const l = g.ctx.listener;
    const x = (l.positionX?.value ?? 0) + Math.sin(a) * d, z = (l.positionZ?.value ?? 0) + Math.cos(a) * d;
    const p = g.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.refDistance = 20;
    p.positionX.value = x;
    p.positionY.value = 1;
    p.positionZ.value = z;
    const lp = g.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    p.connect(lp).connect(g.master);
    const n = 2 + Math.floor(Math.random() * 4);
    const f = rand(280, 480);
    for (let i = 0; i < n; i++) {
      const ti = t + i * rand(0.32, 0.5);
      this.tone(ti, 'sawtooth', f * 1.25, f * 0.8, 0.16, 0.12, p, [f * 2.4, 1.4]);
      this.burst(ti, 0.12, 1100, 0.8, 0.05, p);
    }
  }
}
