/**
 * Adaptive music + the rolling bed.
 *
 * The track is a step sequencer running at 72 BPM built from five layers. Each
 * growth tier switches another layer on, so progress is audible even when the
 * player's eyes never leave the ball — the mix literally thickens as you take
 * over the city. Layers fade in over a bar rather than snapping, so a tier-up
 * lands as a swell rather than an edit.
 *
 * The rolling bed is separate: filtered noise whose cutoff and gain track ball
 * speed and radius. It is what makes a 6-metre ball feel like six metres.
 */

import { audio } from './AudioEngine';
import { clamp01, lerp } from '../core/Math';

const BPM = 72;
const STEP = 60 / BPM / 4; // sixteenth notes
const STEPS = 32;

const ROOT = 55; // A1

/** Scale degrees for a warm, unhurried A-minor-pentatonic loop. */
const BASS = [0, 0, 7, 0, 5, 0, 7, 3];
const ARP = [12, 15, 19, 22, 19, 15, 24, 19, 12, 15, 19, 22, 27, 22, 19, 15];
const BELL = [24, -1, 27, -1, 31, -1, 27, -1, 24, -1, 22, -1, 19, -1, 22, -1];

const semi = (n: number) => ROOT * Math.pow(2, n / 12);

interface Layer {
  gain: GainNode;
  target: number;
  /** Tier at which this layer joins the mix. */
  from: number;
  level: number;
}

export class Music {
  private layers: Record<string, Layer> = {};
  private pad?: { osc: OscillatorNode[]; filter: BiquadFilterNode };
  private roll?: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private step = 0;
  private nextTime = 0;
  private running = false;

  start() {
    const a = audio;
    if (!a.ready || this.running) return;
    this.running = true;

    for (const [name, from, level] of [
      ['pad', 0, 0.16],
      ['bass', 1, 0.2],
      ['arp', 2, 0.1],
      ['bell', 4, 0.075],
      ['perc', 5, 0.09],
    ] as const) {
      const g = a.gain(0);
      g.connect(a.musicBus);
      this.layers[name] = { gain: g, target: 0, from, level };
    }

    // Sustained pad: three detuned saws through a slow-moving lowpass. Runs
    // continuously; the sequencer only handles the rhythmic layers.
    const filter = a.filter('lowpass', 700, 1.2);
    filter.connect(this.layers.pad.gain);
    a.send(this.layers.pad.gain, 0.6, 'music');
    const osc: OscillatorNode[] = [];
    for (const [iv, detune] of [
      [0, -7],
      [7, 5],
      [12, -3],
      [15, 9],
    ] as const) {
      const o = a.osc('sawtooth', semi(12 + iv), a.now);
      o.detune.setValueAtTime(detune, a.now);
      o.connect(filter);
      o.start(a.now);
      osc.push(o);
    }
    this.pad = { osc, filter };

    a.send(this.layers.arp.gain, 0.5, 'music');
    a.send(this.layers.bell.gain, 0.7, 'music');

    this.nextTime = a.now + 0.1;
    this.setTier(0);
    this.startRolling();
  }

  /** Enables every layer up to `tier`, fading each in over ~a bar. */
  setTier(tier: number) {
    const a = audio;
    if (!a.ready) return;
    for (const l of Object.values(this.layers)) {
      const on = tier >= l.from;
      const target = on ? l.level : 0;
      if (target !== l.target) {
        l.target = target;
        a.rampTo(l.gain.gain, target, on ? 2.2 : 0.6);
      }
    }
    // Open the pad up as the city falls, so late game sounds brighter and bigger.
    if (this.pad) a.rampTo(this.pad.filter.frequency, 700 + tier * 220, 2.5);
  }

  /** Called every frame; schedules a little ahead of the audio clock. */
  update(dt: number) {
    const a = audio;
    if (!this.running || !a.ready) return;
    void dt; // scheduling is driven by the audio clock, not the frame clock
    const lookahead = a.now + 0.12;
    let guard = 0;
    while (this.nextTime < lookahead && guard++ < 16) {
      this.scheduleStep(this.step, this.nextTime);
      this.step = (this.step + 1) % STEPS;
      this.nextTime += STEP;
    }
  }

  private scheduleStep(i: number, at: number) {
    const a = audio;

    // Bass: eighth notes.
    if (i % 4 === 0) {
      const n = BASS[(i / 4) % BASS.length];
      const o = a.osc('triangle', semi(n), at);
      const g = a.env(at, 1, 0.01, 0.34);
      const lp = a.filter('lowpass', 900, 1.4);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.layers.bass.gain);
      o.start(at);
      o.stop(at + 0.7);
    }

    // Arp: sixteenths, plucked.
    {
      const n = ARP[i % ARP.length];
      const o = a.osc('triangle', semi(n), at);
      const g = a.env(at, 1, 0.004, 0.13);
      const lp = a.filter('lowpass', 2600, 1);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.layers.arp.gain);
      o.start(at);
      o.stop(at + 0.35);
    }

    // Bell: sparse high sines, the "prize" colour in the palette.
    {
      const n = BELL[i % BELL.length];
      if (n >= 0 && i % 2 === 0) {
        const o = a.osc('sine', semi(n), at);
        const g = a.env(at, 1, 0.006, 0.6);
        o.connect(g);
        g.connect(this.layers.bell.gain);
        o.start(at);
        o.stop(at + 1.2);
      }
    }

    // Perc: soft filtered-noise shaker on the offbeats.
    if (i % 4 === 2) {
      const n = a.noise();
      const f = a.filter('bandpass', 6500, 2.2);
      const g = a.env(at, 1, 0.002, 0.05);
      n.connect(f);
      f.connect(g);
      g.connect(this.layers.perc.gain);
      n.start(at);
      n.stop(at + 0.12);
    }
  }

  // ── rolling bed ─────────────────────────────────────────────────────────

  private startRolling() {
    const a = audio;
    const src = a.noise();
    const filter = a.filter('lowpass', 300, 3.5);
    const gain = a.gain(0);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(a.sfxBus);
    src.start(a.now);
    this.roll = { src, filter, gain };
  }

  /**
   * @param speed  current ball speed
   * @param maxSpeed speed cap at this size
   * @param radius ball radius — bigger balls rumble lower and louder
   */
  setRolling(speed: number, maxSpeed: number, radius: number) {
    const r = this.roll;
    if (!r || !audio.ready) return;
    const s = clamp01(speed / Math.max(maxSpeed, 0.001));
    const size = clamp01((radius - 0.4) / 5.4);

    // Gain rises with speed; a big ball has presence even when barely moving.
    const g = s * lerp(0.05, 0.17, size) + size * 0.02;
    // Cutoff rises with speed (more grit) but falls with size (more weight).
    const cut = lerp(150, 900, s) * lerp(1.5, 0.55, size);

    r.gain.gain.setTargetAtTime(g, audio.now, 0.06);
    r.filter.frequency.setTargetAtTime(cut, audio.now, 0.08);
  }

  stop() {
    const a = audio;
    if (!this.running) return;
    this.running = false;
    for (const l of Object.values(this.layers)) a.rampTo(l.gain.gain, 0, 0.4);
    if (this.roll) a.rampTo(this.roll.gain.gain, 0, 0.3);
    const stopAt = a.now + 0.6;
    this.pad?.osc.forEach((o) => o.stop(stopAt));
    this.roll?.src.stop(stopAt);
    this.pad = undefined;
    this.roll = undefined;
    this.layers = {};
    this.step = 0;
  }
}

export const music = new Music();
