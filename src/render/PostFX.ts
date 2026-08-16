/**
 * Post-processing.
 *
 * Hand-rolled rather than EffectComposer so the whole chain is three passes and
 * one composite, all at controllable resolution:
 *
 *   scene -> HDR target
 *   bright-pass + downsample -> half-res
 *   two-tap gaussian blur (H, V) -> quarter-res
 *   composite: bloom + tilt-shift + colour grade + vignette + aberration
 *
 * The tilt-shift is the important one. Blurring by screen-Y is what makes a
 * casual 3D scene read as a *miniature diorama* instead of a flat mobile game,
 * and it costs one extra texture fetch. Everything else is trim.
 */

import {
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type TextureDataType,
  Uniform,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Quality } from './Renderer';
import type { Renderer } from './Renderer';

// No `precision` declarations in any of these: three.js prepends one chosen
// from the device's actual capabilities, and a hardcoded `highp` on top of it
// fails to compile on GPUs that lack fragment highp — which shows up as a black
// canvas with a perfectly healthy HUD.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Isolates the bright parts that should bloom, with a soft knee. */
const BRIGHT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;

void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  // Quadratic knee: a hard cutoff makes bloom pop on and off as objects move.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

/** Separable 9-tap gaussian; run twice for a full blur. */
const BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;

void main() {
  vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;
  sum += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tBlur;
uniform float uBloom;
uniform float uTilt;       // tilt-shift strength
uniform float uFocus;      // screen-Y of the sharp band
uniform float uBand;       // half-height of the sharp band
uniform float uVignette;
uniform float uAberration;
uniform float uFlash;
uniform vec3  uFlashColor;
uniform float uSat;
uniform float uExposure;
uniform float uContrast;
uniform float uCurve;

// Three.js skips both tone mapping and output-colour-space conversion when
// rendering into a render target, so the composite has to do them itself —
// which is what we want anyway: bloom must be gathered from HDR values BEFORE
// the curve compresses them, or bright things stop blooming.
vec3 acesFilmic(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
}

vec3 grade(vec3 c) {
  // Warm the highlights, cool the shadows. Two lerps, no LUT texture.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadow = vec3(0.95, 0.98, 1.06);
  vec3 high   = vec3(1.05, 1.01, 0.94);
  c *= mix(shadow, high, smoothstep(0.15, 0.85, l));

  // Contrast S-curve around mid-grey. ACES lands everything in a comfortable
  // but flat mid-range; this is what puts the snap back into a toy-bright
  // palette without crushing either end.
  c = mix(vec3(0.5), c, uContrast);
  c = clamp(c, 0.0, 1.0);
  c = c * c * (3.0 - 2.0 * c) * uCurve + c * (1.0 - uCurve);

  // Saturation, pivoting on luma so nothing shifts hue.
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l2), c, uSat);
}

void main() {
  // Distance from the sharp band, normalised — drives both blur and vignette
  // falloff so they always agree.
  float d = clamp((abs(vUv.y - uFocus) - uBand) / max(1.0 - uBand, 1e-3), 0.0, 1.0);
  float blurAmt = d * d * uTilt;

  vec3 sharp;
  if (uAberration > 0.0) {
    // Aberration scales with the same falloff, so the centre stays clean.
    vec2 dir = (vUv - 0.5);
    float a = uAberration * dot(dir, dir);
    sharp.r = texture2D(tScene, vUv + dir * a).r;
    sharp.g = texture2D(tScene, vUv).g;
    sharp.b = texture2D(tScene, vUv - dir * a).b;
  } else {
    sharp = texture2D(tScene, vUv).rgb;
  }

  vec3 soft = texture2D(tBlur, vUv).rgb;
  vec3 c = mix(sharp, soft, blurAmt);

  // Everything above is still linear HDR.
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = acesFilmic(c * uExposure);

  c = grade(c);

  // Vignette.
  vec2 v = (vUv - 0.5) * 2.0;
  float vig = 1.0 - uVignette * dot(v, v) * 0.5;
  c *= clamp(vig, 0.0, 1.0);

  c = mix(c, uFlashColor, uFlash);

  gl_FragColor = vec4(linearToSRGB(c), 1.0);
}
`;

/**
 * Can this device actually *render into* a half-float texture?
 *
 * Sampling RGBA16F is widely supported; using one as a colour attachment is not.
 * It needs `EXT_color_buffer_float` (WebGL2) or `EXT_color_buffer_half_float`
 * (WebGL1), and a large slice of Android GPUs expose neither. Without the check
 * every offscreen pass binds an incomplete framebuffer, which draws nothing —
 * the game runs, the HUD updates, and the canvas stays black.
 *
 * The extension string alone isn't trusted: some drivers advertise it and still
 * fail, so this allocates a 4x4 target and asks the driver directly.
 */
function supportsHalfFloatTargets(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const isWebGL2 = renderer.capabilities.isWebGL2;
  const ext = isWebGL2
    ? gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float')
    : gl.getExtension('EXT_color_buffer_half_float');
  if (!ext) return false;

  // Trust but verify: bind a real one and read the framebuffer status.
  const probe = new WebGLRenderTarget(4, 4, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  let ok = false;
  try {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(probe);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(prev);
  } catch {
    ok = false;
  }
  probe.dispose();
  return ok;
}

/**
 * The scene is rendered linear and un-tone-mapped, so sunlit surfaces sit well
 * above 1.0 and half-float is the right storage. Where the device can't render
 * to it we fall back to 8-bit, which clips highlights and bands the darks a
 * little — a real but modest quality cost, and the alternative is no picture.
 */
function target(w: number, h: number, type: TextureDataType, depth = false) {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    format: RGBAFormat,
    type,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: depth,
    stencilBuffer: false,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
}

export class PostFX {
  private quad = new Mesh(new PlaneGeometry(2, 2));
  private fsScene = new Scene();
  private fsCam: Camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private scene!: WebGLRenderTarget;
  private bright!: WebGLRenderTarget;
  private blurA!: WebGLRenderTarget;
  private blurB!: WebGLRenderTarget;
  /** Full-screen soft copy used by the tilt-shift. */
  private soft!: WebGLRenderTarget;

  private brightMat: ShaderMaterial;
  private blurMat: ShaderMaterial;
  private compMat: ShaderMaterial;

  private w = 1;
  private h = 1;
  private flash = 0;
  enabled = true;
  /** Storage type actually used for the offscreen passes. */
  private targetType: TextureDataType = HalfFloatType;
  /** True when the device forced us onto 8-bit targets. Surfaced in the HUD. */
  readonly hdr: boolean;
  private verified = false;
  /** Set when the offscreen path had to be abandoned; shown in diagnostics. */
  failure: string | null = null;

  constructor(
    private r: Renderer,
    private quality: Quality
  ) {
    this.fsScene.add(this.quad);

    const forceLdr =
      typeof location !== 'undefined' && /[?&]ldr=1/.test(location.search);
    this.hdr = !forceLdr && supportsHalfFloatTargets(r.renderer);
    this.targetType = this.hdr ? HalfFloatType : UnsignedByteType;

    this.brightMat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BRIGHT,
      uniforms: {
        tSrc: new Uniform(null),
        // On 8-bit targets everything clips at 1.0, so an HDR threshold above
        // 1 would select nothing and the bloom would silently vanish.
        uThreshold: new Uniform(this.hdr ? 1.05 : 0.62),
        uKnee: new Uniform(this.hdr ? 0.5 : 0.22),
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurMat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR,
      uniforms: { tSrc: new Uniform(null), uDir: new Uniform(new Vector2()) },
      depthTest: false,
      depthWrite: false,
    });

    this.compMat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      uniforms: {
        tScene: new Uniform(null),
        tBloom: new Uniform(null),
        tBlur: new Uniform(null),
        uBloom: new Uniform(quality === 'high' ? 0.62 : 0.45),
        uTilt: new Uniform(quality === 'high' ? 1.0 : 0.75),
        // Slightly below centre: the ball sits just under the middle of the
        // frame because the camera leads it, so that's what must stay sharp.
        uFocus: new Uniform(0.56),
        uBand: new Uniform(0.24),
        uVignette: new Uniform(0.34),
        uAberration: new Uniform(quality === 'high' ? 0.006 : 0.0),
        uFlash: new Uniform(0),
        uFlashColor: new Uniform([1, 0.96, 0.85]),
        uSat: new Uniform(1.06),
        uExposure: new Uniform(1.0),
        uContrast: new Uniform(1.05),
        // Strength of the smoothstep S-curve laid over the linear contrast.
        uCurve: new Uniform(0.16),
      },
      depthTest: false,
      depthWrite: false,
    });

    this.resize(innerWidth, innerHeight);
  }

  resize(w: number, h: number) {
    const dpr = this.r.pixelRatio;
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (pw === this.w && ph === this.h) return;
    this.w = pw;
    this.h = ph;

    for (const t of [this.scene, this.bright, this.blurA, this.blurB, this.soft]) t?.dispose();
    this.verified = false;

    this.scene = target(pw, ph, this.targetType, true);
    // Bloom at quarter res: at this art style nobody can tell, and it's 16x
    // fewer pixels through the blur.
    const bw = Math.max(1, pw >> 2);
    const bh = Math.max(1, ph >> 2);
    this.bright = target(bw, bh, this.targetType);
    this.blurA = target(bw, bh, this.targetType);
    this.blurB = target(bw, bh, this.targetType);
    // The tilt-shift blur is separate and lower-res still; it's only ever seen
    // through a heavy mix so resolution genuinely doesn't matter.
    this.soft = target(Math.max(1, pw >> 2), Math.max(1, ph >> 2), this.targetType);
  }

  /** Full-screen colour flash, used on tier-ups. */
  punchFlash(amount = 0.5) {
    this.flash = Math.max(this.flash, amount);
  }

  private draw(material: ShaderMaterial, to: WebGLRenderTarget | null) {
    this.quad.material = material;
    this.r.renderer.setRenderTarget(to);
    this.r.renderer.render(this.fsScene, this.fsCam);
  }

  /**
   * Confirms the offscreen path actually works, once, on the first real frame.
   *
   * The capability probe covers the known failure, but drivers are inventive.
   * A silent black screen is the worst possible outcome — the game is running
   * and responding, so nothing looks broken except everything — so if the scene
   * target is not complete we drop to direct rendering and say why. Reduced
   * effects beat no picture.
   */
  private verify(): void {
    this.verified = true;
    const renderer = this.r.renderer;
    const gl = renderer.getContext();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.scene);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    renderer.setRenderTarget(prev);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.enabled = false;
      this.failure = `offscreen framebuffer incomplete (0x${status.toString(16)})`;
      console.warn(`[postfx] disabled: ${this.failure} — rendering without effects`);
    }
  }

  render() {
    const gl = this.r.renderer;
    gl.info.reset();

    if (!this.verified) this.verify();

    if (!this.enabled) {
      gl.setRenderTarget(null);
      gl.render(this.r.scene, this.r.camera);
      return;
    }

    // 1. scene -> offscreen
    gl.setRenderTarget(this.scene);
    gl.clear();
    gl.render(this.r.scene, this.r.camera);

    // 2. bright pass
    this.brightMat.uniforms.tSrc.value = this.scene.texture;
    this.draw(this.brightMat, this.bright);

    // 3. separable blur, twice for a wider kernel on high quality
    const passes = this.quality === 'high' ? 2 : 1;
    let src = this.bright;
    for (let i = 0; i < passes; i++) {
      this.blurMat.uniforms.tSrc.value = src.texture;
      this.blurMat.uniforms.uDir.value.set((1.4 + i) / this.bright.width, 0);
      this.draw(this.blurMat, this.blurA);

      this.blurMat.uniforms.tSrc.value = this.blurA.texture;
      this.blurMat.uniforms.uDir.value.set(0, (1.4 + i) / this.bright.height);
      this.draw(this.blurMat, this.blurB);
      src = this.blurB;
    }

    // 4. soft full-frame copy for the tilt-shift
    this.blurMat.uniforms.tSrc.value = this.scene.texture;
    this.blurMat.uniforms.uDir.value.set(1.6 / this.soft.width, 0);
    this.draw(this.blurMat, this.blurA);
    this.blurMat.uniforms.tSrc.value = this.blurA.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1.6 / this.soft.height);
    this.draw(this.blurMat, this.soft);

    // 5. composite
    this.flash = Math.max(0, this.flash - 0.06);
    const u = this.compMat.uniforms;
    u.tScene.value = this.scene.texture;
    u.tBloom.value = this.blurB.texture;
    u.tBlur.value = this.soft.texture;
    u.uFlash.value = this.flash * 0.55;
    this.draw(this.compMat, null);
  }
}
