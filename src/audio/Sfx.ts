/**
 * Sound effects, all synthesised at call time.
 *
 * The pickup is the centrepiece, and it is a **pop** — a short bubble-like
 * blip made from a fast upward pitch bend under a very short envelope.
 *
 * It used to be a pluck whose pitch climbed a pentatonic ladder with the combo
 * and snapped back when the combo broke: a slot-machine escalation. That is
 * effective and it is also unmistakably a casino, which is not what this game
 * is. The ladder is gone. Pitch now varies only with how big the thing was and
 * a touch of randomness, so a hundred pickups stay lively without ever
 * marching up a scale.
 *
 * Five families, deliberately few:
 *   pop    everything ordinary — litter, cones, furniture, shop fittings
 *   human  citizens, so eating a person is unmistakable
 *   chunk  heavy junk — drivetrains, columns — a deeper pop with a thud under it
 *   car    vehicles: a sprung metal *pluck*, the pop's rise inverted into a fall
 *   —      buildings, which make no pickup sound at all and are voiced by
 *          `demolish` instead
 *
 * The last two are the tier-6 and tier-8 payoffs, and they used to share the
 * `chunk` voice with a car drivetrain. Hearing the same thud whether you had
 * eaten a hubcap or flattened a taxi threw away the moment the entire first
 * half of a run is spent working toward.
 *
 * Citizens get two sounds rather than one, and their *directions* are the whole
 * design: `startle` whoops upward when someone spots the ball, `popHuman` yelps
 * downward when they are rolled up. Both were once the same rising whoop, which
 * made the encounter sound like one event happening twice.
 */

import { audio } from './AudioEngine';
import { clamp01 } from '../core/Math';
import type { PropDef } from '../data/props';

/**
 * Musical helpers, still used by the celebratory stingers — tier-ups, star
 * reveals and the collectible fanfare are the places where a chord genuinely
 * belongs. The moment-to-moment pickups deliberately no longer use them.
 */
const ROOT = 220; // A3
const semi = (n: number) => ROOT * Math.pow(2, n / 12);

/**
 * The chord a run of collectibles walks up, in semitones from the root.
 *
 * A major 6/9 — root, major third, fifth, sixth, ninth — spread over two
 * octaves. Chosen because it has no dissonant pair anywhere in it: whichever
 * notes happen to be still ringing when the next one lands, the combination is
 * consonant. A plain major triad would also be safe but repeats every three
 * steps and starts to sound like a bugle call; adding the sixth and ninth keeps
 * eight steps distinct while staying sweet.
 *
 * Eight entries plus one, because the run counter caps at 7 and set two starts
 * two degrees in — the last index has to exist for both.
 */
const COLLECT_CHORD = [0, 4, 7, 9, 12, 16, 19, 21, 24];

/**
 * Where each voice sits, as the pop's landing pitch in Hz.
 *
 * Small things pop high and short, big things low and round. The four ordinary
 * voices are the same sound at a different pitch, which is what makes the pop
 * read as *the* pickup sound rather than one of five; `human`, `heavy`, `car`
 * and `building` are the deliberate exceptions.
 */
const POP: Record<
  NonNullable<PropDef['voice']>,
  { freq: number; decay: number; family: 'pop' | 'human' | 'chunk' | 'car' | 'silent' }
> = {
  tiny: { freq: 880, decay: 0.075, family: 'pop' },
  metal: { freq: 740, decay: 0.085, family: 'pop' },
  wood: { freq: 590, decay: 0.095, family: 'pop' },
  soft: { freq: 480, decay: 0.105, family: 'pop' },
  heavy: { freq: 190, decay: 0.2, family: 'chunk' },
  human: { freq: 520, decay: 0.16, family: 'human' },
  // Vehicles: the base pitch is only a starting point — `popCar` re-derives it
  // from the vehicle's measured size so a hatchback and a garbage truck are an
  // octave apart rather than the same note twice.
  car: { freq: 260, decay: 0.26, family: 'car' },
  // Buildings make no pickup sound. `Sfx.demolish`, fired from the `demolish`
  // event, is the sound of rolling over one, and layering a pop under a
  // collapsing building only muddies the transient that sells the impact.
  building: { freq: 0, decay: 0, family: 'silent' },
};

class Sfx {
  /** Rate-limits pickups so absorbing a dense cluster doesn't turn to mush. */
  private lastPickup = 0;
  private pickupsThisFrame = 0;
  /** Same idea for startled citizens; a whole block reacts at once. */
  private lastStartle = 0;
  private startlesThisBurst = 0;
  /** Drives the rising run when a cluster of collectibles is taken in one pass. */
  private lastCollect = 0;
  private collectRun = 0;
  /** Keeps two buildings falling together from stacking into a clipped mess. */
  private lastDemolish = 0;
  /** Same, for the quiet cue that marks a building as next. */
  private lastLock = 0;
  /** Keeps repeated block-stack contacts from stacking into static. */
  private lastBlocks = 0;
  /** Rail ambience is proximity-driven and must not become a metronome wall. */
  private lastRail = 0;
  private lastTrainHorn = 0;

  /**
   * @param comboTier no longer changes pitch — only a little loudness and
   *   sparkle, so a long run feels good without turning into a scale
   */
  pickup(def: PropDef, comboTier: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    // More than a few simultaneous pickups is noise, not feedback.
    if (t - this.lastPickup < 0.012) {
      if (++this.pickupsThisFrame > 3) return;
    } else {
      this.pickupsThisFrame = 0;
    }
    this.lastPickup = t;

    const v = POP[def.voice ?? 'soft'];
    if (v.family === 'silent') return;
    // Random detune only, and narrow. This is what stops a cluster of identical
    // cones sounding like a stuck key, without implying any melody.
    const detune = 0.92 + Math.random() * 0.16;
    const freq = v.freq * detune;
    const peak = 0.2 * (0.85 + clamp01(comboTier / 8) * 0.3);

    if (v.family === 'human') this.popHuman(t, freq, peak);
    else if (v.family === 'car') this.popCar(t, detune, peak, def.absorbSize);
    else this.popBody(t, freq, peak, v.decay, v.family === 'chunk');

    // High combos get a little sparkle on top — richness rather than pitch, so
    // it reads as "going well" instead of "climbing a ladder".
    if (comboTier >= 4) {
      const h = a.osc('sine', 1560 + Math.random() * 320, t);
      const hg = a.env(t, peak * 0.16 * clamp01((comboTier - 3) / 5), 0.004, 0.1);
      h.connect(hg);
      hg.connect(a.sfxBus);
      a.send(hg, 0.3);
      h.start(t);
      h.stop(t + 0.3);
    }
  }

  /**
   * The pop itself: a sine whose pitch snaps *upward* into place under a very
   * short envelope, which is what the ear hears as a bubble bursting. A
   * downward bend would be a pluck, and a flat tone would be a beep.
   *
   * A drier version was tried — a noise-click transient over a fast *downward*
   * sweep, aiming at bubble wrap rather than a bubble. That is also the recipe
   * for a laser zap, and it duly sounded like one, so it was reverted.
   */
  private popBody(t: number, freq: number, peak: number, decay: number, chunky: boolean) {
    const a = audio;
    const o = a.osc(chunky ? 'triangle' : 'sine', freq, t);
    o.frequency.setValueAtTime(freq * 0.45, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + (chunky ? 0.05 : 0.028));
    // A hair of overshoot past the target, then settle — the "oo-p" tail.
    o.frequency.exponentialRampToValueAtTime(freq * 0.86, t + decay);

    const g = a.env(t, peak, 0.002, decay);
    const lp = a.filter('lowpass', freq * 7, 0.7);
    o.connect(lp);
    lp.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.14);
    o.start(t);
    o.stop(t + decay + 0.15);

    // Heavy things land as well as pop: a short low thud underneath.
    if (chunky) {
      const th = a.osc('sine', 70, t);
      th.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      const tg = a.env(t, peak * 0.8, 0.003, 0.18);
      th.connect(tg);
      tg.connect(a.sfxBus);
      th.start(t);
      th.stop(t + 0.3);
    }
  }

  /**
   * A vehicle scooped off the road: a sprung metal **pluck**.
   *
   * The pop family bends its pitch *upward* under a very short envelope, which
   * is what makes it read as a bubble. A pluck is the same trick inverted — the
   * pitch and the brightness both fall away from a hard onset, the way a struck
   * or plucked string does. That single inversion is enough for the ear to file
   * cars as a different class of thing from the rest of the city without any
   * new instrument: the tier-6 moment now announces itself.
   *
   * Four layers, in the order you hear them:
   *   click  sheet metal taking the hit, 30 ms of bandpassed noise
   *   pluck  a sawtooth through a fast-closing resonant lowpass — the note
   *   fifth  a quieter, shorter partial that makes the pluck read as *sprung*
   *          rather than as a plain bass note
   *   thud   the weight landing, felt more than heard on a phone
   *
   * Pitch comes from the vehicle's own measured size, so a go-kart plucks a
   * clean octave above a garbage truck and the fleet sounds like a fleet rather
   * than one sound at eight volumes.
   */
  private popCar(t: number, detune: number, peak: number, size: number) {
    const a = audio;
    const base = 300 * Math.pow(0.5, clamp01((size - 0.8) / 2)) * detune;

    // Sheet-metal click. Before the note, and short enough to be an onset
    // rather than a sound in its own right.
    const n = a.noise();
    const nf = a.filter('bandpass', 2600 + Math.random() * 700, 1.4);
    const ng = a.env(t, peak * 0.45, 0.001, 0.03);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    a.send(ng, 0.12);
    n.start(t);
    n.stop(t + 0.12);

    // The pluck: a hard onset whose pitch *and* brightness both fall.
    const o = a.osc('sawtooth', base, t);
    o.frequency.setValueAtTime(base * 1.32, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.05);
    const lp = a.filter('lowpass', base * 11, 6);
    lp.frequency.exponentialRampToValueAtTime(base * 2.1, t + 0.19);
    const g = a.env(t, peak * 0.85, 0.002, 0.24);
    o.connect(lp);
    lp.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.18);
    o.start(t);
    o.stop(t + 0.6);

    // The sprung fifth above it. Detuned a few cents so the two voices beat
    // slightly against each other, which is what stops the pluck sounding
    // synthetic.
    const h = a.osc('triangle', base * 1.5, t);
    h.detune.setValueAtTime(7, t);
    h.frequency.exponentialRampToValueAtTime(base * 1.42, t + 0.12);
    const hg = a.env(t, peak * 0.3, 0.002, 0.11);
    h.connect(hg);
    hg.connect(a.sfxBus);
    a.send(hg, 0.2);
    h.start(t);
    h.stop(t + 0.4);

    // Suspension letting go.
    const th = a.osc('sine', 96, t);
    th.frequency.exponentialRampToValueAtTime(44, t + 0.17);
    const tg = a.env(t, peak * 0.7, 0.003, 0.17);
    th.connect(tg);
    tg.connect(a.sfxBus);
    th.start(t);
    th.stop(t + 0.35);
  }

  /**
   * A building coming down.
   *
   * The biggest, longest sound in the game — deliberately longer than the
   * tier-up, because it is the only one attached to something the player can
   * see disintegrate, and a short sound over a one-second collapse reads as the
   * animation being unsound rather than the audio being restrained.
   *
   * Five layers on one timeline:
   *   crack   a bright noise burst — glass and render letting go
   *   crunch  two detuned saws diving an octave and a half, the structure
   *   sub     the floor moving, essentially inaudible on laptop speakers and
   *           the whole sound on anything with a woofer
   *   body    a long noise bed whose lowpass closes from 1.4 kHz to 180 Hz, so
   *           the dust cloud settles rather than simply stopping
   *   rubble  a dozen scattered bandpassed clicks over the next 700 ms — this
   *           is the layer that sells *masonry*; without it the sound is an
   *           explosion, which is a different (and wrong) event
   *
   * `power` (0..1) is the building's size. It scales level and, more usefully,
   * pitch: a cottage cracks, a shopfront booms.
   */
  demolish(power = 0.5) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    // Two buildings inside a tenth of a second is one demolition as far as the
    // ear is concerned, and stacking these would clip the master.
    if (t - this.lastDemolish < 0.1) return;
    const crowded = t - this.lastDemolish < 0.6 ? 0.62 : 1;
    this.lastDemolish = t;

    const p = clamp01(power);
    const amp = (0.5 + p * 0.5) * crowded;
    // Big things are slow: everything below is stretched by this.
    const len = 0.75 + p * 0.5;
    const low = 1 - p * 0.35; // pitch multiplier — bigger building, lower voice

    // Crack.
    const crack = a.noise();
    const cf = a.filter('highpass', 1700, 0.8);
    const cg = a.env(t, amp * 0.34, 0.001, 0.07);
    crack.connect(cf);
    cf.connect(cg);
    cg.connect(a.sfxBus);
    a.send(cg, 0.3);
    crack.start(t);
    crack.stop(t + 0.3);

    // Crunch: the structure failing. Two saws a semitone apart beat against
    // each other on the way down, which is what makes it tear rather than slide.
    for (const [mult, delay] of [
      [1, 0],
      [1.06, 0.012],
    ] as const) {
      const o = a.osc('sawtooth', 170 * low * mult, t + delay);
      o.frequency.exponentialRampToValueAtTime(52 * low * mult, t + delay + 0.16);
      const lp = a.filter('lowpass', 900, 1.2);
      const g = a.env(t + delay, amp * 0.3, 0.004, 0.2);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.2);
      o.start(t + delay);
      o.stop(t + delay + 0.6);
    }

    // Sub.
    const sub = a.osc('sine', 78 * low, t);
    sub.frequency.exponentialRampToValueAtTime(27, t + len * 0.6);
    const sg = a.env(t, amp * 0.72, 0.006, len * 0.65);
    sub.connect(sg);
    sg.connect(a.sfxBus);
    sub.start(t);
    sub.stop(t + len + 0.4);

    // Body: the dust cloud. Attack is slow enough that the crack stays the
    // transient, and the filter closing is what makes it settle.
    const body = a.noise();
    const bf = a.filter('lowpass', 1400, 0.9);
    bf.frequency.exponentialRampToValueAtTime(180, t + len);
    const bg = a.env(t, amp * 0.3, 0.03, len * 0.8);
    body.connect(bf);
    bf.connect(bg);
    bg.connect(a.sfxBus);
    a.send(bg, 0.5);
    body.start(t);
    body.stop(t + len + 0.5);

    // Rubble. Random times, random pitches, thinning out — falling masonry is
    // dense at first and sparse by the end, and an even spread sounds like a
    // drum roll instead.
    const hits = 9 + Math.round(p * 6);
    for (let i = 0; i < hits; i++) {
      // Squared distribution: most of the clatter lands in the first third.
      const at = t + 0.04 + Math.pow(Math.random(), 0.6) * len;
      const r = a.noise();
      const rf = a.filter('bandpass', 500 + Math.random() * 2200, 4);
      const rg = a.env(at, amp * 0.14 * (0.4 + Math.random() * 0.6), 0.001, 0.04 + Math.random() * 0.05);
      r.connect(rf);
      rf.connect(rg);
      rg.connect(a.sfxBus);
      a.send(rg, 0.4);
      r.start(at);
      r.stop(at + 0.24);
    }
  }

  /**
   * A citizen being rolled up: a comic yelp that falls away, plus a puff.
   *
   * The upward whoop this used to be has moved to `startle`, where it plays as
   * someone spots the ball — it is a *surprise* noise, and surprise belongs at
   * the moment of noticing rather than the moment of disappearing.
   *
   * So this one goes the other way. The pitch drops and the envelope cuts short
   * while a soft noise puff blooms underneath, which reads as being whisked out
   * of frame. Pairing a rising whoop with a falling one also means the two
   * halves of an encounter answer each other instead of sounding like the same
   * event twice.
   */
  private popHuman(t: number, freq: number, peak: number) {
    const a = audio;

    // "Wa-oop" downward: a quick lift into the grab, then away.
    const o = a.osc('triangle', freq, t);
    o.frequency.setValueAtTime(freq * 1.18, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.34, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(freq * 0.52, t + 0.17);

    // Faster and deeper than the startle's vibrato, so the fall wobbles like a
    // cartoon fall rather than sliding smoothly like a siren.
    const vib = a.osc('sine', 15, t);
    const vibAmt = a.gain(freq * 0.06);
    vib.connect(vibAmt);
    vibAmt.connect(o.frequency);
    vib.start(t);
    vib.stop(t + 0.28);

    const g = a.env(t, peak * 0.9, 0.005, 0.13);
    const lp = a.filter('lowpass', freq * 5, 0.8);
    o.connect(lp);
    lp.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.26);
    o.start(t);
    o.stop(t + 0.3);

    // The puff. Swept downward so it settles rather than hisses, and quiet
    // enough that a crowd being cleared doesn't turn into white noise.
    const n = a.noise();
    const bp = a.filter('bandpass', 1400, 0.9);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    const ng = a.env(t, peak * 0.4, 0.006, 0.11);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(a.sfxBus);
    a.send(ng, 0.3);
    n.start(t);
    n.stop(t + 0.3);
  }

  /**
   * A citizen spotting the ball: the two-note upward "whoop" with a little
   * vibrato — cartoon surprise rather than distress, since the whole point is
   * that this is cheerful.
   *
   * This *was* the pickup sound for citizens, and it turned out to be a much
   * better reaction than a result: an upward whoop is the noise a person makes
   * when they see something coming, not when they vanish. Moving it here and
   * giving `popHuman` a falling yelp instead means the encounter now reads as
   * two halves that answer each other.
   *
   * `pitch` comes from the character variant, so a given citizen always has the
   * same voice — a crowd of identical yelps sounds like one person in a hall of
   * mirrors.
   */
  startle(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    // A whole street reacting at once is a wall of noise, not a reaction. Three
    // voices is enough to read as a crowd; the rest are dropped silently.
    if (t - this.lastStartle < 0.11) {
      if (++this.startlesThisBurst > 2) return;
    } else {
      this.startlesThisBurst = 0;
    }
    this.lastStartle = t;

    const base = 520 * pitch;

    const o = a.osc('triangle', base, t);
    o.frequency.setValueAtTime(base * 0.7, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(base * 1.32, t + 0.2);

    const vib = a.osc('sine', 11, t);
    const vibAmt = a.gain(base * 0.045);
    vib.connect(vibAmt);
    vibAmt.connect(o.frequency);
    vib.start(t);
    vib.stop(t + 0.32);

    const g = a.env(t, 0.19, 0.006, 0.2);
    o.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.24);
    o.start(t);
    o.stop(t + 0.35);

    // A breath in front of the tone. Tiny, and the one thing added over the old
    // pickup version: it gives the whoop an onset, which is what makes it land
    // as a reaction to something rather than a note.
    const n = a.noise();
    const nf = a.filter('highpass', 1800, 0.8);
    const ng = a.env(t, 0.045, 0.004, 0.04);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    n.start(t);
    n.stop(t + 0.16);
  }

  /**
   * A building lighting up as the ball closes on it.
   *
   * Deliberately tiny — a breath and a soft two-partial ping, a fifth of the
   * level of a pickup. It is a *cue*, not an event: the demolition a moment
   * later is the payoff, and anything louder here would step on it. Rate
   * limited hard, because rolling down a street lights several frontages in
   * quick succession and a chirp per building would sound like an alarm.
   */
  lock() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    if (t - this.lastLock < 0.25) return;
    this.lastLock = t;

    for (const [mult, amp, delay] of [
      [1, 0.05, 0],
      [1.5, 0.03, 0.045],
    ] as const) {
      const at = t + delay;
      const o = a.osc('sine', 660 * mult, at);
      const g = a.env(at, amp, 0.004, 0.09);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.4);
      o.start(at);
      o.stop(at + 0.3);
    }

    const n = a.noise();
    const nf = a.filter('bandpass', 3200, 2);
    nf.frequency.exponentialRampToValueAtTime(5200, t + 0.09);
    const ng = a.env(t, 0.022, 0.006, 0.05);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(a.sfxBus);
    n.start(t);
    n.stop(t + 0.2);
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

  /** A bright toy-brick clatter with a soft floor thump. */
  blocks(blocks = 6) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    if (t - this.lastBlocks < 0.12) return;
    this.lastBlocks = t;
    const count = Math.min(12, Math.max(1, blocks));
    const amp = 0.19 + Math.min(6, count) * 0.012;

    const thump = a.osc('triangle', 180, t);
    thump.frequency.exponentialRampToValueAtTime(74, t + 0.18);
    const tg = a.env(t, amp, 0.003, 0.2);
    thump.connect(tg);
    tg.connect(a.sfxBus);
    thump.start(t);
    thump.stop(t + 0.28);

    // A handful of staggered woody clicks makes the stack read as separate
    // blocks landing, rather than one generic collision noise.
    for (let i = 0; i < count; i++) {
      const at = t + 0.025 + i * 0.055;
      const n = a.noise();
      const f = a.filter('bandpass', 620 + (i % 4) * 210, 3.2);
      const g = a.env(at, amp * (0.7 - i * 0.035), 0.001, 0.065);
      n.connect(f);
      f.connect(g);
      g.connect(a.sfxBus);
      n.start(at);
      n.stop(at + 0.12);

      const knock = a.osc('triangle', 310 - (i % 3) * 38, at);
      const kg = a.env(at, amp * 0.18, 0.001, 0.045);
      knock.connect(kg);
      kg.connect(a.sfxBus);
      knock.start(at);
      knock.stop(at + 0.09);
    }
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

  /**
   * Collectible pickup: bright, coin-like, unmistakably different.
   *
   * A run of them **arpeggiates a chord**. This is the one place a pitch ladder
   * belongs — the thing that was stripped out of the ordinary pickup for
   * sounding like a slot machine. The difference is duration: that ladder ran
   * for a whole level and became the texture of the game, while this one lasts
   * as long as it takes to roll through a cordon of cones and resets half a
   * second later.
   *
   * The first version stepped in whole tones, and it was wrong for a reason
   * worth writing down. Each note rings for about 300 ms while rolling through
   * seven cones takes under a second, so four or five of them are always
   * sounding *together* — the run is not a melody, it is a chord being built up
   * one note at a time. A whole-tone scale is the one scale with no tonal
   * centre at all (it is what film scores use for dream sequences), so stacking
   * it produced a cluster with nothing to resolve to. Walking a chord's own
   * degrees means every note that overlaps any other is already consonant with
   * it, whichever ones the player happens to catch.
   *
   * `index` is the set: rather than transposing — which would drop set two into
   * a different key — it starts two degrees up the *same* chord, so the two
   * collections are audibly distinct and still harmonise if they interleave.
   */
  collect(index: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    if (t - this.lastCollect < 0.5) this.collectRun = Math.min(this.collectRun + 1, 7);
    else this.collectRun = 0;
    this.lastCollect = t;

    const step = Math.min(this.collectRun + (index % 2) * 2, COLLECT_CHORD.length - 1);
    const base = semi(12 + COLLECT_CHORD[step]);

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
    //
    // Backed off as the run climbs. The 5.4 modulator ratio is deliberately
    // inharmonic — that is what makes one coin sound like struck metal rather
    // than a flute — but inharmonic sidebands are exactly what does *not* stack.
    // One is a sparkle; seven overlapping is a saucepan. The chord underneath
    // keeps its full level, so a fast sweep gets cleaner and more tonal as it
    // rises rather than simply quieter.
    const sparkle = 1 - Math.min(this.collectRun, 6) * 0.11;
    const carrier = a.osc('sine', base * 4, t);
    const mod = a.osc('sine', base * 5.4, t);
    const modGain = a.gain(base * 3);
    modGain.gain.setValueAtTime(base * 3 * sparkle, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.16);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const cg = a.env(t, 0.09 * sparkle, 0.002, 0.16);
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

  // ── meta-progression ────────────────────────────────────────────────────
  //
  // These belong to the screens between runs, and they are pitched a little
  // sweeter and longer than the in-game set on purpose: nothing is competing
  // with them for attention, and a reward that sounds like a pickup does not
  // feel like a reward.

  /** An upgrade card dealing itself onto the table. `index` staggers the pitch. */
  reveal(index: number) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    // Airy swish plus a soft mallet, so three cards in sequence read as three
    // objects landing rather than one sound repeated.
    const n = a.noise();
    const f = a.filter('bandpass', 900 + index * 260, 2.2);
    f.frequency.exponentialRampToValueAtTime(2600 + index * 400, t + 0.13);
    const ng = a.env(t, 0.07, 0.008, 0.09);
    n.connect(f);
    f.connect(ng);
    ng.connect(a.sfxBus);
    a.send(ng, 0.25);
    n.start(t);
    n.stop(t + 0.3);

    const o = a.osc('triangle', semi(14 + index * 3), t);
    const g = a.env(t, 0.1, 0.004, 0.16);
    o.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.35);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** An upgrade taken. Warm, affirming, and clearly a *keep* rather than a tick. */
  choose() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    // Rising fifth into an octave: the shortest phrase that sounds like "yes".
    [
      [0, 0],
      [7, 0.07],
      [12, 0.14],
    ].forEach(([iv, delay]) => {
      const at = t + delay;
      const o = a.osc('triangle', semi(12 + iv), at);
      const g = a.env(at, 0.16, 0.005, 0.34);
      const lp = a.filter('lowpass', 5200, 0.8);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.45);
      o.start(at);
      o.stop(at + 0.8);
    });

    const sub = a.osc('sine', 150, t);
    sub.frequency.exponentialRampToValueAtTime(70, t + 0.2);
    const sg = a.env(t, 0.28, 0.004, 0.24);
    sub.connect(sg);
    sg.connect(a.sfxBus);
    sub.start(t);
    sub.stop(t + 0.6);
  }

  /**
   * One coin landing on a pile. Called dozens of times during the gold count,
   * so it is deliberately tiny — the pitch drift is what turns a stream of them
   * into a shower rather than a buzz.
   */
  coin(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const base = 1180 * pitch * (0.94 + Math.random() * 0.12);
    for (const [mult, amp] of [
      [1, 0.075],
      [1.5, 0.045],
    ] as const) {
      const o = a.osc('sine', base * mult, t);
      const g = a.env(t, amp, 0.001, 0.07);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.3);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  /** Player level gained. The biggest sound in the game after a tier-up. */
  levelUp() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;

    // Ascending arpeggio, then the chord it was climbing toward.
    [0, 4, 7, 12].forEach((iv, i) => {
      const at = t + i * 0.065;
      const o = a.osc('triangle', semi(12 + iv), at);
      const g = a.env(at, 0.15, 0.004, 0.22);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.4);
      o.start(at);
      o.stop(at + 0.5);
    });

    const hit = t + 0.28;
    [0, 7, 12, 16, 19].forEach((iv, i) => {
      const o = a.osc(i < 2 ? 'triangle' : 'sine', semi(12 + iv), hit);
      const g = a.env(hit + i * 0.012, 0.14 / (1 + i * 0.4), 0.008, 1.0);
      const lp = a.filter('lowpass', 6000, 0.7);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.55);
      o.start(hit);
      o.stop(hit + 1.8);
    });
  }

  /** Something bought in the shop. A till, essentially. */
  purchase() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    this.coin(1.15);
    [
      [16, 0.05],
      [23, 0.12],
    ].forEach(([iv, delay]) => {
      const at = t + delay;
      const o = a.osc('sine', semi(iv), at);
      const g = a.env(at, 0.14, 0.003, 0.3);
      o.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.5);
      o.start(at);
      o.stop(at + 0.7);
    });
  }

  /** A skin put on. Short, physical, no melody — it is not an achievement. */
  equip() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    const n = a.noise();
    const f = a.filter('bandpass', 2400, 3);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.1);
    const g = a.env(t, 0.09, 0.002, 0.07);
    n.connect(f);
    f.connect(g);
    g.connect(a.sfxBus);
    a.send(g, 0.2);
    n.start(t);
    n.stop(t + 0.25);

    const o = a.osc('sine', 300, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.06);
    const og = a.env(t, 0.1, 0.002, 0.09);
    o.connect(og);
    og.connect(a.sfxBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  /**
   * Can't afford it, or not unlocked yet. A soft two-note fall — informative,
   * never a buzzer. Being told "no" in a relaxing game should not sting.
   */
  denied() {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    [
      [0, 0],
      [-3, 0.09],
    ].forEach(([iv, delay]) => {
      const at = t + delay;
      const o = a.osc('sine', semi(7 + iv), at);
      const g = a.env(at, 0.1, 0.004, 0.13);
      const lp = a.filter('lowpass', 1800, 0.9);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      o.start(at);
      o.stop(at + 0.4);
    });
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

  /** Two-tone railway horn, lower and longer than the city's car horns. */
  trainHorn(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    if (t - this.lastTrainHorn < 1.8) return;
    this.lastTrainHorn = t;

    for (const [ratio, delay, amp] of [
      [1, 0, 0.085],
      [1.25, 0.09, 0.065],
    ] as const) {
      const at = t + delay;
      const o = a.osc('sawtooth', 154 * pitch * ratio, at);
      o.detune.setValueAtTime(ratio === 1 ? -4 : 5, at);
      const lp = a.filter('lowpass', 760, 1.8);
      const g = a.env(at, amp, 0.045, 0.58);
      o.connect(lp);
      lp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.58);
      o.start(at);
      o.stop(at + 1.25);
    }
  }

  /** A short wheel-on-joint click heard only when a train passes nearby. */
  railClack(pitch = 1) {
    const a = audio;
    if (!a.ready) return;
    const t = a.now;
    if (t - this.lastRail < 0.16) return;
    this.lastRail = t;

    for (const delay of [0, 0.055]) {
      const at = t + delay;
      const n = a.noise();
      const bp = a.filter('bandpass', 1150 * pitch, 5.5);
      const g = a.env(at, delay ? 0.024 : 0.034, 0.001, 0.035);
      n.connect(bp);
      bp.connect(g);
      g.connect(a.sfxBus);
      a.send(g, 0.12);
      n.start(at);
      n.stop(at + 0.12);
    }
  }
}

export const sfx = new Sfx();
