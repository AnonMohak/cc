import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { introCamera } from './introTimeline.js';

const _pose = { position: [0, 0, 0], target: [0, 0, 0], roll: 0, fov: 60 };
const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// Placeholder look (milestone 1): a black shadow, a thin ring and a flat warm
// disc, unlensed. The ray-marched model replaces it.
const fragmentShader = /* glsl */ `
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis; // right, up, -forward (camera to world)
  uniform vec2 uTanHalfFov;
  varying vec2 vUv;

  const float SHADOW_B = 2.598;

  void main() {
    vec3 rd = normalize(uCamBasis * vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    float tc = -dot(uCamPos, rd);
    float b = length(uCamPos + rd * max(tc, 0.0));
    vec3 col = vec3(0.004, 0.003, 0.002);
    // Flat disc in y = 0, 3–20 Rs, in front of the shadow test.
    float tDisc = -uCamPos.y / rd.y;
    bool shadow = tc > 0.0 && b < SHADOW_B;
    if (tDisc > 0.0 && (!shadow || tDisc < tc)) {
      float r = length(uCamPos + rd * tDisc);
      float k = smoothstep(2.8, 3.4, r) * (1.0 - smoothstep(12.0, 20.0, r));
      col += vec3(1.0, 0.62, 0.32) * k * 2.5 * pow(3.0 / r, 1.5);
    } else if (shadow) {
      col = vec3(0.0);
    }
    col += vec3(1.0, 0.75, 0.5) * exp(-pow((b - SHADOW_B * 1.02) / 0.03, 2.0)) * step(0.0, tc) * 0.8;
    col = col / (1.0 + col);
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`;

/**
 * The intro cinematic: the animation black hole, its own camera and its own
 * rendering, apart from the scene and its black holes. It exists only while
 * the intro plays (app.js), then is disposed.
 */
export class IntroCinematic {
  /** @param {{ aspect: number }} options */
  constructor({ aspect }) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1000);
    this.material = new THREE.ShaderMaterial({
      name: 'IntroPlaceholder',
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uCamBasis: { value: new THREE.Matrix3() },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width, height) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Place the camera for t seconds since the start-box click. */
  update(t) {
    const pose = introCamera(t, _pose);
    const cam = this.camera;
    cam.position.fromArray(pose.position);
    _target.fromArray(pose.target);
    // Roll: tilt the up vector about the view direction.
    _forward.subVectors(_target, cam.position).normalize();
    _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();
    cam.up.copy(THREE.Object3D.DEFAULT_UP).multiplyScalar(Math.cos(pose.roll)).addScaledVector(_right, Math.sin(pose.roll));
    cam.lookAt(_target);
    if (cam.fov !== pose.fov) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** @param {THREE.WebGLRenderer} renderer */
  render(renderer) {
    const u = this.material.uniforms;
    const cam = this.camera;
    u.uCamPos.value.copy(cam.position);
    u.uCamBasis.value.setFromMatrix4(cam.matrixWorld);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    u.uTanHalfFov.value.set(tanY * cam.aspect, tanY);
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
