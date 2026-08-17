/**
 * Device vibration.
 *
 * The third feedback channel after picture and sound, and the only one a phone
 * can deliver while it is in your hand rather than your ears — which is exactly
 * the case this game is played in. It is used for one thing on purpose:
 * levelling a building. A run absorbs hundreds of props, and a device that
 * buzzes for each of them is not juice, it is a pager.
 *
 * ## What the platform actually gives you
 *
 * The Vibration API is duration-only. There is no intensity, no waveform and no
 * envelope — `navigator.vibrate([on, off, on, ...])` and nothing else. So a
 * *harder* hit can only be expressed as a *longer* pulse, and anything with
 * shape has to be built out of several pulses with gaps between them.
 *
 * Three behaviours worth knowing before changing any of this:
 *
 *  - **iOS has no Vibration API at all.** Safari implements none of it, so on
 *    an iPhone this module is a no-op however the setting is left. There is no
 *    workaround short of the Taptic-engine hacks that require a native shell.
 *    Everything here is written to degrade to nothing rather than to guess.
 *  - **It needs user activation.** Chrome blocks (and logs) a `vibrate` call
 *    from a page nobody has touched yet. In practice the PLAY button is that
 *    touch, and nothing can be demolished until a run is under way — but that
 *    ordering is why this is safe, not an accident.
 *  - **A second call replaces the first.** Patterns do not queue or mix, so two
 *    demolitions in quick succession would cut the first buzz short and restart
 *    it, which feels like a stutter rather than two impacts. Hence the cooldown.
 */

import { save } from './Save';

/**
 * Touch devices only.
 *
 * Desktop browsers either lack `vibrate` or accept it and do nothing, so this
 * check is belt-and-braces — but a laptop with a touchscreen reports coarse
 * pointer support *and* implements the API, and buzzing a trackpad-less
 * two-in-one during a demolition is not what anyone asked for.
 */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const HAS_API = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

class Haptics {
  /** True when this device can actually vibrate. The settings UI reads it. */
  readonly supported = TOUCH && HAS_API;
  /** Wall-clock time of the last buzz, for the anti-stutter cooldown. */
  private last = 0;

  get enabled() {
    return save.data.settings.haptics;
  }

  set enabled(on: boolean) {
    save.setSetting('haptics', on);
    // Confirm the change on the device itself. A vibration toggle that gives no
    // feedback when you turn it *on* is the one control where the player cannot
    // tell whether it worked.
    if (on) this.buzz(18);
  }

  /**
   * @param pattern milliseconds, alternating on/off, starting with on
   * @param minGap  the shortest interval that may retrigger; a call inside it
   *                is dropped rather than allowed to truncate the last one
   */
  buzz(pattern: number | number[], minGap = 0.18) {
    if (!this.supported || !this.enabled) return;
    const now = performance.now() / 1000;
    if (now - this.last < minGap) return;
    this.last = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* Some embedded webviews expose the method and then throw on it. */
    }
  }

  /**
   * A building coming down.
   *
   * Three pulses, not one: a long hit, then two shorter ones through widening
   * gaps. A single buzz of the same total length reads as a notification, and
   * this has to read as *masonry* — the decay is the whole tell, and it is the
   * same shape the sound and the rubble use.
   *
   * `power` (0..1, by building size) scales the pulses rather than the gaps, so
   * a cottage and a shopfront differ in weight while keeping one rhythm.
   *
   * The total is a little over a fifth of a second. Long buzzes on a phone stop
   * reading as an impact and start reading as a fault.
   */
  demolish(power: number) {
    const p = Math.max(0, Math.min(1, power));
    this.buzz([
      Math.round(26 + p * 28), // the hit
      38,
      Math.round(12 + p * 10), // rubble
      52,
      Math.round(8 + p * 6), // the last of it settling
    ]);
  }

  /** Cuts any running pattern. Used when the game leaves the foreground. */
  stop() {
    if (!this.supported) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* as above */
    }
  }
}

export const haptics = new Haptics();
