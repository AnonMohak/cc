import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import stepShader from '../galaxy/shaders/collisionStep.glsl?raw';
import initShader from '../galaxy/shaders/collisionInit.glsl?raw';
import starsChunk from '../galaxy/shaders/chunks/stars.glsl?raw';
import simInitChunk from '../galaxy/shaders/chunks/simInit.glsl?raw';
import { glsl, CHUNKS } from '../galaxy/shaders/glsl.js';
import { createStreamMaterial } from '../galaxy/starMaterials.js';
import { createRandom } from '../galaxy/random.js';
import { LAYERS } from '../core/layers.js';
import { LENS_REACH } from '../galaxy/blackHole.js';
import { G_SIM, SOFTENING, galaxyMass, spinAxis, starSubsteps, simTextureSize, indirectAccel, gasFade } from '../galaxy/collision.js';
import {
  KIND,
  INSPIRAL_SECONDS,
  DRAIN_SECONDS,
  MERGE_FADE_SECONDS,
  ACC_RADIUS,
  ACC_RATE,
  ACC_SPIN_MAX,
  ACC_SETTLE,
  pickWinner,
  turnsFor,
  orbitRadii,
  designPath,
  pathPose,
  createPose,
  orbitGm,
  timeLapse,
  victimHoleScale,
  winnerGrowth,
  releaseRadius,
  releasedShare,
  freeDrag,
  feedLevel,
  flashGain,
  rippleState,
  starburstLevel,
  afterSeconds,
  captureRadius,
} from '../galaxy/consumption.js';
import { prepareGalaxy, isGalaxyReady, clearGalaxyCache } from '../galaxy/generationCache.js';

const STEP_GALAXY = glsl(CHUNKS.model, starsChunk, simInitChunk, stepShader);
const STEP_STREAM = `#define STREAM\n${stepShader}`;
const INIT_SHADER = glsl(CHUNKS.model, starsChunk, simInitChunk, initShader);
// A release radius above every orbit: nothing comes free.
const NO_RELEASE = 1e9;
// Disc brightness at full feeding flare (× 1 + this).
const DISC_FEED_GAIN = 1.5;
// Gold stream: brightness, and its births spread over this share of the mass loss.
const STREAM_GAIN = 2.5;
const STREAM_BIRTHS_END = 0.92;
// Share of stream matter born at L1 (toward the winner); the rest at L2.
const STREAM_L1 = 0.7;

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _indirect = [0, 0, 0];

/**
 * Whether this GPU can render to float textures (the star simulation needs
 * RGBA32F targets; half floats are too coarse for world positions).
 * @param {THREE.WebGLRenderer} renderer
 */
export function collisionSupported(renderer) {
  return renderer.capabilities.maxVertexTextures > 0 && renderer.extensions.has('EXT_color_buffer_float');
}

/** A Galaxy as a consumption body (consumption.js Body). */
function bodyOf(g) {
  const rs = g.standalone ? g.rsUnit * g.radius : 0;
  return { id: g.id, hole: g.standalone, radius: g.radius, rs, discOuter: g.standalone ? g.hole.discSize * rs : 0 };
}

function normalOf(g) {
  g.group.updateMatrixWorld();
  g.group.getWorldQuaternion(_quaternion);
  return _normal.copy(UP).applyQuaternion(_quaternion).toArray();
}

/**
 * One running consumption (galaxy/consumption.js has the timeline,
 * galaxy/collision.js the physics): the winner stays put, the victim follows
 * its scripted path, and the stars are test particles on the GPU (two
 * RGBA32F ping-pong textures per body: position + state, velocity).
 *
 * - Black hole eats a galaxy: the galaxy's stars stay on their analytic
 *   orbits until tides release them (outside in), then fall, accrete and are
 *   gone; the gas fades as they go.
 * - Black hole eats a black hole: the victim shrinks every turn; its disc
 *   matter leaves in a gold stream (its own small simulation) and its star
 *   cloud is released the same way.
 * - Galaxy merges into a galaxy: both galaxies' stars are free from the
 *   orbit entry, in a time-lapse (the real masses are slow); at the end a
 *   preview of the remnant fades in over the simulated stars.
 *
 * update() returns { type: 'commit', … } once: the caller puts the result
 * in the store, then calls committed(); the after-effects (flare, flash,
 * ripple, starburst) run until isDone(). dispose() stops at any point
 * (before the commit, both objects go back to their start).
 */
export class CollisionSim {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, starter: import('../galaxy/Galaxy.js').Galaxy, partner: import('../galaxy/Galaxy.js').Galaxy,
   *   plan: (winnerId: string, victimId: string) => { patch: object, remnant: object },
   *   createPreview?: (entry: object) => import('../galaxy/Galaxy.js').Galaxy, removePreview?: (g: object) => void, streamCount?: number }} options
   *   plan: the store patch for the winner and its entry after the commit
   */
  constructor({ renderer, starter, partner, plan, createPreview, removePreview, streamCount = 12000 }) {
    this.renderer = renderer;
    this.createPreview = createPreview;
    this.removePreview = removePreview;
    const pick = pickWinner(bodyOf(starter), bodyOf(partner));
    this.kind = pick.kind;
    this.winner = pick.winner.id === starter.id ? starter : partner;
    this.victim = this.winner === starter ? partner : starter;
    this.ids = [this.winner.id, this.victim.id];
    this.holeWinner = this.kind !== KIND.GALAXY_GALAXY;
    const { patch, remnant } = plan(this.winner.id, this.victim.id);
    this.patch = patch;
    this.remnant = remnant;

    const w = this.winner;
    const v = this.victim;
    for (const g of [w, v]) g.beginCollision();
    const wb = bodyOf(w);
    const vb = bodyOf(v);
    const { r0, rEnd } = orbitRadii(this.kind, wb, vb);
    this.normal = normalOf(w);
    this.victimNormal = normalOf(v);
    this.path = designPath({
      kind: this.kind,
      winnerPos: w.group.position.toArray(),
      victimPos: v.group.position.toArray(),
      normal: this.normal,
      spin: spinAxis(this.normal, w.speed),
      r0,
      rEnd,
      turns: turnsFor(this.kind, v.radius),
      seconds: INSPIRAL_SECONDS[this.kind],
    });
    this.pose = pathPose(this.path, 0, createPose());
    this.startDistance = this.pose.radius;
    this.t = 0;
    /** 'run' → ('drain' | 'fade') → 'commit' → 'after' → 'done' */
    this.stage = 'run';
    this.stageTime = 0;
    this.afterTime = 0;

    // Gravity. Black-hole winners get the mass that makes the path a Kepler
    // orbit, softened inside the disc (accretion takes over there).
    const gmOrbit = orbitGm(this.path);
    this.accRadius = ACC_RADIUS * wb.discOuter;
    if (this.kind === KIND.HOLE_HOLE) {
      const q = Math.min(1, vb.rs / Math.max(wb.rs, 1e-9));
      this.gmWinner = gmOrbit / (1 + q);
      this.gmVictim0 = (gmOrbit * q) / (1 + q);
      this.eps2Winner = (0.5 * this.accRadius) ** 2;
      this.eps2Victim = (0.5 * vb.discOuter) ** 2;
    } else if (this.kind === KIND.HOLE_GALAXY) {
      this.gmWinner = gmOrbit;
      this.gmVictim0 = G_SIM * galaxyMass(v.radius);
      this.eps2Winner = (0.5 * this.accRadius) ** 2;
      this.eps2Victim = (SOFTENING * v.radius) ** 2;
    } else {
      this.gmWinner = G_SIM * galaxyMass(w.radius);
      this.gmVictim0 = G_SIM * galaxyMass(v.radius);
      this.eps2Winner = (SOFTENING * w.radius) ** 2;
      this.eps2Victim = (SOFTENING * v.radius) ** 2;
      this.lapse = timeLapse(r0, this.path.omega0, w.radius, v.radius);
    }
    this.lapseNow = 1;

    this.field = {
      uDt: { value: 0 },
      uCentre0: { value: new THREE.Vector3().fromArray(this.path.winnerPos) },
      uCentre1: { value: new THREE.Vector3() },
      uGm: { value: new THREE.Vector2() },
      uEps2: { value: new THREE.Vector2(this.eps2Winner, this.eps2Victim) },
      uIndirect: { value: new THREE.Vector3() },
      uDrag: { value: 0 },
      uHole: { value: this.holeWinner ? 1 : 0 },
      uHoleNormal: { value: new THREE.Vector3().fromArray(this.normal) },
      uAccRadius: { value: this.accRadius },
      uCapture: { value: 0 },
      uAccRate: { value: ACC_RATE },
      uSpinMax: { value: ACC_SPIN_MAX },
      uSettle: { value: ACC_SETTLE },
      uTimeLeft: { value: 1 },
    };

    /** @type {{ gpu: GPUComputationRenderer, pos: object, vel: object, galaxy?: object, uniforms?: object, textures?: THREE.Texture[] }[]} */
    this.sims = [];
    this.stream = null;
    this.preview = null;
    this.remnantReady = false;
    this.winnerSim = null;
    // The victim's stars start BOUND (zero textures): drawn analytic until released.
    this.victimSim = this.createGalaxySim(v);
    if (this.holeWinner) {
      if (this.kind === KIND.HOLE_HOLE) this.stream = this.createStream(streamCount);
    } else {
      // Built in a worker while the galaxies close in (no stall at the end).
      prepareGalaxy(remnant.shape, remnant.seed, remnant.structure).then(() => {
        this.remnantReady = isGalaxyReady(remnant.shape, remnant.seed);
      });
    }
    this.applyLooks();
  }

  /** The objects in the collision ([winner, victim] until the commit, then the winner). */
  pair() {
    return this.ids;
  }

  /** The objects to keep in focus (depth of field). */
  members() {
    if (this.stage === 'after' || this.stage === 'done') return [this.winner];
    return this.preview ? [this.winner, this.victim, this.preview] : [this.winner, this.victim];
  }

  /** The winner's centre (fixed: the camera target). */
  centre(out = new THREE.Vector3()) {
    return out.fromArray(this.path.winnerPos);
  }

  isDone() {
    return this.stage === 'done';
  }

  /** Whether any stream matter is drawn after the lens pass (JetPass must run). */
  drawsAfterLens() {
    return Boolean(this.stream && this.stream.after.visible);
  }

  /**
   * For the auto camera and the sound: the stage, progress 0–1 over the
   * path, the victim's distance from the winner, the orbit frequency (Hz)
   * and the seconds since the merge.
   */
  status(out = {}) {
    const p = this.pose;
    out.stage = this.stage;
    out.kind = this.kind;
    out.progress = this.stage === 'after' || this.stage === 'done' ? 1 : Math.min(1, this.t / this.path.duration);
    out.distance = p.radius;
    out.startDistance = this.startDistance;
    out.orbitHz = p.stage === 'approach' || p.radius <= 0 ? 0 : Math.hypot(p.vel[0], p.vel[1], p.vel[2]) / (2 * Math.PI * p.radius);
    out.afterTime = this.afterTime;
    out.merged = p.stage === 'merged';
    out.turnsDone = p.turnsDone;
    return out;
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {{ type: 'commit', winnerId: string, victimId: string, patch: object } | null}
   */
  update(dt) {
    if (this.stage === 'done' || this.stage === 'commit') return null;
    if (this.stage === 'after') {
      this.tickAfter(dt);
      return null;
    }
    if (dt > 0) {
      // Galaxy merger time-lapse: in from 1 over the approach, out over the fade.
      const lapse = this.lapse ?? 1;
      if (lapse > 1) {
        const k = this.stage === 'fade' ? 1 - smooth(this.stageTime / MERGE_FADE_SECONDS) : smooth(this.t / this.path.approach);
        this.lapseNow = 1 + (lapse - 1) * k;
        this.winner.timeScale = this.victim.timeScale = this.lapseNow;
      }
      const dtStar = dt * this.lapseNow;
      const n = this.sims.length > 0 ? Math.max(1, starSubsteps(dtStar)) : 1;
      for (let i = 0; i < n; i++) {
        this.t += dt / n;
        pathPose(this.path, this.t, this.pose);
        this.victim.group.position.fromArray(this.pose.pos);
        if (this.kind === KIND.GALAXY_GALAXY && !this.winnerSim && this.pose.stage !== 'approach') this.startMergerStars();
        if (this.sims.length > 0 && this.pose.stage !== 'approach') {
          this.setField(dtStar / n);
          for (const sim of this.sims) sim.gpu.compute();
        }
      }
      if (this.pose.stage === 'merged') {
        if (this.stage === 'run') this.stage = this.holeWinner ? 'drain' : 'fade';
        if (this.stage === 'fade' && !this.preview) {
          // Wait for the remnant build (a slow device: the merger keeps swirling).
          if (this.remnantReady) this.startFade();
        } else {
          this.stageTime += dt;
        }
        const end = this.stage === 'drain' ? DRAIN_SECONDS : MERGE_FADE_SECONDS;
        if (this.stageTime >= end && (this.stage === 'drain' || this.preview)) {
          this.stage = 'commit';
          this.applyLooks();
          return { type: 'commit', winnerId: this.winner.id, victimId: this.victim.id, patch: this.patch };
        }
      }
    }
    this.applyLooks();
    return null;
  }

  /** The result is in the store (the victim is gone): only the winner's after-effects remain. */
  committed() {
    this.freeSimulation();
    if (this.preview) {
      this.removePreview?.(this.preview);
      this.preview = null;
    }
    clearGalaxyCache();
    this.winner.endCollision();
    this.ids = [this.winner.id];
    this.victim = null;
    this.stage = 'after';
    this.afterTime = 0;
    this.tickAfter(0);
  }

  tickAfter(dt) {
    this.afterTime += dt;
    const w = this.winner;
    const t = this.afterTime;
    if (this.holeWinner) {
      const feed = feedLevel(this.kind, this.path.turns, this.path.turns, t);
      const flash = this.kind === KIND.HOLE_HOLE ? flashGain(t) : 1;
      w.setFeeding(feed);
      w.setHoleLook(1, (1 + DISC_FEED_GAIN * feed) * flash, 1 + feed);
      if (this.kind === KIND.HOLE_HOLE) {
        const r = rippleState(t, _ripple);
        w.setHoleRipple(r.radius, r.amp);
      }
    } else {
      w.setStarburst(starburstLevel(t));
    }
    if (t >= afterSeconds(this.kind)) {
      w.clearConsumeEffects();
      this.stage = 'done';
    }
  }

  /** The current state of the bodies, the lens split, the looks and the textures. */
  applyLooks() {
    const w = this.winner;
    const v = this.victim;
    const p = this.pose;
    const turnsDone = p.turnsDone;
    const turns = this.path.turns;
    if (this.holeWinner) {
      const feed = feedLevel(this.kind, turnsDone, turns);
      w.setFeeding(feed);
      w.setHoleLook(winnerGrowth(p.progress), 1 + DISC_FEED_GAIN * feed, 1 + feed);
      const rs = w.rsUnit * w.radius * w.holeScale;
      const view = { center: this.path.winnerPos, capture: captureRadius(rs), reach: LENS_REACH * rs };
      v.setConsumeView(view);
      if (this.kind === KIND.HOLE_HOLE) {
        v.setHoleLook(victimHoleScale(turnsDone, turns), 1, 1);
        this.updateStream(view);
      } else {
        v.setGasFade(gasFade(releasedShare(this.kind, turnsDone)));
      }
      // Whatever is left at the end of the drain goes with the victim.
      if (this.stage === 'drain' || this.stage === 'commit') v.setFade(1 - smooth(this.stageTime / DRAIN_SECONDS));
    } else {
      const fade = this.stage === 'fade' || this.stage === 'commit' ? smooth(this.stageTime / MERGE_FADE_SECONDS) : 0;
      v.setGasFade(gasFade(releasedShare(this.kind, turnsDone)) * (1 - fade));
      w.setGasFade((1 - 0.6 * smooth(p.progress)) * (1 - fade));
      w.setFade(1 - fade);
      v.setFade(1 - fade);
      if (this.preview) {
        const r = this.preview;
        r.setFade(fade);
        r.setGasFade(fade);
        r.setStarburst(fade);
        r.timeScale = this.lapseNow;
        // The remnant is the winner rebuilt: keep its rotation in step.
        r.phase = w.phase;
        r.uniforms.uPhase.value = w.phase;
        r.setEmphasis(w.emphasisTarget, true);
      }
    }
    for (const sim of this.sims) sim.galaxy?.updateStarSimulation(sim.gpu.getCurrentRenderTarget(sim.pos).texture);
  }

  /** Field uniforms for one substep of h (star) seconds. */
  setField(h) {
    const f = this.field;
    const p = this.pose;
    const draining = this.stage === 'drain';
    const gmVictim = this.kind === KIND.HOLE_HOLE ? this.gmVictim0 * victimHoleScale(p.turnsDone, this.path.turns) : this.gmVictim0;
    f.uDt.value = h;
    f.uCentre1.value.fromArray(p.pos);
    f.uGm.value.set(this.gmWinner, gmVictim);
    indirectAccel(_indirect, this.path.winnerPos, p.pos, gmVictim, this.eps2Victim);
    f.uIndirect.value.fromArray(_indirect);
    if (this.holeWinner) {
      const w = this.winner;
      f.uDrag.value = freeDrag(p, this.path.seconds);
      f.uCapture.value = captureRadius(w.rsUnit * w.radius * w.holeScale);
      // Draining: everything left falls in.
      f.uAccRadius.value = draining ? NO_RELEASE : this.accRadius;
      f.uTimeLeft.value = draining ? Math.max(0, DRAIN_SECONDS - this.stageTime) : p.timeLeft + DRAIN_SECONDS;
    }
    for (const sim of this.sims) {
      const u = sim.uniforms;
      if (!u) continue;
      const g = sim.galaxy;
      g.group.updateMatrixWorld();
      u.uMatrix.value.copy(g.group.matrixWorld);
      u.uCentre.value.copy(g.group.position);
      // Star velocities are in star time (the merger's time-lapse).
      if (g === this.victim) u.uCentreVel.value.fromArray(p.vel).divideScalar(this.lapseNow);
      u.uRelease.value = p.stage === 'approach' ? NO_RELEASE : releaseRadius(this.kind, p.turnsDone);
    }
    if (this.stream) {
      const s = this.stream.uniforms;
      s.uProgress.value = p.stage === 'approach' ? -1 : (1 - victimHoleScale(p.turnsDone, this.path.turns)) / STREAM_BIRTHS_END;
      s.uSpawnRadius.value = this.victim.hole.discSize * this.victim.rsUnit * this.victim.radius * Math.max(this.victim.holeScale, 0.05);
      s.uVictimGm.value = Math.max(gmVictim, this.gmVictim0 * 0.05);
      s.uVictimVel.value.fromArray(p.vel);
    }
  }

  /** A body's GPU star simulation; every star starts BOUND (zero textures). */
  createGalaxySim(g) {
    const count = Math.min(g.count, g.quality?.starCap ?? g.count);
    const { width, height } = simTextureSize(count);
    const gpu = new GPUComputationRenderer(width, height, this.renderer);
    const vel = gpu.addVariable('textureVelocity', STEP_GALAXY, gpu.createTexture());
    const pos = gpu.addVariable('texturePosition', `#define WRITE_POSITION\n${STEP_GALAXY}`, gpu.createTexture());
    gpu.setVariableDependencies(vel, [pos, vel]);
    gpu.setVariableDependencies(pos, [pos, vel]);
    const geo = g.stars.geometry;
    const orbit = dataTexture(padded(geo.getAttribute('aOrbit').array, count, 4, width * height), width, height);
    const offset = dataTexture(padded(geo.getAttribute('position').array, count, 3, width * height), width, height);
    g.group.updateMatrixWorld();
    const uniforms = {
      uOrbit: { value: orbit },
      uOffset: { value: offset },
      uMatrix: { value: g.group.matrixWorld.clone() },
      uCentre: { value: g.group.position.clone() },
      uCentreVel: { value: new THREE.Vector3() },
      uSpin: { value: new THREE.Vector3().fromArray(spinAxis(normalOf(g), g.speed)) },
      uGmSelf: { value: g === this.winner ? this.gmWinner : this.gmVictim0 },
      uEps2Self: { value: g === this.winner ? this.eps2Winner : this.eps2Victim },
      uRelease: { value: NO_RELEASE },
    };
    // gs_position reads the galaxy's motion and structure uniforms (by reference).
    for (const variable of [pos, vel]) Object.assign(variable.material.uniforms, g.uniforms, this.field, uniforms);
    const error = gpu.init();
    if (error) throw new Error(error);
    g.setStarSimulation(gpu.getCurrentRenderTarget(pos).texture, count);
    const sim = { gpu, pos, vel, galaxy: g, uniforms, textures: [orbit, offset] };
    this.sims.push(sim);
    return sim;
  }

  /**
   * Galaxy merger, at the orbit entry: hand the winner's stars, as they are
   * now, to the GPU (one pass, collisionInit.glsl; no CPU loop), so its disc
   * answers the victim's pull with tidal arms. The victim's come free later,
   * from the outside in (releaseRadius).
   */
  startMergerStars() {
    const g = this.winner;
    const sim = this.createGalaxySim(g);
    for (const [variable, define] of [[sim.pos, '#define WRITE_POSITION\n'], [sim.vel, '']]) {
      const material = sim.gpu.createShaderMaterial(define + INIT_SHADER, { ...g.uniforms, ...sim.uniforms });
      sim.gpu.doRenderTarget(material, sim.gpu.getCurrentRenderTarget(variable));
      material.dispose();
    }
    this.winnerSim = sim;
  }

  /** The gold stream off a victim black hole: its own small simulation and two point layers. */
  createStream(count) {
    const { width, height } = simTextureSize(count);
    const texels = width * height;
    const rng = createRandom(0x5eed);
    const seed = new Float32Array(texels * 4);
    for (let i = 0; i < texels; i++) {
      const i4 = i * 4;
      // Births spread evenly over the mass loss (texels past count: never).
      seed[i4] = i < count ? (i + rng.next()) / count : 2;
      seed[i4 + 1] = rng.next() < STREAM_L1 ? 1 : -1;
      seed[i4 + 2] = rng.range(-0.3, 0.3);
      seed[i4 + 3] = rng.next();
    }
    const seedTexture = dataTexture(seed, width, height);
    const gpu = new GPUComputationRenderer(width, height, this.renderer);
    const vel = gpu.addVariable('textureVelocity', STEP_STREAM, gpu.createTexture());
    const pos = gpu.addVariable('texturePosition', `#define WRITE_POSITION\n${STEP_STREAM}`, gpu.createTexture());
    gpu.setVariableDependencies(vel, [pos, vel]);
    gpu.setVariableDependencies(pos, [pos, vel]);
    const uniforms = {
      uSeed: { value: seedTexture },
      uProgress: { value: -1 },
      uVictimNormal: { value: new THREE.Vector3().fromArray(this.victimNormal) },
      uSpawnRadius: { value: 1 },
      uVictimGm: { value: this.gmVictim0 },
      uVictimVel: { value: new THREE.Vector3() },
    };
    for (const variable of [pos, vel]) Object.assign(variable.material.uniforms, this.field, uniforms);
    const error = gpu.init();
    if (error) throw new Error(error);
    this.sims.push({ gpu, pos, vel, galaxy: null, uniforms: null, textures: [seedTexture], stream: true });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, count * 4), 4));
    const v = this.victim;
    const drawUniforms = {
      uStreamPos: { value: gpu.getCurrentRenderTarget(pos).texture },
      uHot: { value: v.holeHot.clone() },
      uCool: { value: v.holeCool.clone() },
      uGain: { value: STREAM_GAIN },
      uPixelRatio: v.uniforms.uPixelRatio,
      uMaxPointPx: v.uniforms.uMaxPointPx,
      uHoleWorld: { value: new THREE.Vector4() },
      uSplit: { value: new THREE.Vector4() },
    };
    const make = (afterLens) => {
      const points = new THREE.Points(geometry, createStreamMaterial(drawUniforms, { afterLens }));
      points.frustumCulled = false;
      points.renderOrder = afterLens ? 5 : 2;
      if (afterLens) points.layers.set(LAYERS.JETS);
      v.group.parent?.add(points);
      return points;
    };
    return { gpu, pos, uniforms, drawUniforms, geometry, main: make(false), after: make(true) };
  }

  updateStream(view) {
    const s = this.stream;
    if (!s) return;
    const d = s.drawUniforms;
    d.uStreamPos.value = s.gpu.getCurrentRenderTarget(s.pos).texture;
    const c = view.center;
    d.uHoleWorld.value.set(c[0], c[1], c[2], view.capture);
    d.uSplit.value.set(c[0], c[1], c[2], view.reach);
    d.uHot.value.copy(this.victim.holeHot);
    d.uCool.value.copy(this.victim.holeCool);
    d.uGain.value = STREAM_GAIN * this.victim.hole.brightness * this.victim.emphasis;
    s.after.visible = true;
  }

  startFade() {
    const r = this.createPreview?.(this.remnant);
    if (!r) {
      // No preview (tests): the commit just swaps at the end of the fade.
      this.preview = { setFade() {}, setGasFade() {}, setStarburst() {}, setEmphasis() {}, uniforms: { uPhase: { value: 0 } }, group: this.winner.group };
      return;
    }
    r.group.position.fromArray(this.path.winnerPos);
    r.setFade(0);
    r.setGasFade(0);
    this.preview = r;
  }

  freeSimulation() {
    for (const sim of this.sims) {
      sim.gpu.dispose();
      for (const t of sim.textures ?? []) t.dispose();
    }
    this.sims = [];
    if (this.stream) {
      for (const points of [this.stream.main, this.stream.after]) {
        points.removeFromParent();
        points.material.dispose();
      }
      this.stream.geometry.dispose();
      this.stream = null;
    }
  }

  /** Stop at any point: before the commit, both objects go back to their start. */
  dispose() {
    const before = this.stage !== 'after' && this.stage !== 'done';
    this.freeSimulation();
    if (this.preview?.dispose) this.removePreview?.(this.preview);
    this.preview = null;
    if (before) {
      clearGalaxyCache();
      for (const g of [this.winner, this.victim]) {
        g.endCollision();
        g.clearConsumeEffects();
      }
    } else {
      this.winner.clearConsumeEffects();
    }
    this.stage = 'done';
  }
}

const _ripple = { radius: 0, amp: 0 };

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function dataTexture(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

/** The first `count` items of `itemSize` floats, as RGBA texels padded to `texels`. */
function padded(source, count, itemSize, texels) {
  const data = new Float32Array(texels * 4);
  if (itemSize === 4) {
    data.set(source.subarray(0, count * 4));
    return data;
  }
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < itemSize; k++) data[i * 4 + k] = source[i * itemSize + k];
  }
  return data;
}
