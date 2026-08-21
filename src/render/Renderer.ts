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
import { litMode } from './litMaterial';

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
export const isTouchDevice = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Metres of clear air beyond the ball before the haze starts, and the depth of
 * the band it fades across. Tuned at the opening framing, then held constant
 * for every framing above it.
 */
const FOG_LEAD = 34;
const FOG_SPAN = 70;

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
  /** Alternates so the shadow map refreshes every other frame. */
  private shadowPhase = 0;
  /** Atmospheric haze; refitted to the framing each frame by `fitFog`. */
  private fog: Fog;

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
    // Driven by hand from `focusShadow`, so the map can be refreshed on
    // alternate frames. The shadow pass measured up to 61% of the frame at the
    // top tiers, and it is dominated by filling a 1536² depth map rather than
    // by the casters in it — tightening the frustum barely moved it. The sun is
    // fixed and everything that casts moves slowly relative to a 60 Hz frame,
    // so a one-frame-old shadow map is indistinguishable in motion and costs
    // half as much.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x9ecbe2);

    this.maxDpr = quality === 'high' ? 2 : 1.35;
    this.dpr = Math.min(devicePixelRatio || 1, this.maxDpr);

    // Near plane deliberately far out. The follow camera never sits closer than
    // ~15 m to anything, so 5 m clips nothing — but the near/far *ratio* is what
    // sets depth precision, and 0.4/220 spends almost the entire buffer on the
    // first few metres. Combined with the 16-bit depth that mobile gives render
    // targets, distant geometry collapsed into a handful of depth values and
    // won or lost the depth test essentially at random: patches of correct city
    // with hard rasterised edges, and the sky losing outright to black.
    this.camera = new PerspectiveCamera(46, 1, 5, 260);

    // Bright near-white key plus a strong sky fill is the whole lighting model.
    //
    // The earlier version deliberately under-lit, on the theory that the atlas
    // was already saturated. In practice that plus ACES plus a heavy grade is
    // what produced the washed, overcast look: the key was amber enough to
    // tint everything sepia and the fill too weak to keep shadowed faces
    // colourful. Lighting up and letting the grade lift rather than crush is
    // what makes flat toy colours read as toy colours.
    this.sun = new DirectionalLight(0xfff6e2, 2.0);
    this.sun.position.set(14, 22, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(quality === 'high' ? 1536 : 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.08;
    const c = this.sun.shadow.camera;
    c.near = 1;
    c.far = 90;
    this.scene.add(this.sun, this.sun.target);

    // Sky fill keeps shadowed sides readable. The ground bounce is a warm sand
    // rather than the old dark olive, which was turning every shaded face
    // grey-green.
    this.sky = new HemisphereLight(0xd6f0ff, 0xbba97e, 1.25);
    this.scene.add(this.sky);

    this.scene.background = new Color(0x9ecbe2);
    // The level ends at a boundary wall, but the camera can look beyond it.
    // Start the haze just outside the playable district so its continuation
    // roads dissolve into sky instead of revealing an empty ground skirt.
    // Seeded at the opening framing and refitted every frame once a run is
    // under way — see `fitFog`. The seed matters because the menu renders the
    // scene before any level does.
    this.fog = new Fog(0xc4dfec, 58, 128);
    this.scene.fog = this.fog;
  }

  /**
   * Anchors the haze to the *ball*, not to the lens.
   *
   * Fog distances are measured from the camera, and this camera pulls a long
   * way back as the ball grows: ~21 m from its focus at pebble size and ~67 m
   * at Roll Master, and a phone frames looser again — 24 m and 75 m. Against
   * a fixed 58-128 m band that put the ball *itself* a quarter of the way into
   * the haze at the top tier and everything around it further still — so the
   * payoff of a whole run was played through a grey wash, with the city, the
   * trains and the demolition dust all muddied into the sky colour. Phones got
   * it worst, which is where it was reported.
   *
   * Keeping the band a constant distance *behind* the focus point instead
   * gives every tier the same picture: the district around the ball reads
   * clean, and the haze still does its real job of dissolving the world's edge
   * into the sky. At the opening framing they land within a few metres of the
   * old 58-128 m; they only move once the camera does.
   */
  fitFog(viewDistance: number) {
    const near = viewDistance + FOG_LEAD;
    if (Math.abs(near - this.fog.near) < 0.05) return;
    this.fog.near = near;
    this.fog.far = near + FOG_SPAN;
  }

  /**
   * Refits the shadow frustum around the ball each frame. A single tight
   * cascade beats a large loose one: at 5 units of ball radius the whole
   * interesting area is still under 40 units across.
   */
  focusShadow(target: Vector3, radius: number) {
    this.renderer.shadowMap.needsUpdate = (this.shadowPhase++ & 1) === 0;
    // Capped on purpose. Letting the frustum track the ball's full framing means
    // that at max size it covers a 100 m box — most of the district — and every
    // building, car and prop inside it is redrawn into the shadow map every
    // frame. Beyond ~35 m the shadows are a few pixels each and the fog and
    // tilt-shift are eating them anyway, so the cap costs nothing visible and
    // roughly halves the shadow pass late in a run.
    //
    // Profiling at tier 8 put the shadow pass at up to 45% of the whole frame,
    // by far the largest single slice, so the cap is tighter than the framing
    // would suggest. At the top tiers the camera sits ~55 m up: a shadow 30 m
    // from the ball is a handful of pixels behind fog and tilt-shift, while the
    // area it covers is quadratic in the extent. Halving 38 to 26 removes over
    // half the casters and also sharpens what remains, since the same shadow
    // map now covers a smaller patch of ground.
    const extent = Math.min(20 + radius * 5.5, 26);
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
      `lit    ${litMode}`,
    ].join('\n');
  }
}
