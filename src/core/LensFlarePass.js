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
        vec3 c = max(texture2D(tSource, src).rgb - uThreshold, 0.0);
        sum += c * TINT[i] * (WEIGHT[i] * mask);
      }
      gl_FragColor = vec4(sum * uAmount, 1.0);
    }
  `,
};

/**
 * Subtle lens-flare ghosts from the brightest sources (supernovae, bright
 * stars, galaxy cores). Reads the bloom pass's blurred mips, so it must run
 * right after an enabled UnrealBloomPass, and adds its light to the HDR
 * buffer before tone mapping.
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
  }

  /**
   * @param {number} amount 0–1 (setting)
   * @param {number} threshold HDR level a source must pass to cast ghosts
   */
  setAmount(amount, threshold) {
    this.material.uniforms.uAmount.value = amount;
    this.material.uniforms.uThreshold.value = threshold;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tSource.value = this.bloom.renderTargetsVertical[SOURCE_MIP].texture;
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
  }
}
