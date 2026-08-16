/**
 * Drag-anywhere steering.
 *
 * Touching down anchors a floating stick; dragging away from the anchor sets
 * direction and strength. The anchor *follows* the finger once the drag exceeds
 * the deadzone radius, so a long swipe never saturates and you can steer
 * continuously without lifting — the single most important thing for a game
 * meant to be played one-handed for minutes at a time.
 *
 * Keyboard (WASD/arrows) is supported so the game is playable on desktop.
 */

import { clamp01 } from './Math';

const RADIUS = 78; // px to reach full strength
const DEADZONE = 6;

export interface StickState {
  /** Screen-space direction, normalised. +y is screen-down. */
  x: number;
  y: number;
  /** 0..1 */
  strength: number;
  active: boolean;
  /** Anchor + current position in CSS px, for drawing the stick. */
  originX: number;
  originY: number;
  curX: number;
  curY: number;
  /** True while the input came from touch, so we can hide the desktop hint. */
  touch: boolean;
}

export class Input {
  readonly stick: StickState = {
    x: 0, y: 0, strength: 0, active: false,
    originX: 0, originY: 0, curX: 0, curY: 0, touch: false,
  };

  private pointerId: number | null = null;
  private keys = new Set<string>();
  private disposers: (() => void)[] = [];
  /** Set while a modal UI screen owns input. */
  enabled = true;

  constructor(private el: HTMLElement) {
    this.bind(el, 'pointerdown', this.onDown as EventListener);
    this.bind(window, 'pointermove', this.onMove as EventListener);
    this.bind(window, 'pointerup', this.onUp as EventListener);
    this.bind(window, 'pointercancel', this.onUp as EventListener);
    this.bind(window, 'keydown', this.onKey(true) as EventListener);
    this.bind(window, 'keyup', this.onKey(false) as EventListener);
    this.bind(window, 'blur', this.reset as EventListener);
    // Stop iOS rubber-banding and double-tap zoom over the canvas.
    this.bind(el, 'touchstart', (e: Event) => e.preventDefault(), { passive: false });
    this.bind(el, 'contextmenu', (e: Event) => e.preventDefault());
  }

  private bind(
    target: EventTarget,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions
  ) {
    target.addEventListener(type, fn, opts);
    this.disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    const s = this.stick;
    s.active = true;
    s.touch = e.pointerType !== 'mouse';
    s.originX = s.curX = e.clientX;
    s.originY = s.curY = e.clientY;
    s.x = s.y = s.strength = 0;
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const s = this.stick;
    s.curX = e.clientX;
    s.curY = e.clientY;

    let dx = s.curX - s.originX;
    let dy = s.curY - s.originY;
    const len = Math.hypot(dx, dy);

    if (len < DEADZONE) {
      s.x = s.y = s.strength = 0;
      return;
    }

    // Drag the anchor along behind the finger so strength saturates but never
    // "runs out of stick".
    if (len > RADIUS) {
      const pull = (len - RADIUS) / len;
      s.originX += dx * pull;
      s.originY += dy * pull;
      dx = s.curX - s.originX;
      dy = s.curY - s.originY;
    }

    const l = Math.hypot(dx, dy) || 1;
    s.x = dx / l;
    s.y = dy / l;
    s.strength = clamp01((l - DEADZONE) / (RADIUS - DEADZONE));
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.reset();
  };

  private reset = () => {
    const s = this.stick;
    s.active = false;
    s.x = s.y = s.strength = 0;
  };

  private onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  };

  isDown(key: string) {
    return this.keys.has(key);
  }

  /**
   * Combined steering vector in screen space, normalised to length <= 1.
   * Keyboard wins when held so desktop testing bypasses the stick entirely.
   */
  direction(out: { x: number; y: number }): { x: number; y: number } {
    if (!this.enabled) {
      out.x = out.y = 0;
      return out;
    }
    let kx = 0;
    let ky = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1;

    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      out.x = kx / l;
      out.y = ky / l;
      return out;
    }

    const s = this.stick;
    out.x = s.x * s.strength;
    out.y = s.y * s.strength;
    return out;
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
