import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYERS } from './layers.js';
import { DOF_FAR, DOF_MAX_COC_PX } from './dof.js';


const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// Mirror of dof.js circleOfConfusion (blur radius in full-res px).
const COC_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uFocus;
  uniform float uAmount;
  uniform float uMaxCoc;
  float cocAt(vec2 uv) {
    float d = max(texture2D(tDepth, uv).r, 1e-3);
    return min(uMaxCoc, uAmount * uMaxCoc * abs(d - uFocus) / d);
  }
`;

// 1. Half-res colour with the blur radius in alpha.
const prepShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  ${COC_GLSL}
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, cocAt(vUv));
  }`;

// 2. Gather blur at half res: 16 taps on a golden-angle disc of the pixel's
// radius. A tap only counts if its own blur reaches this pixel, so a sharp
// (in-focus) object never smears over the blurred ones around it.
const blurShader = /* glsl */ `
  uniform sampler2D tPrep;
  uniform vec2 uTexel; // full-res texel (radii are in full-res px)
  varying vec2 vUv;
  const int TAPS = 16;
  void main() {
    vec4 center = texture2D(tPrep, vUv);
    float r = center.a;
    vec3 sum = center.rgb;
    float wsum = 1.0;
    for (int i = 1; i < TAPS; i++) {
      float fi = float(i);
      float rad = r * sqrt(fi / float(TAPS));
      float ang = fi * 2.39996323;
      vec4 s = texture2D(tPrep, vUv + vec2(cos(ang), sin(ang)) * rad * uTexel);
      float w = smoothstep(rad - 1.5, rad + 0.5, s.a);
      sum += s.rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, r);
  }`;

// 3. Full-res composite: sharp where the blur radius is under ~1 px.
const compositeShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBlur;
  ${COC_GLSL}
  varying vec2 vUv;
  void main() {
    vec3 sharp = texture2D(tDiffuse, vUv).rgb;
    vec3 blurred = texture2D(tBlur, vUv).rgb;
    gl_FragColor = vec4(mix(sharp, blurred, smoothstep(0.5, 2.0, cocAt(vUv))), 1.0);
  }`;

/**
 * Depth of field (Settings → Cinematic → Depth of field): the focused object
 * stays sharp, nearer and farther objects and the background blur. Depth
 * comes from per-object proxies (galaxy/dofProxy.js, layer DOF) drawn into a
 * quarter-res target; the blur runs at half resolution. HDR, after the
 * black-hole and jet passes, so everything optical blurs together.
 */
export class DepthOfFieldPass extends Pass {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.height = 1;
    const half = { type: THREE.HalfFloatType, depthBuffer: false };
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.prepTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, half);
    const coc = {
      tDepth: { value: this.depthTarget.texture },
      uFocus: { value: 10 },
      uAmount: { value: 0 },
      uMaxCoc: { value: DOF_MAX_COC_PX },
    };
    const make = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.prep = new FullScreenQuad(make(prepShader, { tDiffuse: { value: null }, ...coc }));
    this.blur = new FullScreenQuad(make(blurShader, { tPrep: { value: this.prepTarget.texture }, uTexel: { value: new THREE.Vector2() } }));
    this.composite = new FullScreenQuad(make(compositeShader, { tDiffuse: { value: null }, tBlur: { value: this.blurTarget.texture }, ...coc }));
    this.coc = coc;
    this.clearColor = new THREE.Color();
    // The background has no proxy: it reads as DOF_FAR (far away).
    this.farColor = new THREE.Color(DOF_FAR, 0, 0);
  }

  setSize(width, height) {
    this.height = height;
    const w2 = Math.max(1, Math.round(width / 2));
    const h2 = Math.max(1, Math.round(height / 2));
    this.prepTarget.setSize(w2, h2);
    this.blurTarget.setSize(w2, h2);
    this.depthTarget.setSize(Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)));
    this.blur.material.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.coc.uMaxCoc.value = DOF_MAX_COC_PX * (height / 1080);
  }

  /** Strength 0–1 (0 skips the pass in createComposer). */
  setAmount(amount) {
    this.coc.uAmount.value = amount;
  }

  /** Focus distance (world units, along the view axis). */
  setFocus(distance) {
    this.coc.uFocus.value = distance;
  }

  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    // 1. Proxy depth (object centre distances; the background stays far).
    const mask = camera.layers.mask;
    const background = scene.background;
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.depthTarget);
    renderer.setClearColor(this.farColor, 1);
    renderer.clear(true, true, false);
    camera.layers.set(LAYERS.DOF);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;

    // 2–4. Half-res prep and blur, full-res composite.
    this.prep.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.prepTarget);
    this.prep.render(renderer);
    renderer.setRenderTarget(this.blurTarget);
    this.blur.render(renderer);
    this.composite.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.composite.render(renderer);
  }

  dispose() {
    this.depthTarget.dispose();
    this.prepTarget.dispose();
    this.blurTarget.dispose();
    for (const q of [this.prep, this.blur, this.composite]) {
      q.material.dispose();
      q.dispose();
    }
  }
}

