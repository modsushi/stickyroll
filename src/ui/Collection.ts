/**
 * The collection gallery — everything the player has ever absorbed.
 *
 * Thumbnails are rendered once, on demand, by dropping each model into a tiny
 * offscreen scene and taking a snapshot. That beats shipping 45 hand-made icons
 * and it stays correct automatically when the prop catalog changes.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { sfx } from '../audio/Sfx';
import type { Assets } from '../core/Assets';
import { save } from '../core/Save';
import { PROP_SPECS, PROPS } from '../data/props';
import type { Renderer } from '../render/Renderer';
import { el } from './dom';

const THUMB = 128;

/** Scratch for saving/restoring the renderer's clear colour. */
const _clear = new Color();

/** linear -> sRGB byte lookup, built once. */
const LINEAR_TO_SRGB = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    t[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return t;
})();

export class Collection {
  private root: HTMLElement;
  private grid: HTMLElement;
  private summary: HTMLElement;
  private assets?: Assets;
  private cache = new Map<string, HTMLCanvasElement>();
  private rt?: WebGLRenderTarget;

  onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private main: Renderer
  ) {
    this.root = el('div', { class: 'screen hidden' });
    this.grid = el('div', { class: 'gallery' });
    this.summary = el('h2', {}, '');

    const close = el('button', { class: 'btn' }, 'Back');
    close.addEventListener('click', () => {
      sfx.click();
      this.hide();
      this.onClose();
    });

    this.root.append(el('h1', {}, 'Collection'), this.summary, this.grid, close);
    parent.append(this.root);
  }

  attachAssets(assets: Assets) {
    this.assets = assets;
  }

  /**
   * Renders one model to a 2D canvas, cached by kit/model.
   *
   * Deliberately reuses the **game's** renderer rather than spinning up a second
   * one. A browser only allows a handful of live WebGL contexts, and on mobile
   * creating another can evict the first — which kills the game's canvas stone
   * dead while the DOM HUD carries on as if nothing happened. One context, a
   * small render target, and a pixel readback does the same job with none of
   * that risk.
   */
  thumbnail(kit: string, model: string): HTMLCanvasElement | null {
    const key = `${kit}/${model}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.assets?.has(kit as never, model)) return null;

    const renderer = this.main.renderer;
    if (!this.rt) {
      this.rt = new WebGLRenderTarget(THUMB, THUMB, {
        format: RGBAFormat,
        type: UnsignedByteType,
        colorSpace: LinearSRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
      });
    }

    const src = this.assets.get(kit as never, model);
    const scene = new Scene();
    const mesh = new Mesh(src.geometry, src.material);
    // Centre the model on its own bounds, then frame it by its largest extent.
    src.geometry.computeBoundingBox();
    const bb = src.geometry.boundingBox!;
    const c = bb.getCenter(new Vector3());
    mesh.position.set(-c.x, -c.y, -c.z);
    scene.add(mesh);
    scene.add(new AmbientLight(0xffffff, 1.5));
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);

    const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
    const cam = new PerspectiveCamera(35, 1, 0.01, size * 20);
    const d = size * 1.85;
    cam.position.set(d * 0.72, d * 0.62, d * 0.85);
    cam.lookAt(0, 0, 0);

    // Borrow the renderer, then hand it back exactly as we found it.
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);

    const px = new Uint8Array(THUMB * THUMB * 4);
    renderer.readRenderTargetPixels(this.rt, 0, 0, THUMB, THUMB, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clear, prevAlpha);

    const out = document.createElement('canvas');
    out.width = out.height = THUMB;
    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(THUMB, THUMB);
    for (let y = 0; y < THUMB; y++) {
      // GL reads bottom-up; canvas ImageData is top-down.
      const srcRow = (THUMB - 1 - y) * THUMB * 4;
      const dstRow = y * THUMB * 4;
      for (let x = 0; x < THUMB * 4; x += 4) {
        // Rendering into a target skips three's output conversion, so these are
        // linear values and need encoding by hand or every icon looks muddy.
        img.data[dstRow + x] = LINEAR_TO_SRGB[px[srcRow + x]];
        img.data[dstRow + x + 1] = LINEAR_TO_SRGB[px[srcRow + x + 1]];
        img.data[dstRow + x + 2] = LINEAR_TO_SRGB[px[srcRow + x + 2]];
        img.data[dstRow + x + 3] = px[srcRow + x + 3];
      }
    }
    ctx.putImageData(img, 0, 0);

    this.cache.set(key, out);
    scene.clear();
    return out;
  }

  private build() {
    this.grid.innerHTML = '';
    let found = 0;

    for (const spec of PROP_SPECS) {
      const count = save.countOf(spec.id);
      const known = count > 0;
      if (known) found++;

      const slot = el('div', { class: `slot ${known ? 'found' : 'locked'}` });
      const thumb = this.thumbnail(spec.kit, spec.model);
      if (thumb) {
        const canvas = el('canvas', { width: String(THUMB), height: String(THUMB) });
        canvas.getContext('2d')!.drawImage(thumb, 0, 0);
        slot.append(canvas);
      }
      slot.append(el('span', { class: 'nm' }, known ? spec.label : '???'));
      if (known) slot.append(el('span', { class: 'n' }, `×${count}`));
      slot.title = known ? `${spec.label} — ${count} collected` : 'Not yet found';
      this.grid.append(slot);
    }

    const total = PROP_SPECS.length;
    this.summary.textContent =
      `${found} of ${total} discovered · ${save.data.totalAbsorbed.toLocaleString()} objects absorbed`;
    void PROPS;
  }

  show() {
    this.build();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}
