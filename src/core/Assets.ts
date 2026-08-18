/**
 * Asset loading with a shared-material registry.
 *
 * Every Kenney kit textures all of its models from a single `colormap.png`, so
 * once a kit is loaded we collapse its per-file materials down to ONE material
 * for the whole kit. That is what makes merging and instancing legal later:
 * `BallBaker` can weld 600 absorbed props into 4 draw calls only because every
 * one of them shares a material with its kit-mates.
 *
 * Geometries are returned pre-baked into kit-local space with the model's own
 * node transform applied, so callers never have to reason about GLTF hierarchy.
 */

import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { type LitMaterial, makeLit } from '../render/litMaterial';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTER_HEIGHT, KIT_MATERIAL, KIT_SCALE, type KitId } from '../data/props';

export interface LoadedModel {
  /** Merged geometry for the whole model, in the model's local space. */
  geometry: BufferGeometry;
  /** Shared kit material. Never mutate. */
  material: Material;
  /** Local-space bounds, used for placement and absorb sizing. */
  size: { x: number; y: number; z: number };
  /** Original scene, kept only for models that need their node hierarchy. */
  scene: Object3D;
  clips: AnimationClip[];
}

const KIT_TEXTURE: Record<KitId, string> = {
  cars: '/models/cars/Textures/colormap.png',
  roads: '/models/roads/Textures/colormap.png',
  commercial: '/models/commercial/Textures/colormap.png',
  suburban: '/models/suburban/Textures/colormap.png',
  market: '/models/market/Textures/colormap.png',
  blocks: '',
  food: '/models/food/Textures/colormap.png',
  pets: '/models/pets/Textures/colormap.png',
  trains: '/models/trains/Textures/colormap.png',
  // Characters are the exception: one texture per character, resolved per-model.
  characters: '',
  // Furniture is untextured; its colour lives in vertex attributes.
  furniture: '',
};

/** Fallback when a primitive somehow has no material. */
const _white = new Color(1, 1, 1);

export class Assets {
  private gltf = new GLTFLoader();
  private fbx = new FBXLoader();
  private tex = new TextureLoader();
  private materials = new Map<string, LitMaterial>();
  private textures = new Map<string, Texture>();
  private models = new Map<string, LoadedModel>();
  private inflight = new Map<string, Promise<LoadedModel>>();

  /** 0..1, for the boot progress bar. */
  progress = 0;
  private queued = 0;
  private done = 0;

  private texture(url: string): Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = this.tex.load(url);
      t.colorSpace = SRGBColorSpace;
      // The atlas is a palette of flat colour patches; any filtering across
      // patch borders bleeds neighbouring hues onto model edges.
      t.magFilter = NearestFilter;
      t.minFilter = LinearMipmapLinearFilter; // mips still help at distance
      t.anisotropy = 4;
      t.flipY = false; // glTF convention
      this.textures.set(url, t);
    }
    return t;
  }

  /** One material per kit (or per character texture). */
  material(kit: KitId, textureUrl?: string): LitMaterial {
    if (KIT_MATERIAL[kit] === 'vertexColor') {
      const key = `vc:${kit}`;
      let vc = this.materials.get(key);
      if (!vc) {
        vc = makeLit({ vertexColors: true, roughness: 0.78, metalness: 0 });
        this.materials.set(key, vc);
      }
      return vc;
    }

    const url = textureUrl ?? KIT_TEXTURE[kit];
    let m = this.materials.get(url);
    if (!m) {
      m = makeLit({
        map: this.texture(url),
        roughness: 0.72,
        metalness: 0.0,
      });
      this.materials.set(url, m);
    }
    return m;
  }

  allMaterials(): LitMaterial[] {
    return [...this.materials.values()];
  }

  private url(kit: KitId, model: string) {
    return `/models/${kit}/${model}.${kit === 'blocks' ? 'fbx' : 'glb'}`;
  }

  async load(kit: KitId, model: string): Promise<LoadedModel> {
    const key = `${kit}/${model}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.queued++;
    const loaded = kit === 'blocks'
      ? this.fbx.loadAsync(this.url(kit, model)).then((scene) => ({ scene, animations: [] as AnimationClip[] }))
      : this.gltf.loadAsync(this.url(kit, model));
    const p = loaded
      .then((g) => {
        const scene = g.scene;
        scene.updateMatrixWorld(true);

        // Characters carry a per-model texture; every other kit shares one.
        // `character-f.glb` pairs with `texture-f.png` by convention.
        const materialUrl =
          kit === 'characters'
            ? `/models/characters/Textures/${model.replace(/^character-/, 'texture-')}.png`
            : undefined;
        const material = this.material(kit, materialUrl);

        // Flatten the hierarchy into one geometry in model space.
        const vertexColored = KIT_MATERIAL[kit] === 'vertexColor';
        const parts: BufferGeometry[] = [];
        scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrixWorld);
          const n = geo.attributes.position.count;

          // Merging requires identical attribute sets across parts.
          for (const name of Object.keys(geo.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') {
              geo.deleteAttribute(name);
            }
          }
          if (!geo.attributes.uv) {
            // Merging requires every part to expose the same attributes, and a
            // 3-component stand-in would sample the atlas at garbage
            // coordinates — so pad with real 2-component zeros.
            geo.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
          }

          if (vertexColored) {
            // Fold this primitive's flat material colour into the vertices, so
            // the whole model collapses to one geometry sharing one material.
            // glTF baseColorFactor is already linear, which is what three's
            // vertex-colour path expects — no conversion.
            const src = mesh.material as LitMaterial;
            const c = src?.color ?? _white;
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
              arr[i * 3] = c.r;
              arr[i * 3 + 1] = c.g;
              arr[i * 3 + 2] = c.b;
            }
            geo.setAttribute('color', new BufferAttribute(arr, 3));
          }
          parts.push(geo);
        });

        const geometry =
          parts.length === 1
            ? parts[0]
            : (BufferGeometryUtils.mergeGeometries(parts, false) ?? parts[0]);

        // Normalise the kit into metres. Baking the scale into the geometry
        // (rather than scaling nodes at placement) means every consumer —
        // instancing, merging, the ball baker — works in one consistent world
        // and never has to remember which kit a geometry came from.
        geometry.computeBoundingBox();
        let kitScale = KIT_SCALE[kit];
        if (kit === 'characters') {
          const h = geometry.boundingBox!.max.y - geometry.boundingBox!.min.y;
          kitScale = h > 1e-4 ? CHARACTER_HEIGHT / h : 1;
        }
        if (kitScale !== 1) {
          geometry.scale(kitScale, kitScale, kitScale);
          scene.scale.setScalar(kitScale);
          scene.updateMatrixWorld(true);
        }

        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const bb = geometry.boundingBox!;

        const loaded: LoadedModel = {
          geometry,
          material,
          size: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z },
          scene,
          clips: g.animations ?? [],
        };

        // Point the source scene's meshes at the shared material too, so any
        // consumer that needs the live hierarchy (pedestrians) also batches.
        scene.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh) mesh.material = material;
        });

        this.models.set(key, loaded);
        this.inflight.delete(key);
        this.done++;
        this.progress = this.done / Math.max(this.queued, 1);
        return loaded;
      })
      .catch((err) => {
        this.done++;
        this.progress = this.done / Math.max(this.queued, 1);
        // A dev server or static host with SPA fallback answers a missing .glb
        // with index.html, and the parser then reports a baffling JSON error.
        // Name the real problem instead.
        const msg = String(err?.message ?? err);
        const detail = msg.includes('<!doctype') || msg.includes('is not valid JSON')
          ? 'server returned HTML instead of a model (missing file, or SPA fallback)'
          : msg;
        throw new Error(`failed to load ${key}: ${detail}`);
      });

    this.inflight.set(key, p);
    return p;
  }

  /** Loads many models in parallel; rejects only if every one fails. */
  async loadAll(list: { kit: KitId; model: string }[]): Promise<void> {
    const results = await Promise.allSettled(list.map((m) => this.load(m.kit, m.model)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length && results.length > 0) {
      throw new Error((failed[0] as PromiseRejectedResult).reason);
    }
    for (const f of failed) console.warn('[assets]', (f as PromiseRejectedResult).reason);
  }

  get(kit: KitId, model: string): LoadedModel {
    const m = this.models.get(`${kit}/${model}`);
    if (!m) throw new Error(`model not loaded: ${kit}/${model}`);
    return m;
  }

  has(kit: KitId, model: string) {
    return this.models.has(`${kit}/${model}`);
  }

  /** Fresh Object3D clone that keeps the shared material. */
  instantiate(kit: KitId, model: string): Group {
    const src = this.get(kit, model);
    return src.scene.clone(true) as Group;
  }
}

export const assets = new Assets();
