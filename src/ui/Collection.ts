/**
 * The collection gallery — everything the player has ever absorbed.
 *
 * Thumbnails are rendered once, on demand, by dropping each model into a tiny
 * offscreen scene and taking a snapshot. That beats shipping 45 hand-made icons
 * and it stays correct automatically when the prop catalog changes.
 */

import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { sfx } from '../audio/Sfx';
import type { Assets } from '../core/Assets';
import { save } from '../core/Save';
import { PROP_SPECS, PROPS } from '../data/props';
import type { Renderer } from '../render/Renderer';
import { el } from './dom';

const THUMB = 128;

export class Collection {
  private root: HTMLElement;
  private grid: HTMLElement;
  private summary: HTMLElement;
  private assets?: Assets;
  private cache = new Map<string, HTMLCanvasElement>();
  private thumbRenderer?: WebGLRenderer;

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
   * Renders one model to a canvas, cached by kit/model. Uses a throwaway
   * renderer rather than the game's so a mid-game visit can't disturb the main
   * framebuffer. Also used for the HUD's collectible cards.
   */
  thumbnail(kit: string, model: string): HTMLCanvasElement | null {
    const key = `${kit}/${model}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.assets?.has(kit as never, model)) return null;

    if (!this.thumbRenderer) {
      this.thumbRenderer = new WebGLRenderer({ antialias: true, alpha: true });
      this.thumbRenderer.setSize(THUMB, THUMB);
      this.thumbRenderer.setPixelRatio(1);
      this.thumbRenderer.outputColorSpace = this.main.renderer.outputColorSpace;
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
    const key2 = new DirectionalLight(0xffffff, 2.2);
    key2.position.set(3, 5, 4);
    scene.add(key2);

    const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
    const cam = new PerspectiveCamera(35, 1, 0.01, size * 20);
    const d = size * 1.85;
    cam.position.set(d * 0.72, d * 0.62, d * 0.85);
    cam.lookAt(0, 0, 0);

    this.thumbRenderer.render(scene, cam);

    const out = document.createElement('canvas');
    out.width = out.height = THUMB;
    out.getContext('2d')!.drawImage(this.thumbRenderer.domElement, 0, 0);
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
