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
    try {
      draw();
      steps.push({ name, lit: sample(gl), of: 9, note });
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

  // 7. The real scene, shadows off — separates content from the shadow pass.
  renderer.shadowMap.enabled = false;
  run('game scene, no shadows', () => renderer.render(gameScene, gameCamera));

  // 8. The real scene as shipped.
  renderer.shadowMap.enabled = true;
  run('game scene, shadows on', () => renderer.render(gameScene, gameCamera));

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
    const verdict = s.lit >= 5 ? 'PASS' : s.lit > 0 ? 'PART' : 'FAIL';
    return `${verdict}  ${String(s.lit).padStart(2)}/9  ${s.name}${s.note ? `\n            ${s.note}` : ''}`;
  });
  panel.textContent = `RENDER SELF-TEST\n${header}\n\n${lines.join('\n')}\n\n` +
    `PASS = drew, FAIL = black, PART = partial.\n` +
    `The first FAIL/PART is where it breaks.`;
  parent.append(panel);
}
