import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Which bloom mip feeds the ghosts: already blurred, so a point source gives
// a soft disc for free (no extra blur pass). Mip 1 ≈ 1/8 screen resolution.
const SOURCE_MIP = 1;

const LensFlareShader = {
  uniforms: {
    tSource: { value: null },
    uAmount: { value: 0 },
    uThreshold: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // A ghost is the image of the bright sources reflected between lens
  // elements: it lies on the line from the source through the optical centre,
  // at centre + k·(source − centre), magnified by |k|. Each pixel therefore
  // looks up its source at centre + (uv − centre) / k. Negative k = the far
  // side of the centre (the classic flare chain).
  fragmentShader: /* glsl */ `
    uniform sampler2D tSource;
    uniform float uAmount;
    uniform float uThreshold;
    varying vec2 vUv;

    const int GHOSTS = 5;
    const float SCALE[GHOSTS] = float[](-0.3, -0.65, -1.25, -2.2, 0.5);
    // Coating tints (anti-reflection layers reflect green / violet / amber)
    // and weights; bigger ghosts spread their light over more area.
    const vec3 TINT[GHOSTS] = vec3[](
      vec3(0.55, 1.0, 0.7),
      vec3(0.8, 0.6, 1.0),
      vec3(1.0, 0.75, 0.45),
      vec3(0.5, 0.75, 1.0),
      vec3(0.9, 0.9, 1.0)
    );
    const float WEIGHT[GHOSTS] = float[](0.6, 0.45, 0.35, 0.25, 0.3);

    void main() {
      vec2 d = vUv - 0.5;
      vec3 sum = vec3(0.0);
      for (int i = 0; i < GHOSTS; i++) {
        vec2 src = 0.5 + d / SCALE[i];
        // Sources off screen give no ghost; fade near the edges instead of
        // smearing the clamped border texels.
        vec2 edge = smoothstep(0.0, 0.08, src) * smoothstep(0.0, 0.08, 1.0 - src);
        float mask = edge.x * edge.y;
        if (mask <= 0.0) continue;
        // A source on the optical axis stacks every ghost on itself, where it
        // only washes out the source (a focused core, a black hole's shadow).
        mask *= smoothstep(0.03, 0.18, length(src - 0.5));
        vec3 c = max(texture2D(tSource, src).rgb - uThreshold, 0.0);
        sum += c * TINT[i] * (WEIGHT[i] * mask);
      }
      gl_FragColor = vec4(sum * uAmount, 1.0);
    }
  `,
};

// Peak meter: one texel per block of the source mip holds 1 when any texel
// of the block passes the threshold (the ghosts are max(c − threshold, 0),
// so below it they add exactly nothing).
const PEAK_SIZE = 8;
const peakShader = /* glsl */ `
  uniform sampler2D tSource;
  uniform float uThreshold;
  void main() {
    ivec2 size = textureSize(tSource, 0);
    ivec2 block = (size + ${PEAK_SIZE - 1}) / ${PEAK_SIZE};
    ivec2 start = ivec2(gl_FragCoord.xy) * block;
    ivec2 end = min(start + block, size);
    float peak = 0.0;
    for (int y = start.y; y < end.y; y++) {
      for (int x = start.x; x < end.x; x++) {
        vec3 c = texelFetch(tSource, ivec2(x, y), 0).rgb;
        peak = max(peak, max(c.r, max(c.g, c.b)));
      }
    }
    gl_FragColor = vec4(peak > uThreshold ? 1.0 : 0.0, 0.0, 0.0, 1.0);
  }
`;

/**
 * Subtle lens-flare ghosts from the brightest sources (supernovae, bright
 * stars, galaxy cores). Reads the bloom pass's blurred mips, so it must run
 * right after an enabled UnrealBloomPass, and adds its light to the HDR
 * buffer before tone mapping.
 *
 * Often nothing passes the threshold (the intro black hole draws after
 * bloom, so its disc never casts ghosts): a tiny peak meter of the source
 * mip, read back asynchronously like the exposure meter, skips the
 * full-screen ghost draw then. The reading lands a frame or two late;
 * `onChange` hears when it flips, so an idle render gate can wake.
 */
export class LensFlarePass extends Pass {
  /** @param {import('three/addons/postprocessing/UnrealBloomPass.js').UnrealBloomPass} bloom */
  constructor(bloom) {
    super();
    this.bloom = bloom;
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({
      name: 'LensFlare',
      uniforms: THREE.UniformsUtils.clone(LensFlareShader.uniforms),
      vertexShader: LensFlareShader.vertexShader,
      fragmentShader: LensFlareShader.fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);

    /** Called when the peak reading flips (a ghost appears or goes). */
    this.onChange = null;
    // Draw until the first reading says otherwise; always when the readback fails.
    this.lit = true;
    this.failed = false;
    this.pending = false;
    this.peakBytes = new Uint8Array(PEAK_SIZE * PEAK_SIZE * 4);
    this.peakTarget = new THREE.WebGLRenderTarget(PEAK_SIZE, PEAK_SIZE, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.peakMaterial = new THREE.ShaderMaterial({
      name: 'LensFlarePeak',
      uniforms: { tSource: this.material.uniforms.tSource, uThreshold: this.material.uniforms.uThreshold },
      vertexShader: LensFlareShader.vertexShader,
      fragmentShader: peakShader,
      depthTest: false,
      depthWrite: false,
    });
    this.peakQuad = new FullScreenQuad(this.peakMaterial);
  }

  /**
   * @param {number} amount 0–1 (setting)
   * @param {number} threshold HDR level a source must pass to cast ghosts
   */
  setAmount(amount, threshold) {
    this.material.uniforms.uAmount.value = amount;
    this.material.uniforms.uThreshold.value = threshold;
  }

  /** Meters the source mip (one reading in flight); updates `lit` when it lands. */
  measure(renderer) {
    if (this.failed || this.pending) return;
    renderer.setRenderTarget(this.peakTarget);
    this.peakQuad.render(renderer);
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
      this.failed = true;
      this.lit = true;
      return;
    }
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.peakTarget, 0, 0, PEAK_SIZE, PEAK_SIZE, this.peakBytes)
      .then(() => {
        let lit = false;
        for (let i = 0; i < this.peakBytes.length; i += 4) lit ||= this.peakBytes[i] > 127;
        if (lit !== this.lit) {
          this.lit = lit;
          this.onChange?.();
        }
      })
      .catch(() => {
        this.failed = true;
        this.lit = true;
      })
      .finally(() => {
        this.pending = false;
      });
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tSource.value = this.bloom.renderTargetsVertical[SOURCE_MIP].texture;
    this.measure(renderer);
    if (!this.lit) return;
    // Additive onto the scene + bloom image: the target must not be cleared.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.fsQuad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.peakMaterial.dispose();
    this.peakQuad.dispose();
    this.peakTarget.dispose();
  }
}
