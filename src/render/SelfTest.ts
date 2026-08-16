/**
 * On-device render bisect.
 *
 * Reached with `?selftest=1`. Draws a ladder of increasingly demanding scenes
 * straight to the canvas, reads the pixels back after each, and prints the
 * results as large DOM text so they can be read (and screenshotted) on a phone.
 *
 * This exists because a black canvas tells you nothing on its own, and remote
 * guesswork about a device you cannot attach a debugger to is expensive and
 * usually wrong. The first test that fails names the culprit: if a solid clear
 * fails it is presentation, if the lit box fails it is the material pipeline, if
 * only the real scene fails it is content, and so on.
 *
 * Every step renders to the default framebuffer — no render targets, no post —
 * so the ladder is testing the plainest path three.js has.
 */

import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

export interface SelfTestStep {
  name: string;
  lit: number;
  of: number;
  /** Draw calls and triangles the renderer reported for this step. */
  calls?: number;
  tris?: number;
  note?: string;
}

/** Samples a spread of canvas pixels; returns how many are not near-black. */
function sample(gl: WebGLRenderingContext | WebGL2RenderingContext): number {
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  let lit = 0;
  for (const [fx, fy] of [
    [0.5, 0.5], [0.3, 0.35], [0.7, 0.35], [0.3, 0.65], [0.7, 0.65],
    [0.5, 0.2], [0.5, 0.8], [0.15, 0.5], [0.85, 0.5],
  ] as const) {
    gl.readPixels(
      Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
    );
    if (px[0] + px[1] + px[2] > 24) lit++;
  }
  return lit;
}

export function runSelfTest(
  renderer: WebGLRenderer,
  gameScene: Scene,
  gameCamera: PerspectiveCamera
): SelfTestStep[] {
  const gl = renderer.getContext();
  const steps: SelfTestStep[] = [];
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevShadows = renderer.shadowMap.enabled;

  renderer.setRenderTarget(null);

  const run = (name: string, draw: () => void, note?: string) => {
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.info.reset();
    try {
      draw();
      const r = renderer.info.render;
      const lit = sample(gl);
      // On a failure, the actual colour matters: pure 0,0,0 means something
      // painted black over the frame, while a dark non-zero means it drew and
      // came out wrong.
      let extra = note;
      // A driver that faults mid-frame can discard the whole command buffer,
      // clear included — which is the only way drawing a wall blackens the sky.
      const err = gl.getError();
      if (err !== gl.NO_ERROR || gl.isContextLost()) {
        const names: Record<number, string> = {
          [gl.INVALID_ENUM]: 'INVALID_ENUM',
          [gl.INVALID_VALUE]: 'INVALID_VALUE',
          [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
          [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FB_OP',
          [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
          [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST',
        };
        const tag = `GL ${names[err] ?? err}${gl.isContextLost() ? ' +LOST' : ''}`;
        extra = extra ? `${extra} · ${tag}` : tag;
      }
      if (lit < 9) {
        const px = new Uint8Array(4);
        gl.readPixels(
          Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
        );
        const rgb = `mid rgb ${px[0]},${px[1]},${px[2]}`;
        extra = note ? `${note} · ${rgb}` : rgb;
      }
      steps.push({
        name,
        lit,
        of: 9,
        calls: r.calls,
        tris: Math.round(r.triangles / 1000),
        note: extra,
      });
    } catch (e) {
      steps.push({ name, lit: 0, of: 9, note: `threw: ${(e as Error).message}` });
    }
  };

  // 1. Can the canvas present a solid colour at all?
  run('clear to grey', () => {
    renderer.setClearColor(0x808080, 1);
    renderer.clear();
  });

  // 2. Unlit fullscreen quad, depth test off — bare rasterisation.
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const flat = new Scene();
  flat.add(new Mesh(
    new PlaneGeometry(2, 2),
    new MeshBasicMaterial({ color: 0x22cc55, depthTest: false, depthWrite: false })
  ));
  run('unlit quad, no depth', () => renderer.render(flat, ortho));

  // 3. Same, but with the depth test active.
  const flatDepth = new Scene();
  flatDepth.add(new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ color: 0x2255cc })));
  run('unlit quad, depth on', () => renderer.render(flatDepth, ortho));

  // 4. Perspective camera at the game's exact near/far — isolates depth range.
  const persp = new PerspectiveCamera(46, gameCamera.aspect, gameCamera.near, gameCamera.far);
  persp.position.set(0, 0, 40);
  persp.lookAt(0, 0, 0);
  const boxScene = new Scene();
  boxScene.add(new Mesh(new BoxGeometry(40, 40, 40), new MeshBasicMaterial({ color: 0xcc7722 })));
  run(
    'unlit box, game near/far',
    () => renderer.render(boxScene, persp),
    `near=${gameCamera.near} far=${gameCamera.far}`
  );

  // 5. The lit material path — the shader the whole city actually uses.
  const litScene = new Scene();
  litScene.add(new Mesh(new BoxGeometry(40, 40, 40), new MeshStandardMaterial({ color: 0xcc7722 })));
  litScene.add(new AmbientLight(0xffffff, 2));
  const dir = new DirectionalLight(0xffffff, 2);
  dir.position.set(1, 2, 3);
  litScene.add(dir);
  run('lit box (standard mat)', () => renderer.render(litScene, persp));

  // 6. Instanced + lit, which is how nearly every object in the city is drawn.
  const instScene = new Scene();
  // Boxes touch edge to edge and overfill the frame: any gap would read as a
  // partial failure when it is really just my test scene having holes in it.
  const inst = new InstancedMesh(
    new BoxGeometry(10, 10, 10), new MeshStandardMaterial({ color: 0x33bb88 }), 64
  );
  const m = new Matrix4();
  for (let i = 0; i < 64; i++) {
    m.makeTranslation(((i % 8) - 3.5) * 10, (Math.floor(i / 8) - 3.5) * 10, 0);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  instScene.add(inst);
  instScene.add(new AmbientLight(0xffffff, 2));
  const dir2 = new DirectionalLight(0xffffff, 2);
  dir2.position.set(1, 2, 3);
  instScene.add(dir2);
  run('instanced lit boxes', () => renderer.render(instScene, persp));

  // 6b. The game's own atlas material on a plain box. Nothing above this point
  // samples a texture at all, and a texture that uploads as zeros samples to
  // black while leaving the sky and every untextured test perfectly correct —
  // so a failure here and a pass at 'instanced lit boxes' means the atlas, not
  // the pipeline.
  // Matched by having a map rather than by material class: the city compiles to
  // Lambert on touch devices, and testing for Standard would find nothing there
  // and report a texture failure that never happened.
  let atlas: (MeshStandardMaterial | MeshLambertMaterial) | undefined;
  gameScene.traverse((o) => {
    if (atlas) return;
    const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (mat && mat.map && mat.map.image) atlas = mat;
  });
  if (atlas) {
    const texScene = new Scene();
    texScene.add(new Mesh(new BoxGeometry(40, 40, 40), atlas));
    texScene.add(new AmbientLight(0xffffff, 2));
    const dir3 = new DirectionalLight(0xffffff, 2);
    dir3.position.set(1, 2, 3);
    texScene.add(dir3);
    const img = atlas.map!.image as { width?: number; height?: number } | undefined;
    run(
      'textured box (game atlas)',
      () => renderer.render(texScene, persp),
      `${img?.width ?? '?'}x${img?.height ?? '?'} mips=${atlas.map!.generateMipmaps}`
    );
  } else {
    steps.push({ name: 'textured box (game atlas)', lit: 0, of: 9, note: 'no atlas found' });
  }

  // 6c. Non-finite vertex data is the other way to get triangles that cover the
  // whole viewport: a NaN or Inf position has no valid clip space, and drivers
  // disagree completely about what to do with it — desktop GPUs discard the
  // triangle, mobile ones happily rasterise a wedge across the screen. This is
  // device-independent, so a failure here is reproducible anywhere.
  {
    let badGeo = 0;
    let badMat = 0;
    let badSphere = 0;
    let first = '';
    gameScene.traverse((o) => {
      const mesh = o as Mesh & { instanceMatrix?: { array: ArrayLike<number> }; count?: number };
      const g = mesh.geometry;
      if (g) {
        const pos = g.getAttribute?.('position') as { array: ArrayLike<number> } | undefined;
        if (pos) {
          for (let i = 0; i < pos.array.length; i++) {
            if (!Number.isFinite(pos.array[i])) {
              badGeo++;
              if (!first) first = `geo ${o.name || o.type}`;
              break;
            }
          }
        }
        const s = g.boundingSphere;
        if (s && (!Number.isFinite(s.radius) || !Number.isFinite(s.center.x))) {
          badSphere++;
          if (!first) first = `sphere ${o.name || o.type}`;
        }
      }
      if (mesh.instanceMatrix) {
        const a = mesh.instanceMatrix.array;
        const n = Math.min(a.length, (mesh.count ?? 0) * 16);
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(a[i])) {
            badMat++;
            if (!first) first = `matrix ${o.name || o.type}`;
            break;
          }
        }
      }
    });
    const bad = badGeo + badMat + badSphere;
    steps.push({
      name: 'finite vertex data',
      lit: bad === 0 ? 9 : 0,
      of: 9,
      note: `geo ${badGeo} matrices ${badMat} spheres ${badSphere}${first ? ` first: ${first}` : ''}`,
    });
  }

  // ── the real scene, taken apart ─────────────────────────────────────────
  // A draw-call count of 0 means everything was culled; a healthy count with a
  // black frame means it drew and the pixels came out black. Those are entirely
  // different bugs and the pixel sample alone cannot tell them apart.
  renderer.shadowMap.enabled = false;
  const city = gameScene.getObjectByName('city');
  const kids = gameScene.children.slice();
  const cityKids = city ? city.children.slice() : [];
  const wasVisible = kids.map((k) => k.visible);
  const wasCityVisible = cityKids.map((k) => k.visible);

  // Lights are never hidden. Hiding them would make every MeshStandardMaterial
  // render black and turn each of these steps into a false failure.
  const isLight = (o: { type: string }) => /Light/.test(o.type) || o.type === 'Object3D';
  const only = (names: string[]) => {
    for (const k of kids) k.visible = isLight(k) || names.includes(k.name);
    if (city) city.visible = names.includes('city');
    for (const k of cityKids) k.visible = names.includes(k.name);
  };
  const restore = () => {
    for (let i = 0; i < kids.length; i++) kids[i].visible = wasVisible[i];
    for (let i = 0; i < cityKids.length; i++) cityKids[i].visible = wasCityVisible[i];
  };

  // Background and clear only — all geometry hidden, lights left alone. This
  // must come out sky blue. If it is black, the scene's own clear is failing
  // and nothing below it means anything.
  only([]);
  run('game: background only', () => renderer.render(gameScene, gameCamera));

  // Then one piece of the city at a time. 'ground' is a single merged mesh,
  // 'roads' and 'props' are instanced, 'buildings' and 'surround' are the big
  // distant geometry — each fails for a different reason.
  for (const part of ['ground', 'roads', 'props', 'buildings', 'surround']) {
    if (!cityKids.some((k) => k.name === part)) continue;
    only(['city', part]);
    run(`game: ${part}`, () => renderer.render(gameScene, gameCamera));
  }

  // The same failing geometry drawn with the simplest material there is. If a
  // layer still blackens the frame here, the vertex data is at fault; if it
  // suddenly draws, the geometry is fine and the lit material's state is not.
  for (const part of ['props', 'buildings', 'surround']) {
    if (!cityKids.some((k) => k.name === part)) continue;
    only(['city', part]);
    gameScene.overrideMaterial = new MeshBasicMaterial({ color: 0xdd4488 });
    run(`game: ${part} (basic mat)`, () => renderer.render(gameScene, gameCamera));
    gameScene.overrideMaterial = null;
  }

  restore();
  run('game scene, no shadows', () => renderer.render(gameScene, gameCamera));

  // Basic passes at 251k triangles while every lit material fails past ~16k,
  // and neither a cheaper shader nor a quarter of the pixels helps. That rules
  // out fragment cost and points at the vertex stage: on a tile-based GPU the
  // varyings for every triangle are spooled into a fixed per-tile parameter
  // buffer, and overflowing it drops whole tiles — which is what black frames
  // with hard-edged wedges of correct city actually are.
  //
  // Basic emits vUv and vFogDepth. Every lit material also emits vNormal and
  // vViewPosition. This ladder separates the two candidate causes — the extra
  // varyings, or the lights themselves — because they need opposite fixes.
  gameScene.overrideMaterial = new MeshBasicMaterial({ color: 0xdd4488 });
  run('full: basic (2 varyings)', () => renderer.render(gameScene, gameCamera));

  // No lights at all, and almost no varyings. If this passes it confirms the
  // budget is in what the vertex stage emits rather than in lighting.
  gameScene.overrideMaterial = new MeshDepthMaterial();
  run('full: depth (no varyings)', () => renderer.render(gameScene, gameCamera));

  // Normals, but no lights whatsoever. This is the decisive one: a failure
  // here means the normal varyings alone are enough, and lighting is innocent.
  gameScene.overrideMaterial = new MeshNormalMaterial();
  run('full: normal (normals, no lights)', () => renderer.render(gameScene, gameCamera));
  gameScene.overrideMaterial = null;

  // A lit material with the scene's own lights replaced by a single ambient —
  // the cheapest lighting that exists. Passing would move the fault onto the
  // hemisphere/shadow-casting lights instead of the varyings.
  const sceneLights = kids.filter((k) => /Light/.test(k.type));
  const litVis = sceneLights.map((l) => l.visible);
  for (const l of sceneLights) l.visible = false;
  const amb = new AmbientLight(0xffffff, 2);
  gameScene.add(amb);
  gameScene.overrideMaterial = new MeshLambertMaterial({ color: 0xbb9966 });
  run('full: lambert + ambient only', () => renderer.render(gameScene, gameCamera));
  gameScene.overrideMaterial = null;
  gameScene.remove(amb);
  for (let i = 0; i < sceneLights.length; i++) sceneLights[i].visible = litVis[i];

  // How much geometry the lit path survives, measured rather than guessed. The
  // buildings group is chunked, so revealing chunks one at a time walks the
  // triangle count up until the frame drops — and the last passing figure is
  // the budget any fix has to fit inside.
  const buildings = cityKids.find((k) => k.name === 'buildings');
  if (buildings) {
    const chunks = buildings.children.slice();
    only(['city', 'buildings']);
    for (const n of [1, 2, 4, 8, chunks.length]) {
      if (n > chunks.length) continue;
      chunks.forEach((c, i) => (c.visible = i < n));
      run(`lit budget: ${n}/${chunks.length} chunks`, () =>
        renderer.render(gameScene, gameCamera)
      );
    }
    for (const c of chunks) c.visible = true;
    restore();
  }



  renderer.shadowMap.enabled = true;
  run('game scene, shadows on', () => renderer.render(gameScene, gameCamera));

  // A camera pointing somewhere unexpected would explain everything above.
  const cp = gameCamera.position;
  steps.push({
    name: 'camera',
    lit: 9,
    of: 9,
    note:
      `pos ${cp.x.toFixed(0)},${cp.y.toFixed(0)},${cp.z.toFixed(0)} ` +
      `aspect ${gameCamera.aspect.toFixed(2)} fov ${gameCamera.fov.toFixed(0)} ` +
      `children ${kids.length}`,
  });

  // A drawing buffer that does not match the CSS box is its own class of black
  // screen: correct pixels drawn somewhere the compositor never shows.
  steps.push({
    name: 'buffer',
    lit: 9,
    of: 9,
    note:
      `drawing ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} ` +
      `css ${renderer.domElement.clientWidth}x${renderer.domElement.clientHeight} ` +
      `dpr ${(window.devicePixelRatio || 1).toFixed(2)}`,
  });

  renderer.shadowMap.enabled = prevShadows;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  return steps;
}

/** Renders the results as unmissable on-screen text. */
export function showSelfTest(parent: HTMLElement, steps: SelfTestStep[], header: string) {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:#0b0b12;color:#e8e8f0;' +
    'font:13px/1.6 ui-monospace,monospace;padding:16px;overflow:auto;' +
    'white-space:pre-wrap;pointer-events:auto';
  const lines = steps.map((s) => {
    const verdict = (s.name === 'camera' || s.name === 'buffer') ? '····' : s.lit >= 5 ? 'PASS' : s.lit > 0 ? 'PART' : 'FAIL';
    const counts =
      s.calls !== undefined ? ` [${s.calls} calls, ${s.tris}k tris]` : '';
    return (
      `${verdict} ${String(s.lit).padStart(2)}/9 ${s.name}${counts}` +
      (s.note ? `\n         ${s.note}` : '')
    );
  });
  panel.textContent = `RENDER SELF-TEST\n${header}\n\n${lines.join('\n')}\n\n` +
    `PASS = drew, FAIL = black, PART = partial.\n` +
    `The first FAIL/PART is where it breaks.`;
  parent.append(panel);
}
