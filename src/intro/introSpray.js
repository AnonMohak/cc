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
export const SPRAY_COUNT = 80000;

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
 * Per particle: lateral offset (x, y), depth in the cloud (0–1), brightness
 * (0–1, most faint, a few bright) and the offset in the legs (x, y). The
 * specks make a small bright core and a fan down from it (from far, the
 * film's comet; near, its spray); a share moves from the fan into two legs
 * (SPRAY_LEGS, the film's last frames); for the rest the leg offset is the
 * fan offset. Seen from the camera, a speck's offset grows as it comes
 * nearer, so the spray opens out from its core.
 * @returns {Float32Array} 6 values per particle
 */
export function sprayParticles(count = SPRAY_COUNT, seed = 7) {
  const rand = random(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const out = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const depth = rand();
    const kind = rand();
    let x;
    let y;
    let light = Math.pow(rand(), 3);
    if (kind < 0.2) {
      // The core.
      x = 0.2 * gauss();
      y = 0.2 * gauss();
      light = Math.pow(rand(), 2);
    } else {
      // The fan: down from the core, about ±43° wide.
      const a = -Math.PI / 2 + 0.75 * gauss();
      const r = 0.15 + Math.abs(gauss()) * 0.9;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
    }
    let legX = x;
    let legY = y;
    if (kind > 0.6) {
      // A leg: a narrow bundle below the core (not from it: the film's
      // legs are short streaks under the haze), 14° to one side.
      const a = -Math.PI / 2 + (rand() < 0.5 ? -0.25 : 0.25);
      const along = 0.5 + Math.abs(gauss()) * 0.7;
      legX = Math.cos(a) * along + 0.07 * gauss();
      legY = Math.sin(a) * along + 0.07 * gauss();
      light = Math.pow(rand(), 1.5);
    }
    out.set([x, y, depth, light, legX, legY], 6 * i);
  }
  return out;
}

const vertexShader = /* glsl */ `
  // position: lateral offset x, y and depth in the cloud (0–1).
  attribute vec2 aExtra; // brightness 0–1; 0 / 1: the streak's start (shutter open) / end
  attribute vec2 aLeg; // lateral offset in the legs
  uniform float uAge;
  uniform float uPixelScale;
${lookDeclarations(SPRAY_LOOK)}
  varying float vLight;
  varying float vBright;
  varying float vStreak;
  varying float vSpread;
  vec3 at(float age, float f) {
    // The cloud's near edge comes at the camera, but no nearer than
    // SPRAY_MIN (the film's last seconds are a fountain, not a rush past the
    // camera); behind it the specks fill SPRAY_DEPTH (f: 0 near, 1 far).
    // Lateral size grows with depth a little (a cone).
    float z = max(SPRAY_DIST - SPRAY_SPEED * age, SPRAY_MIN) + f * SPRAY_DEPTH;
    // Stretched along SPRAY_ANGLE (the film's blob is a slanted comet).
    float a = radians(SPRAY_ANGLE);
    vec2 s = mix(position.xy, aLeg, SPRAY_LEGS) * vec2(SPRAY_ELONG, 1.0);
    vec2 off = mat2(cos(a), sin(a), -sin(a), cos(a)) * s * SPRAY_SPREAD * (1.0 + 0.5 * position.z);
    // The specks drift across as they come (the film's spray flows down).
    off += vec2(SPRAY_DRIFT_X, SPRAY_DRIFT_Y) * max(age, 0.0) * (0.6 + 0.8 * position.z);
    return vec3(SPRAY_U * z + off.x, SPRAY_V * z + off.y, -z);
  }
  void main() {
    // A streak over the spray's own short shutter (the film's specks
    // streak only a little).
    float lag = (1.0 - aExtra.y) * SPRAY_SHUTTER;
    // The specks also stream through the cloud toward the camera
    // (SPRAY_FLOW: cloud depths a second) and start again at its far side,
    // so the fountain keeps flowing once the cloud has stopped. Both ends of
    // a streak see the same f0, so a speck that started again inside the
    // shutter is left out whole (no line across the cloud).
    float f0 = fract(position.z - SPRAY_FLOW * uAge);
    bool restarted = f0 + SPRAY_FLOW * SPRAY_SHUTTER >= 1.0;
    float cycle = SPRAY_FLOW > 0.0 ? smoothstep(0.0, 0.05, f0) * smoothstep(1.0, 0.8, f0) : 1.0;
    vec3 p = at(uAge - lag, f0 + SPRAY_FLOW * lag);
    float z = -p.z;
    // Behind the camera, or not yet in: off the clip volume.
    if (z < 0.05 || restarted) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLight = 0.0; vBright = 0.0; vStreak = 0.0; vSpread = 0.0; return; }
    gl_Position = projectionMatrix * vec4(p, 1.0);
    // Nearer is brighter, to a cap (1 / z, not 1 / z²: far off, the film's
    // spray is already a bright blob).
    // Specks right at the camera fade out (they would be big squares).
    vLight = SPRAY_GAIN * cycle * min(1.0, 1.0 / z) * smoothstep(0.05, 0.6, z);
    vBright = aExtra.x;
    // Near, a speck crosses many pixels in the shutter: its streak spreads
    // its light (dimmer by about the square of the nearness). A line is
    // one pixel wide at any output height: × the pixel scale keeps its
    // share of the frame's light the same.
    vStreak = min(1.0, z * z) * uPixelScale;
    // Near specks are out of focus: a soft disc up to SPRAY_BLUR px (at 1080
    // lines) that spreads the same light (per pixel ∝ 1 / size², the same at
    // every output height); together they are the film's soft glow.
    gl_PointSize = clamp(SPRAY_SIZE * uPixelScale / z, 1.0, SPRAY_BLUR * uPixelScale);
    float s1080 = gl_PointSize / uPixelScale;
    vSpread = min(1.0, 4.0 / (s1080 * s1080));
  }
`;

// The streaks (lines) and the soft points share the vertex shader.
const fragmentHead = /* glsl */ `
  varying float vLight;
  varying float vBright;
  varying float vStreak;
  varying float vSpread;
${lookDeclarations(SPRAY_LOOK)}
`;
const lineFragment = /* glsl */ `${fragmentHead}
  void main() {
    // The streaks sparkle (most faint, a few bright) ...
    gl_FragColor = vec4(vec3(0.93, 0.95, 1.0) * vLight * (0.15 + 0.85 * vBright) * vStreak * SPRAY_LINE, 1.0);
  }
`;
const pointFragment = /* glsl */ `${fragmentHead}
  void main() {
    float disc = max(0.0, 1.0 - length(gl_PointCoord - 0.5) * 2.0);
    // ... the soft discs are an even glow (bright ones would show as blots).
    gl_FragColor = vec4(vec3(0.93, 0.95, 1.0) * vLight * (0.6 + 0.4 * vBright) * vSpread * SPRAY_SOFT * disc, 1.0);
  }
`;

export class IntroSpray {
  constructor() {
    const particles = sprayParticles();
    // Two vertices per particle (a streak) for the lines; the soft points
    // reuse the same buffers.
    const n = particles.length / 6;
    const position = new Float32Array(n * 6);
    const extra = new Float32Array(n * 4);
    const leg = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (const v of [0, 1]) {
        position.set(particles.subarray(6 * i, 6 * i + 3), 6 * i + 3 * v);
        extra[4 * i + 2 * v] = particles[6 * i + 3];
        extra[4 * i + 2 * v + 1] = v;
        leg.set(particles.subarray(6 * i + 4, 6 * i + 6), 4 * i + 2 * v);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    // three.js counts the vertices from 'position' (here the particle's
    // offset and depth, not a place: bounds by hand, never culled).
    this.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
    this.geometry.setAttribute('aLeg', new THREE.BufferAttribute(leg, 2));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.uniforms = {
      uAge: { value: -1 },
      uPixelScale: { value: 1 },
      ...Object.fromEntries(Object.entries(SPRAY_LOOK).map(([name, v]) => [name, { value: v }])),
    };
    const material = (fragmentShader) =>
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    this.lineMaterial = material(lineFragment);
    this.pointMaterial = material(pointFragment);
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
   * output height (px) and the camera (positions are in its frame).
   */
  update(age, height, camera) {
    this.uniforms.uAge.value = age;
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
