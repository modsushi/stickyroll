/**
 * Procedural audio. No sample files anywhere in the game.
 *
 * Everything is oscillators, noise buffers and filters, which keeps the payload
 * at zero bytes and — more importantly — lets pitch, brightness and density be
 * driven continuously by gameplay state. A sampled pickup sound cannot climb a
 * scale with your combo; a synthesised one can, and that climb is the single
 * most addictive thing in the mix.
 *
 * Master chain: [voices] -> busses -> compressor -> algorithmic reverb -> limiter.
 */

import { clamp01 } from '../core/Math';
import { save } from '../core/Save';

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  private reverbSend!: GainNode;
  private musicSend!: GainNode;
  private sfxSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private started = false;

  /** Resolves once the context is genuinely running (post user gesture). */
  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.started = true;

    // ── master chain ──────────────────────────────────────────────────────
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    limiter.connect(ctx.destination);

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.2;
    glue.connect(limiter);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(glue);

    // Algorithmic reverb: a small feedback-delay network. Cheaper than loading
    // an impulse response and it never has to be downloaded.
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    wet.connect(this.master);
    for (const [time, fb, cut] of [
      [0.031, 0.66, 5200],
      [0.047, 0.62, 4200],
      [0.071, 0.58, 3400],
      [0.097, 0.52, 2600],
    ] as const) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = time;
      const g = ctx.createGain();
      g.gain.value = fb;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      this.reverbSend.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(d); // feedback loop
      lp.connect(wet);
    }

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = save.data.settings.music;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = save.data.settings.sfx;
    this.sfxBus.connect(this.master);

    // Per-bus reverb sends, kept in lockstep with their bus fader.
    //
    // Voices tap the reverb directly, which makes the send *pre*-fader: turning
    // Music to zero would silence the dry pad but leave its reverb wash playing
    // forever. Routing each send through a gain that mirrors its bus makes the
    // sends post-fader, so a volume slider actually means what it says.
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = save.data.settings.music;
    this.musicSend.connect(this.reverbSend);

    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = save.data.settings.sfx;
    this.sfxSend.connect(this.reverbSend);

    // Shared white-noise buffer; every noise voice reads from this one.
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    if (ctx.state === 'suspended') await ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  setMusicVolume(v: number) {
    save.setSetting('music', v);
    if (!this.musicBus) return;
    this.rampTo(this.musicBus.gain, v, 0.08);
    this.rampTo(this.musicSend.gain, v, 0.08);
  }

  setSfxVolume(v: number) {
    save.setSetting('sfx', v);
    if (!this.sfxBus) return;
    this.rampTo(this.sfxBus.gain, v, 0.08);
    this.rampTo(this.sfxSend.gain, v, 0.08);
  }

  /** Ducks everything for pause/menus without stopping the graph. */
  duck(amount: number, time = 0.18) {
    if (this.master) this.rampTo(this.master.gain, 0.9 * (1 - clamp01(amount)) + 0.02, time);
  }

  rampTo(param: AudioParam, value: number, time: number) {
    const t = this.now;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + time);
  }

  // ── voice primitives ────────────────────────────────────────────────────

  osc(type: OscillatorType, freq: number, at: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    return o;
  }

  noise(): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    return n;
  }

  gain(v = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /**
   * Sends a node to the shared reverb at `amount` (0..1), through its bus's
   * post-fader send so the volume sliders govern the wet signal too.
   */
  send(node: AudioNode, amount: number, bus: 'sfx' | 'music' = 'sfx') {
    if (amount <= 0 || !this.ctx) return;
    const g = this.gain(amount);
    node.connect(g);
    g.connect(bus === 'music' ? this.musicSend : this.sfxSend);
  }

  /**
   * Standard percussive envelope. Returns the gain node to route from.
   * Using setTargetAtTime for the tail gives a natural exponential decay
   * without the click that exponentialRampToValueAtTime(0) would cause.
   */
  env(at: number, peak: number, attack: number, decay: number, sustainTo = 0.0001): GainNode {
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(sustainTo, at + attack, decay / 3);
    return g;
  }
}

export const audio = new AudioEngine();
