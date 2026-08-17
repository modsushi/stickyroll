/**
 * The skin shop.
 *
 * Tiles are real 3D renders of the actual material, not painted icons. That
 * matters more than it sounds: half of these skins are procedural shaders whose
 * whole appeal is how they catch the light, and a flat swatch sells none of it.
 * Rendering the genuine article also means the shop can never drift out of sync
 * with what you get — the picture *is* the product.
 *
 * Thumbnails borrow the game's renderer through a small render target, exactly
 * as the collection gallery does, and for the same reason: a second WebGL
 * context on mobile can evict the first and kill the game's canvas outright.
 *
 * Selection and purchase are separate steps. Tapping a tile only selects it;
 * the footer button is the only thing that ever spends gold, so a mis-tap on a
 * phone can never cost anything.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  IcosahedronGeometry,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';
import { sfx } from '../audio/Sfx';
import { bus } from '../core/Events';
import { save } from '../core/Save';
import { playerState } from '../meta/Progression';
import { buySkin, equipSkin, ownsSkin, SKINS, type SkinDef } from '../meta/Skins';
import type { Renderer } from '../render/Renderer';
import { el } from './dom';

const THUMB = 128;
const _clear = new Color();

/** linear -> sRGB byte lookup; render targets skip three's output conversion. */
const LINEAR_TO_SRGB = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    t[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return t;
})();

export class Shop {
  private root: HTMLElement;
  private grid: HTMLElement;
  private goldEl: HTMLElement;
  private detail: HTMLElement;
  private detailName: HTMLElement;
  private detailBlurb: HTMLElement;
  private action: HTMLButtonElement;
  private tiles = new Map<string, HTMLElement>();
  private selected = '';
  private rt?: WebGLRenderTarget;
  private cache = new Map<string, HTMLCanvasElement>();
  private geo = new IcosahedronGeometry(1, 2);

  onClose: () => void = () => {};
  /** Told when the equipped skin changes so the live ball can be re-skinned. */
  onEquip: (id: string) => void = () => {};

  constructor(
    parent: HTMLElement,
    private main: Renderer
  ) {
    this.root = el('div', { class: 'screen shop hidden' });

    this.goldEl = el('div', { class: 'gold-pill' });
    const head = el('div', { class: 'shop-head' });
    head.append(el('h1', {}, 'Skins'), this.goldEl);

    this.grid = el('div', { class: 'shop-grid' });

    this.detailName = el('div', { class: 'sd-name' }, '');
    this.detailBlurb = el('div', { class: 'sd-blurb' }, '');
    this.action = el('button', { class: 'btn' }, 'Equip') as HTMLButtonElement;
    this.action.addEventListener('click', () => this.act());
    const text = el('div', { class: 'sd-text' });
    text.append(this.detailName, this.detailBlurb);
    this.detail = el('div', { class: 'shop-detail' });
    this.detail.append(text, this.action);

    const close = el('button', { class: 'btn ghost' }, 'Back');
    close.addEventListener('click', () => {
      sfx.click();
      this.hide();
      this.onClose();
    });

    this.root.append(head, this.grid, this.detail, close);
    parent.append(this.root);
  }

  /**
   * Renders one skin onto a 2D canvas, cached by id.
   *
   * The sphere is the same icosahedron the ball uses, at the same subdivision,
   * so faceted skins show their real facets rather than a smooth approximation
   * that looks nothing like what gets equipped.
   */
  private thumbnail(skin: SkinDef): HTMLCanvasElement {
    const hit = this.cache.get(skin.id);
    if (hit) return hit;

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

    const mat = skin.build();
    const scene = new Scene();
    scene.add(new Mesh(this.geo, mat));
    // Lighting deliberately close to the game's — warm key over the same
    // shoulder, cool sky fill, strong ambient — so a skin that looks good here
    // looks the same rolling down a street.
    scene.add(new AmbientLight(0xffffff, 1.25));
    const key = new DirectionalLight(0xfff6e2, 2.4);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new DirectionalLight(0xd6f0ff, 1.1);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const cam = new PerspectiveCamera(32, 1, 0.1, 20);
    cam.position.set(1.6, 1.5, 2.6);
    cam.lookAt(0, 0, 0);

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
      const srcRow = (THUMB - 1 - y) * THUMB * 4; // GL reads bottom-up
      const dstRow = y * THUMB * 4;
      for (let x = 0; x < THUMB * 4; x += 4) {
        img.data[dstRow + x] = LINEAR_TO_SRGB[px[srcRow + x]];
        img.data[dstRow + x + 1] = LINEAR_TO_SRGB[px[srcRow + x + 1]];
        img.data[dstRow + x + 2] = LINEAR_TO_SRGB[px[srcRow + x + 2]];
        img.data[dstRow + x + 3] = px[srcRow + x + 3];
      }
    }
    ctx.putImageData(img, 0, 0);

    // The preview material has done its job; it would otherwise sit in GPU
    // memory holding its own compiled program for the rest of the session.
    mat.dispose();
    scene.clear();
    this.cache.set(skin.id, out);
    return out;
  }

  private build() {
    const level = playerState().level;
    this.grid.innerHTML = '';
    this.tiles.clear();

    for (const skin of SKINS) {
      const owned = ownsSkin(skin.id);
      const locked = skin.unlock > level;
      const tile = el('div', {
        class: `skin-tile${owned ? ' owned' : ''}${locked ? ' locked' : ''}`,
      });
      tile.style.setProperty('--a', skin.swatch[0]);
      tile.style.setProperty('--b', skin.swatch[1]);

      const canvas = el('canvas', { class: 'st-art', width: String(THUMB), height: String(THUMB) });
      canvas.getContext('2d')!.drawImage(this.thumbnail(skin), 0, 0);
      tile.append(canvas, el('div', { class: 'st-name' }, skin.name));

      if (save.meta.equipped === skin.id) tile.append(el('div', { class: 'st-badge on' }, 'Worn'));
      else if (owned) tile.append(el('div', { class: 'st-badge' }, 'Owned'));
      else if (locked) tile.append(el('div', { class: 'st-badge lock' }, `Lv ${skin.unlock}`));
      else tile.append(el('div', { class: 'st-badge cost' }, `${skin.price}`));

      tile.addEventListener('click', () => {
        sfx.click(true);
        this.select(skin.id);
      });
      this.grid.append(tile);
      this.tiles.set(skin.id, tile);
    }

    this.select(this.selected || save.meta.equipped);
    this.paintGold();
  }

  private select(id: string) {
    this.selected = id;
    for (const [key, tile] of this.tiles) tile.classList.toggle('sel', key === id);

    const skin = SKINS.find((s) => s.id === id)!;
    const level = playerState().level;
    const owned = ownsSkin(id);
    const locked = skin.unlock > level;

    this.detailName.textContent = skin.name;
    this.detailBlurb.textContent = skin.blurb;

    this.action.classList.remove('ghost');
    if (save.meta.equipped === id) {
      this.action.textContent = 'Equipped';
      this.action.disabled = true;
      this.action.classList.add('ghost');
    } else if (owned) {
      this.action.textContent = 'Equip';
      this.action.disabled = false;
    } else if (locked) {
      this.action.textContent = `Reach Level ${skin.unlock}`;
      this.action.disabled = false; // still clickable, so tapping explains itself
      this.action.classList.add('ghost');
    } else {
      this.action.textContent = `Buy · ${skin.price}`;
      this.action.disabled = false;
      if (save.meta.gold < skin.price) this.action.classList.add('ghost');
    }
  }

  private act() {
    const skin = SKINS.find((s) => s.id === this.selected);
    if (!skin) return;
    const level = playerState().level;

    if (ownsSkin(skin.id)) {
      if (save.meta.equipped === skin.id) return;
      equipSkin(skin.id);
      sfx.equip();
      this.onEquip(skin.id);
      this.build();
      return;
    }

    if (skin.unlock > level) {
      sfx.denied();
      this.flash(`Unlocks at level ${skin.unlock}`);
      return;
    }

    const before = save.meta.gold;
    if (!buySkin(skin.id)) {
      sfx.denied();
      this.flash(`${skin.price - before} more gold needed`);
      return;
    }

    sfx.purchase();
    bus.emit('goldChange', { gold: save.meta.gold, delta: -skin.price });
    // Bought means worn. Nobody buys a skin they did not intend to put on, and
    // making them press a second button for it is pure friction.
    equipSkin(skin.id);
    this.onEquip(skin.id);
    this.build();
    // Added after the rebuild, or it would be applied to the tile the rebuild
    // is about to throw away.
    this.tiles.get(skin.id)?.classList.add('bought');
  }

  /** Momentary message under the action button, for refusals. */
  private flash(message: string) {
    this.detailBlurb.textContent = message;
    this.detailBlurb.classList.add('warn');
    setTimeout(() => {
      this.detailBlurb.classList.remove('warn');
      const skin = SKINS.find((s) => s.id === this.selected);
      if (skin) this.detailBlurb.textContent = skin.blurb;
    }, 1600);
  }

  private paintGold() {
    this.goldEl.innerHTML = '';
    this.goldEl.append(
      el('span', { class: 'coin' }, '●'),
      el('span', { class: 'v' }, save.meta.gold.toLocaleString())
    );
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
