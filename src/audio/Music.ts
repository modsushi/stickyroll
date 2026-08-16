/**
 * Background music + the rolling bed.
 *
 * The music is a streamed loop (`Pocket Garden Loop.mp3`). It replaced a
 * five-layer step sequencer that added an instrument per growth tier: a nice
 * idea, but a synthesised minor-pentatonic bed is exactly the lounge-y,
 * slot-machine register the game is moving away from, and no amount of
 * re-voicing an oscillator stack gets to "written by a person for children".
 *
 * Progression is still audible — the loop opens up through a lowpass and
 * gains a little level as tiers climb — but it is a wash over a fixed track
 * rather than new parts arriving.
 *
 * The rolling bed is unchanged and still synthesised: filtered noise whose
 * cutoff and gain track ball speed and radius. It is what makes a 6-metre ball
 * feel like six metres, and it has to react per-frame, so a sample is no use.
 */

import { audio } from './AudioEngine';
import { clamp01, lerp } from '../core/Math';

const TRACK = '/audio/Pocket Garden Loop.mp3';
/** Headroom under the music bus so pickups always cut through the loop. */
const TRACK_GAIN = 0.62;

export class Music {
  private roll?: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private track?: AudioBufferSourceNode;
  private trackGain?: GainNode;
  private trackFilter?: BiquadFilterNode;
  private buffer?: AudioBuffer;
  private loading?: Promise<AudioBuffer | undefined>;
  private running = false;
  private tier = 0;

  /**
   * Fetches and decodes the loop. Safe to call before the context exists —
   * decoding needs one, so it waits for the first `start()` instead.
   */
  private async load(): Promise<AudioBuffer | undefined> {
    const ctx = audio.ctx;
    if (!ctx) return undefined;
    if (this.buffer) return this.buffer;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const res = await fetch(TRACK);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          this.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          return this.buffer;
        } catch (err) {
          // Music is not worth failing a run over: log it and play silent.
          console.warn('[music] could not load track', err);
          return undefined;
        }
      })();
    }
    return this.loading;
  }

  start() {
    const a = audio;
    if (!a.ready || this.running) return;
    this.running = true;

    this.trackGain = a.gain(0);
    this.trackFilter = a.filter('lowpass', 1400, 0.6);
    this.trackFilter.connect(this.trackGain);
    this.trackGain.connect(a.musicBus);

    void this.load().then((buf) => {
      // `stop()` may have run while the fetch was in flight.
      if (!buf || !this.running || !this.trackFilter || !audio.ctx) return;
      const src = audio.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.trackFilter);
      src.start();
      this.track = src;
      audio.rampTo(this.trackGain!.gain, TRACK_GAIN, 1.6);
      this.applyTier();
    });

    this.startRolling();
  }

  /**
   * Opens the loop up as the city falls, so late game sounds brighter and
   * bigger without new material appearing.
   */
  setTier(tier: number) {
    this.tier = tier;
    this.applyTier();
  }

  private applyTier() {
    const a = audio;
    if (!a.ready || !this.trackFilter || !this.trackGain) return;
    a.rampTo(this.trackFilter.frequency, 1100 + this.tier * 900, 2.5);
    a.rampTo(this.trackGain.gain, TRACK_GAIN * (0.86 + Math.min(this.tier, 8) * 0.018), 2.5);
  }

  /**
   * One line for the perf overlay. Music failing is otherwise silent in the
   * most literal way — there is nothing on screen to tell you whether the loop
   * is missing, still decoding, or simply turned down.
   */
  describe() {
    if (!this.running) return 'music  stopped';
    if (this.track) return `music  loop playing (tier ${this.tier})`;
    if (this.buffer) return 'music  decoded, starting';
    return this.loading ? 'music  loading…' : 'music  no context';
  }

  /** Kept for the frame loop; a streamed loop needs no per-frame scheduling. */
  update(dt: number) {
    void dt;
  }

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
    if (this.trackGain) a.rampTo(this.trackGain.gain, 0, 0.4);
    if (this.roll) a.rampTo(this.roll.gain.gain, 0, 0.3);
    const stopAt = a.now + 0.6;
    this.track?.stop(stopAt);
    this.roll?.src.stop(stopAt);
    this.track = undefined;
    this.trackGain = undefined;
    this.trackFilter = undefined;
    this.roll = undefined;
  }
}

export const music = new Music();
