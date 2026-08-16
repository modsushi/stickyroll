/**
 * Sound effects, all synthesised at call time.
 *
 * The pickup chime is the centrepiece. Its pitch walks up a pentatonic ladder
 * as the combo climbs and snaps back down when the combo drops — the same
 * escalation-and-release loop a slot machine uses, and the reason a run of
 * twenty cones feels better than twenty separate cones.
 */

import { audio } from './AudioEngine';
import { clamp01 } from '../core/Math';
import type { PropDef } from '../data/props';

/** Minor pentatonic, two octaves. Pleasant in any order, which matters when
 *  pickups fire in unpredictable rhythms. */
const LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];
const ROOT = 220; // A3

const semi = (n: number) => ROOT * Math.pow(2, n / 12);

/** Per-material timbre for pickups. */
const VOICE: Record<
  NonNullable<PropDef['voice']>,
  { type: OscillatorType; decay: number; bright: number; noise: number }
> = {
  tiny: { type: 'triangle', decay: 0.1, bright: 1.6, noise: 0.12 },
  metal: { type: 'square', decay: 0.16, bright: 2.1, noise: 0.2 },
  wood: { type: 'triangle', decay: 0.14, bright: 1.0, noise: 0.3 },
  soft: { type: 'sine', decay: 0.2, bright: 0.8, noise: 0.08 },
  heavy: { type: 'sawtooth', decay: 0.3, bright: 0.55, noise: 0.35 },
};

class Sfx {
  /** Rate-limits pickups so absorbing a dense cluster doesn't turn to mush. */
  private lastPickup = 0;
  private pickupsThisFrame = 0;

  /**
   * @param comboTier drives the ladder step, so the melody rises with the run
   */
  pickup(def: PropDef, comboTier: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    // More than a few simultaneous pickups is noise, not feedback. Detune the
    // extras slightly instead of stacking identical transients.
    if (t - this.lastPickup < 0.012) {
      if (++this.pickupsThisFrame > 3) return;
    } else {
      this.pickupsThisFrame = 0;
    }
    this.lastPickup = t;

    const v = VOICE[def.voice ?? 'soft'];
    const step = LADDER[Math.min(comboTier, LADDER.length - 1)];
    // Small random offset within the scale keeps repeated pickups at the same
    // combo tier from sounding like a stuck key.
    const jitter = (this.pickupsThisFrame % 3) * 2;
    const freq = semi(step + jitter) * (def.voice === 'heavy' ? 0.5 : 1);

    const peak = 0.22 * (0.75 + clamp01(comboTier / 8) * 0.5);

    const g = a.env(t, peak, 0.003, v.decay);
    const o = a.osc(v.type, freq, t);
    // Quick downward pitch blip gives the transient a "pluck" attack.
    o.frequency.setValueAtTime(freq * 1.18, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.035);

    const lp = a.filter('lowpass', freq * 6 * v.bright, 0.8);
    o.connect(lp);
    lp.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.18);

    // A tiny noise transient is what separates "a beep" from "an object".
    if (v.noise > 0) {
      const n = a.noise();
      const ng = a.env(t, peak * v.noise, 0.001, 0.05);
      const nf = a.filter('bandpass', freq * 4, 1.4);
      n.connect(nf);
      nf.connect(ng);
      ng.connect(a.sfxBus);
      n.start(t);
      n.stop(t + 0.1);
    }

    // A shimmering fifth above, fading in as the combo climbs, so high combos
    // literally sound richer.
    if (comboTier >= 3) {
      const h = a.osc('sine', freq * 3, t);
      const hg = a.env(t, peak * 0.3 * clamp01((comboTier - 2) / 5), 0.004, 0.12);
      h.connect(hg);
      hg.connect(a.sfxBus);
      a.send(hg, 0.3);
      h.start(t);
      h.stop(t + 0.35);
    }

    o.start(t);
    o.stop(t + v.decay + 0.2);
  }

  /** Bounce off something too big. Dull, low, no sting — never a punishment. */
  reject(strength: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const amp = 0.12 + clamp01(strength / 6) * 0.2;

    const o = a.osc('sine', 90, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const g = a.env(t, amp, 0.004, 0.14);
    o.connect(g);
    g.connect(a.sfxBus);

    const n = a.noise();
    const nf = a.filter('lowpass', 420, 1.2);
    const ng = a.env(t, amp * 0.7, 0.002, 0.08);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    n.start(t);
    n.stop(t + 0.2);

    o.start(t);
    o.stop(t + 0.4);
  }

  /** Tier-up: riser, chord swell, sub thump, shimmer. The big moment. */
  tierUp(tier: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const root = semi(Math.min(tier, 6) * 2);

    // Sub thump — you feel this more than hear it on a phone speaker.
    const sub = a.osc('sine', 120, t);
    sub.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const subG = a.env(t, 0.5, 0.004, 0.3);
    sub.connect(subG);
    subG.connect(a.sfxBus);
    sub.start(t);
    sub.stop(t + 0.7);

    // Noise riser into the hit.
    const n = a.noise();
    const nf = a.filter('bandpass', 400, 3);
    nf.frequency.exponentialRampToValueAtTime(6000, t + 0.34);
    const ng = a.gain(0);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.16, t + 0.32);
    ng.gain.setTargetAtTime(0.0001, t + 0.34, 0.06);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    a.send(ng, 0.4);
    n.start(t);
    n.stop(t + 0.8);

    // Major-add9 chord, notes fanned out slightly so it blooms.
    const hit = t + 0.3;
    [0, 4, 7, 11, 14].forEach((iv, i) => {
      const o = a.osc(i < 3 ? 'triangle' : 'sine', root * Math.pow(2, iv / 12), hit);
      const g = a.env(hit + i * 0.018, 0.13 / (1 + i * 0.35), 0.01, 0.9);
      const lp = a.filter('lowpass', 5200, 0.7);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.5);
      o.start(hit);
      o.stop(hit + 1.6);
    });

    // Metallic shimmer tail.
    for (let i = 0; i < 6; i++) {
      const at = hit + 0.04 + i * 0.05;
      const o = a.osc('sine', root * (6 + i * 1.7), at);
      const g = a.env(at, 0.05, 0.003, 0.25);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.6);
      o.start(at);
      o.stop(at + 0.6);
    }
  }

  /** Collectible pickup: bright, coin-like, unmistakably different. */
  collect(index: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const base = semi(12 + (index % 6) * 2);

    // Two detuned sines = the classic coin beat.
    for (const [mult, detune] of [
      [1, 0],
      [1, 4],
      [2, -3],
    ] as const) {
      const o = a.osc('sine', base * mult, t);
      o.detune.setValueAtTime(detune, t);
      const g = a.env(t, 0.16 / mult, 0.002, 0.18);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.35);
      o.start(t);
      o.stop(t + 0.5);
    }

    // FM ping for the metallic sparkle.
    const carrier = a.osc('sine', base * 4, t);
    const mod = a.osc('sine', base * 5.4, t);
    const modGain = a.gain(base * 3);
    modGain.gain.setValueAtTime(base * 3, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.16);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const cg = a.env(t, 0.09, 0.002, 0.16);
    carrier.connect(cg);
    cg.connect(a.sfxBus);
    a.send(cg, 0.5);
    mod.start(t);
    carrier.start(t);
    mod.stop(t + 0.4);
    carrier.stop(t + 0.4);
  }

  /** All of one collectible set gathered. */
  fanfare() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    [0, 4, 7, 12, 16, 19].forEach((iv, i) => {
      const at = t + i * 0.075;
      const o = a.osc('triangle', semi(12 + iv), at);
      const g = a.env(at, 0.15, 0.005, 0.3);
      const lp = a.filter('lowpass', 6000, 0.8);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.45);
      o.start(at);
      o.stop(at + 0.8);
    });
  }

  /** Star reveal on the results screen — pitch rises per star. */
  star(index: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const base = semi(19 + index * 5);
    [1, 1.5, 2].forEach((m, i) => {
      const o = a.osc(i === 0 ? 'triangle' : 'sine', base * m, t);
      const g = a.env(t + i * 0.01, 0.17 / (i + 1), 0.004, 0.5);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.5);
      o.start(t);
      o.stop(t + 1.2);
    });
  }

  /** Score counter tick on the results screen. */
  tick(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const o = a.osc('square', 900 * pitch, t);
    const g = a.env(t, 0.035, 0.001, 0.03);
    const hp = a.filter('highpass', 600, 0.7);
    o.connect(hp);
    hp.connect(g);
    g.connect(a.sfxBus);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** UI click. */
  click(soft = false) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const o = a.osc('sine', soft ? 520 : 760, t);
    o.frequency.exponentialRampToValueAtTime(soft ? 380 : 1200, t + 0.04);
    const g = a.env(t, soft ? 0.08 : 0.12, 0.002, 0.06);
    o.connect(g);
    g.connect(a.sfxBus);
    const n = a.noise();
    const nf = a.filter('highpass', 2400, 0.7);
    const ng = a.env(t, 0.05, 0.001, 0.02);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    n.start(t);
    n.stop(t + 0.05);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Whoosh for screen transitions and items flying to their card. */
  whoosh(up = true) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const n = a.noise();
    const f = a.filter('bandpass', up ? 500 : 3000, 1.6);
    f.frequency.exponentialRampToValueAtTime(up ? 4000 : 400, t + 0.26);
    const g = a.env(t, 0.09, 0.05, 0.16);
    n.connect(f);
    f.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.3);
    n.start(t);
    n.stop(t + 0.5);
  }

  /** Countdown blip in the last ten seconds. */
  countdown(urgent: boolean) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const o = a.osc('square', urgent ? 880 : 660, t);
    const g = a.env(t, 0.1, 0.003, 0.1);
    const lp = a.filter('lowpass', 3000, 1);
    o.connect(lp);
    lp.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.25);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Car horn when the ball blocks traffic. Sells the city as inhabited. */
  horn(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const g = a.env(t, 0.05, 0.01, 0.18);
    for (const m of [1, 1.5]) {
      const o = a.osc('sawtooth', 330 * pitch * m, t);
      const lp = a.filter('lowpass', 1800, 1);
      o.connect(lp);
      lp.connect(g);
      o.start(t);
      o.stop(t + 0.35);
    }
    g.connect(a.sfxBus);
    a.send(g, 0.4);
  }
}

export const sfx = new Sfx();
