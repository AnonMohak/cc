import * as THREE from 'three';
import { SPRAY_LOOK, lookDeclarations } from './introLook.js';

/**
 * The spray inside the hole (the film's last black-hole shot, clip frames
 * 5143–5325): out of the black, a small bright blob ahead grows into a wide
 * stream of bright specks that rushes past the camera. As a model: a cloud
 * of particles ahead along the view, whose near edge comes at the camera
 * (SPRAY_SPEED, from SPRAY_DIST ahead at its start); each particle is drawn
 * as a short streak (its path over the shutter) and a faint soft point.
 * Positions are in the camera's frame; the layer draws over the composite
 * (additive). The particles are seeded (sprayParticles, pure).
 */

/** Particles in the cloud. */
export const SPRAY_COUNT = 24000;

/** A small seeded random source (mulberry32). */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per particle: lateral offset (x, y; a Gaussian, with a share bunched into
 * a few thin filaments, as in the film's last frames), depth in the cloud
 * (0–1) and brightness (0–1, most faint, a few bright).
 * @returns {Float32Array} 4 values per particle
 */
export function sprayParticles(count = SPRAY_COUNT, seed = 7) {
  const rand = random(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const depth = rand();
    let x = gauss();
    let y = gauss();
    if (rand() < 0.3) {
      // A filament: a thin line out from the axis, bending with depth.
      const f = Math.floor(rand() * 3);
      const a = -2.0 + f * 0.9 + 0.4 * depth;
      const along = Math.abs(gauss()) * 1.4;
      x = Math.cos(a) * along + 0.08 * gauss();
      y = Math.sin(a) * along + 0.08 * gauss();
    }
    out[4 * i] = x;
    out[4 * i + 1] = y;
    out[4 * i + 2] = depth;
    out[4 * i + 3] = Math.pow(rand(), 3);
  }
  return out;
}

const vertexShader = /* glsl */ `
  // position: lateral offset x, y and depth in the cloud (0–1).
  attribute vec2 aExtra; // brightness 0–1; 0 / 1: the streak's start (shutter open) / end
  uniform float uAge;
  uniform float uShutter;
  uniform float uPixelScale;
${lookDeclarations(SPRAY_LOOK)}
  varying float vLight;
  vec3 at(float age) {
    // The cloud's near edge comes at the camera; behind it the particles
    // fill SPRAY_DEPTH. Lateral size grows with depth a little (a cone).
    float z = SPRAY_DIST - SPRAY_SPEED * age + position.z * SPRAY_DEPTH;
    vec2 off = position.xy * SPRAY_SPREAD * (1.0 + 0.5 * position.z);
    return vec3(SPRAY_U * z + off.x, SPRAY_V * z + off.y, -z);
  }
  void main() {
    vec3 p = at(uAge - (1.0 - aExtra.y) * uShutter);
    float z = -p.z;
    // Behind the camera, or not yet in: off the clip volume.
    if (z < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLight = 0.0; return; }
    gl_Position = projectionMatrix * vec4(p, 1.0);
    // Nearer is brighter, to a cap (1 / z, not 1 / z²: far off, the film's
    // spray is already a bright blob).
    vLight = SPRAY_GAIN * (0.15 + 0.85 * aExtra.x) * min(1.0, 1.0 / z);
    gl_PointSize = max(1.0, SPRAY_SIZE * uPixelScale / z);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vLight;
  void main() {
    gl_FragColor = vec4(vec3(0.93, 0.95, 1.0) * vLight, 1.0);
  }
`;

export class IntroSpray {
  constructor() {
    const particles = sprayParticles();
    // Two vertices per particle (a streak) for the lines; the soft points
    // reuse the same buffers.
    const n = particles.length / 4;
    const position = new Float32Array(n * 6);
    const extra = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (const v of [0, 1]) {
        position.set(particles.subarray(4 * i, 4 * i + 3), 6 * i + 3 * v);
        extra[4 * i + 2 * v] = particles[4 * i + 3];
        extra[4 * i + 2 * v + 1] = v;
      }
    }
    this.geometry = new THREE.BufferGeometry();
    // three.js counts the vertices from 'position' (here the particle's
    // offset and depth, not a place: bounds by hand, never culled).
    this.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.uniforms = {
      uAge: { value: -1 },
      uShutter: { value: 0.05 },
      uPixelScale: { value: 1 },
      ...Object.fromEntries(Object.entries(SPRAY_LOOK).map(([name, v]) => [name, { value: v }])),
    };
    const material = (extra) =>
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, ...extra });
    this.lineMaterial = material({});
    this.pointMaterial = material({});
    this.pointMaterial.fragmentShader = fragmentShader.replace('vec4(vec3(0.93, 0.95, 1.0) * vLight, 1.0)', 'vec4(vec3(0.93, 0.95, 1.0) * vLight * 0.15 * max(0.0, 1.0 - length(gl_PointCoord - 0.5) * 2.0), 1.0)');
    this.lines = new THREE.LineSegments(this.geometry, this.lineMaterial);
    this.points = new THREE.Points(this.geometry, this.pointMaterial);
    for (const o of [this.lines, this.points]) {
      o.frustumCulled = false;
      o.matrixAutoUpdate = false;
    }
    this.scene = new THREE.Scene();
    this.scene.add(this.points, this.lines);
  }

  /**
   * Place the layer for a frame: the seconds since the spray shot began, the
   * shutter (s), the output height (px) and the camera (positions are in its
   * frame).
   */
  update(age, shutter, height, camera) {
    this.uniforms.uAge.value = age;
    this.uniforms.uShutter.value = shutter;
    this.uniforms.uPixelScale.value = height / 1080;
    for (const o of [this.lines, this.points]) o.matrixWorld.copy(camera.matrixWorld);
  }

  /** Whether there is anything to draw. */
  get active() {
    return this.uniforms.uAge.value > 0 && this.uniforms.SPRAY_GAIN.value > 0;
  }

  /** Draw over what is in the current render target. */
  render(renderer, camera) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.geometry.dispose();
    this.lineMaterial.dispose();
    this.pointMaterial.dispose();
  }
}
