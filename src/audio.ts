// Procedural Web Audio (spec 06, Addendum: Audio). 0 bytes of samples. No screams, no music.
import type { Client } from './client/client';
import { E, T } from './game/protocol';

export class Audio {
  ctx: AudioContext | null = null; master!: GainNode; sfx!: GainNode;
  private noiseBuf: AudioBuffer | null = null; private voices = 0;
  private client: Client | null = null; private lastMoney = -1; private rotor: { g: GainNode; p: PannerNode } | null = null;
  volume = 0.8;
  constructor(private muted: boolean) {
    try { const v = JSON.parse(localStorage.getItem('esc.settings') || '{}').volume; if (typeof v === 'number') this.volume = v / 100; } catch { /* */ }
    const resume = () => { this.ensure(); this.ctx?.resume(); };
    addEventListener('pointerdown', resume); addEventListener('keydown', resume);
  }
  private ensure() {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
  }
  setVolume(v: number) { this.volume = v; if (this.ctx && !this.muted) this.master.gain.value = v; }
  private out(pos?: number[], ref = 5): AudioNode | null {
    const c = this.ctx; if (!c || this.voices > 24) return null;
    if (!pos) return this.sfx;
    const cam = this.client?.stage.camera.position; if (cam && Math.hypot(pos[0] - cam.x, pos[1] + cam.z) > 300) return null;
    const p = c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 300; p.rolloffFactor = 1;
    p.positionX.value = pos[0]; p.positionY.value = pos[2]; p.positionZ.value = -pos[1]; p.connect(this.sfx); return p;
  }
  private noise(dest: AudioNode, dur: number, gain: number, filt: BiquadFilterType, freq: number, q = 0.8, at = 0) {
    const c = this.ctx!, t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = filt; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05); this.track(s);
    return f;
  }
  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0) {
    const c = this.ctx!, t = c.currentTime + at, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05); this.track(o);
  }
  private track(n: AudioScheduledSourceNode) { this.voices++; n.onended = () => this.voices--; }
  shot(weapon: string, pos: number[] | undefined, own: boolean) {
    const d = this.out(own ? undefined : pos); if (!d) return;
    const cam = this.client?.stage.camera.position, far = !own && pos && cam ? Math.hypot(pos[0] - cam.x, pos[1] + cam.z) > 80 : false;
    let dest: AudioNode = d;
    if (far) { const f = this.ctx!.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.connect(d); dest = f; this.noise(f, 0.3, 0.1, 'lowpass', 600); }
    const k = far ? 0.6 : 1;
    if (weapon === 'shotgun') { this.noise(dest, 0.12, 1.0 * k, 'lowpass', 1200); this.tone(dest, 'sine', 90, 40, 0.15, 0.8 * k); }
    else if (weapon === 'rifle') { this.noise(dest, 0.045, 0.7 * k, 'bandpass', 2400); this.tone(dest, 'sine', 120, 50, 0.08, 0.5 * k); }
    else { this.noise(dest, 0.06, 0.8 * k, 'bandpass', 1800); this.tone(dest, 'sine', 150, 60, 0.08, 0.6 * k); }
  }
  ui(kind: 'step' | 'select' | 'money' | 'error' | 'starUp' | 'starDown' | 'beep' | 'escape') {
    this.ensure(); const d = this.out(); if (!d) return;
    switch (kind) {
      case 'step': this.tone(d, 'sine', 1200, 1200, 0.02, 0.2); break;
      case 'select': this.tone(d, 'sine', 660, 660, 0.06, 0.25); this.tone(d, 'sine', 990, 990, 0.06, 0.25, 0.06); break;
      case 'money': this.tone(d, 'sine', 1300, 1300, 0.12, 0.3); this.tone(d, 'sine', 1900, 1900, 0.12, 0.3, 0.04); break;
      case 'error': this.tone(d, 'square', 200, 200, 0.12, 0.2); break;
      case 'starUp': [880, 740, 600].forEach((f, i) => this.tone(d, 'square', f, f, 0.13, 0.35 * 0.4, i * 0.13)); break;
      case 'starDown': [600, 740, 880].forEach((f, i) => this.tone(d, 'sine', f, f, 0.13, 0.3, i * 0.13)); break;
      case 'beep': this.tone(d, 'sine', 880, 880, 0.08, 0.3); break;
      case 'escape': [523, 659, 784, 1047].forEach((f, i) => this.tone(d, 'triangle', f, f, 0.6, 0.4, i * 0.25)); break;
    }
  }
  blast(pos: number[]) {
    const d = this.out(pos, 15); if (!d) return;
    const f = this.noise(d, 1.2, 1.0, 'lowpass', 1500); f.frequency.exponentialRampToValueAtTime(150, this.ctx!.currentTime + 1.2);
    this.tone(d, 'sine', 45, 40, 0.4, 1.0);
  }
  attach(c: Client) {
    this.client = c;
    const orig = c.onMessage.bind(c);
    c.onMessage = (m) => {
      orig(m);
      if (m.t === 'shotFx') this.shot(m.weapon, m.origin, false);
      else if (m.t === 'blast') this.blast(m.pos);
      else if (m.t === 'msg') {
        const t = m.text;
        if (/^Not enough money|^No car close enough/.test(t)) this.ui('error');
        else if (/^Wanted level/.test(t)) this.ui('starUp');
        else if (/^They lost your trail|^The heat is off/.test(t)) this.ui('starDown');
        else if (/^(Hold the pier|Hold the border|Boarding): \d+ s/.test(t)) this.ui('beep');
        else if (/^ESCAPED/.test(t)) this.ui('escape');
      }
    };
    c.link.onMessage = c.onMessage;
    const fx = c.fx.shot.bind(c.fx);
    c.fx.shot = (o, e, n) => { fx(o, e, n); if (o.distanceTo(c.stage.camera.position) < 6) this.shot(c.priv?.weapons[c.priv.active]?.type ?? 'pistol', undefined, true); };
    addEventListener('keydown', (e) => { if (e.code === 'ArrowUp' || e.code === 'ArrowDown') this.ui('step'); if (e.code === 'KeyE' && c.focus) this.ui('select'); });
  }
  frame(_dt: number) {
    const c = this.client; if (!c || !this.ctx) return;
    const m = c.director?.money ?? -1; if (this.lastMoney >= 0 && m > this.lastMoney) this.ui('money'); this.lastMoney = m;
    const cam = c.stage.camera.position, l = this.ctx.listener;
    if (l.positionX) { l.positionX.value = cam.x; l.positionY.value = cam.y; l.positionZ.value = cam.z; const f = c.stage.camera.getWorldDirection(new (cam.constructor as any)()); l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z; }
    // helicopter rotor loop
    const snap = (c as any).snaps.at(-1)?.recs as Map<number, number[]> | undefined;
    let heli: number[] | undefined; if (snap) for (const r of snap.values()) if (r[E.t] === T.HELI) heli = r;
    if (heli && !this.rotor) {
      const p = this.out([heli[E.x], heli[E.y], heli[E.z]], 30) as PannerNode | null;
      if (p && p instanceof PannerNode) {
        const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
        const g = this.ctx.createGain(); g.gain.value = 0.6; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 18; const lg = this.ctx.createGain(); lg.gain.value = 0.4;
        lfo.connect(lg).connect(g.gain); s.connect(f).connect(g).connect(p); s.start(); lfo.start();
        this.rotor = { g, p };
      }
    } else if (heli && this.rotor) { this.rotor.p.positionX.value = heli[E.x]; this.rotor.p.positionY.value = heli[E.z]; this.rotor.p.positionZ.value = -heli[E.y]; }
    else if (!heli && this.rotor) { this.rotor.g.gain.value = 0; this.rotor.p.disconnect(); this.rotor = null; }
  }
}
