import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';

export type Quality = 'low' | 'high';

/**
 * Cheap device probe: shadow and post budgets differ enormously by class.
 *
 * Any touch device takes the light path. A modern phone reports 8 cores and 8 GB
 * and looks like a desktop to a spec sheet, but its GPU and thermal budget are
 * nothing alike — and MSAA plus a 1536px shadow map plus a full post chain is
 * exactly the combination that pushes mobile drivers into trouble.
 */
export function detectQuality(): Quality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'high';
}

/** True for phones and tablets; used to pick conservative context options. */
const isTouchDevice = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly sky: HemisphereLight;

  quality: Quality;
  /** Device pixel ratio cap; dropped adaptively if we miss frame budget. */
  private maxDpr: number;
  private dpr: number;
  private slowFrames = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality === 'high',
      // 'high-performance' asks for the discrete GPU on a laptop; on mobile
      // there is only one GPU and some drivers handle the hint poorly, so don't
      // ask for anything special there.
      powerPreference: isTouchDevice() ? 'default' : 'high-performance',
      stencil: false,
      alpha: false,
      // A failed context is better surfaced than silently software-emulated at
      // one frame a second.
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // PostFX tone-maps in its composite pass (three skips tone mapping when
    // rendering into a render target). These settings only matter on the
    // no-post fallback path, so they mirror the shader's curve.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // PostFX renders the scene plus five fullscreen passes per frame, and
    // `info` resets on every render() call — so left on auto it only ever
    // reports the final composite quad. Reset once per frame instead, in
    // PostFX, and the counters describe the whole frame.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(0x74c4e8);

    this.maxDpr = quality === 'high' ? 2 : 1.35;
    this.dpr = Math.min(devicePixelRatio || 1, this.maxDpr);

    this.camera = new PerspectiveCamera(46, 1, 0.4, 220);

    // Warm key + cool sky fill is the whole lighting model. Anything more
    // fights the flat-colour atlas rather than helping it.
    //
    // Intensities are deliberately modest: the atlas is already saturated, and
    // over-lighting pushes every mid-tone into the shoulder of the ACES curve,
    // which is what turns a bright toy city into a washed-out grey one.
    this.sun = new DirectionalLight(0xfff0cf, 1.75);
    this.sun.position.set(14, 22, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(quality === 'high' ? 1536 : 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.08;
    const c = this.sun.shadow.camera;
    c.near = 1;
    c.far = 90;
    this.scene.add(this.sun, this.sun.target);

    // Sky fill is what keeps shadowed sides readable instead of black. Kept low
    // so the sun still does the shaping.
    this.sky = new HemisphereLight(0xbcdcf5, 0x6e7a58, 0.95);
    this.scene.add(this.sky);

    this.scene.background = new Color(0x74c4e8);
    // Fog starts well beyond the play radius so it reads as aerial haze on the
    // skyline rather than a grey wall creeping up on the ball.
    this.scene.fog = new Fog(0x9fd8ee, 95, 240);
  }

  /**
   * Refits the shadow frustum around the ball each frame. A single tight
   * cascade beats a large loose one: at 5 units of ball radius the whole
   * interesting area is still under 40 units across.
   */
  focusShadow(target: Vector3, radius: number) {
    // Capped on purpose. Letting the frustum track the ball's full framing means
    // that at max size it covers a 100 m box — most of the district — and every
    // building, car and prop inside it is redrawn into the shadow map every
    // frame. Beyond ~35 m the shadows are a few pixels each and the fog and
    // tilt-shift are eating them anyway, so the cap costs nothing visible and
    // roughly halves the shadow pass late in a run.
    const extent = Math.min(20 + radius * 5.5, 38);
    const c = this.sun.shadow.camera;
    if (c.right !== extent) {
      c.left = -extent;
      c.right = extent;
      c.top = extent;
      c.bottom = -extent;
      c.far = extent * 4 + 40;
      c.updateProjectionMatrix();
    }
    // Snap to texel increments so shadows don't crawl as the camera moves.
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + extent * 0.7, extent * 1.5 + 12, sz + extent * 0.55);
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
  }

  /**
   * Adaptive resolution. Sustained slow frames drop DPR one notch rather than
   * letting the whole game stutter — invisible at a glance, unlike judder.
   */
  adapt(fps: number, w: number, h: number) {
    if (fps < 48) {
      if (++this.slowFrames > 90 && this.dpr > 0.75) {
        this.dpr = Math.max(0.75, this.dpr - 0.25);
        this.slowFrames = 0;
        this.resize(w, h);
      }
    } else {
      this.slowFrames = 0;
    }
  }

  get pixelRatio() {
    return this.dpr;
  }

  /**
   * A lost context is the other way to get a black canvas while the game keeps
   * running — common on mobile when the OS reclaims GPU memory. Preventing the
   * default lets the browser restore it; without that the canvas stays dead for
   * the rest of the session with no clue why.
   */
  handleContextLoss(onLost?: (restored: boolean) => void) {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[gl] context lost — waiting for restore');
      onLost?.(false);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[gl] context restored');
      onLost?.(true);
    });
  }

  /** One-line capability summary, for the perf overlay and bug reports. */
  diagnostics(): string {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const device = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 38)
      : 'unknown';
    return [
      `gl     ${this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}`,
      `gpu    ${device}`,
      `quality ${this.quality}`,
    ].join('\n');
  }
}
