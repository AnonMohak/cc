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
import {
  G_SIM,
  spinAxis,
  starSubsteps,
  simTextureSize,
  indirectAccel,
  gasFade,
  bodyPhysics,
  designOrbit,
  createCentres,
  stepCentres,
  separation,
  warpFactor,
} from '../galaxy/collision.js';
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
  mergeRadius,
  createPassWatch,
  watchPass,
  designSpiral,
  spiralPose,
  createPose,
  blendFactor,
  victimPull,
  eatenShare,
  victimHoleScale,
  winnerGrowth,
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
// A release radius above every orbit: nothing comes free (every simulated
// star starts FREE at contact; BOUND is only the empty texture before it).
const NO_RELEASE = 1e9;
// Disc brightness at full feeding flare (× 1 + this).
const DISC_FEED_GAIN = 1.5;
// Gold stream: brightness, and its births spread over this share of the mass loss.
const STREAM_GAIN = 2.5;
const STREAM_BIRTHS_END = 0.92;
// Share of stream matter born at L1 (toward the winner); the rest at L2.
const STREAM_L1 = 0.7;
// The opening pass counts as a head-on merge closer than this × the mean radius.
const HEAD_ON = 0.05;

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _indirect = [0, 0, 0];
const _winnerAcc = [0, 0, 0];
const _winnerVel = [0, 0, 0];
const _ripple = { radius: 0, amp: 0 };

/**
 * Whether this GPU can render to float textures (the star simulation needs
 * RGBA32F targets; half floats are too coarse for world positions).
 * @param {THREE.WebGLRenderer} renderer
 */
export function collisionSupported(renderer) {
  return renderer.capabilities.maxVertexTextures > 0 && renderer.extensions.has('EXT_color_buffer_float');
}

/** A Galaxy as a consumption body (consumption.js Body, plus its disc radius). */
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
 * One running collision (galaxy/consumption.js has the timeline,
 * galaxy/collision.js the physics). Stars are test particles on the GPU
 * (two RGBA32F ping-pong textures per body: position + state, velocity).
 *
 * 1. Opening pass (stage 'pass'): free physics, as a real encounter. Both
 *    centres move (zero total momentum); far apart they fast-forward and
 *    the stars stay analytic; at contact the stars come into the
 *    simulation and react with tails and bridges.
 * 2. Handover ('spiral'), after the first close pass: the winner comes to
 *    rest and the victim's path blends from the physics path into the
 *    scripted spiral (exact turns, slow). The victim loses its own pull as
 *    it is eaten, so its stars come free and are stripped.
 *    - Black hole eats a galaxy: free matter gets a drag toward the hole,
 *      accretes and is gone; the gas fades.
 *    - Black hole eats a black hole: the victim shrinks every turn and its
 *      disc matter leaves in a gold stream (its own small simulation).
 *    - Galaxy merges into a galaxy: at the end a preview of the remnant
 *      fades in over the simulated stars.
 * 3. update() returns { type: 'commit', … } once: the caller puts the result
 *    in the store (with the winner where it came to rest), then calls
 *    committed(); the after-effects (flare, flash, ripple, starburst) run
 *    until isDone(). dispose() stops at any point (before the commit, both
 *    objects go back to their start).
 */
export class CollisionSim {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, starter: import('../galaxy/Galaxy.js').Galaxy, partner: import('../galaxy/Galaxy.js').Galaxy,
   *   plan: (winnerId: string, victimId: string) => { patch: object, remnant: object },
   *   createPreview?: (entry: object) => import('../galaxy/Galaxy.js').Galaxy, removePreview?: (g: object) => void,
   *   streamCount?: number, pass?: number, speed?: number }} options
   *   plan: the store patch for the winner and its entry after the commit
   *   pass, speed: the opening pass (collision.js COLLISION_LIMITS)
   */
  constructor({ renderer, starter, partner, plan, createPreview, removePreview, streamCount = 12000, pass, speed }) {
    this.renderer = renderer;
    this.createPreview = createPreview;
    this.removePreview = removePreview;
    this.streamCount = streamCount;
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
    this.wb = bodyOf(w);
    this.vb = bodyOf(v);
    const wp = bodyPhysics(this.wb);
    const vp = bodyPhysics(this.vb);
    this.normal = normalOf(w);
    this.victimNormal = normalOf(v);
    this.turns = turnsFor(this.kind, v.radius);
    this.seconds = INSPIRAL_SECONDS[this.kind];

    // The opening pass: the old free collision (centres 0 = winner, 1 = victim).
    const posA = w.group.position.toArray();
    const posB = v.group.position.toArray();
    const orbit = designOrbit({ posA, posB, a: wp, b: vp, spinA: spinAxis(this.normal, w.speed), pass, speed });
    this.centres = createCentres({ posA, posB, velA: orbit.velA, velB: orbit.velB, a: wp, b: vp, friction: false });
    this.watch = createPassWatch();
    this.startDistance = separation(this.centres);
    this.gmWinner = G_SIM * wp.mass;
    this.gmVictim0 = G_SIM * vp.mass;
    this.eps2Winner = wp.eps2;
    this.eps2Victim = vp.eps2;
    this.accRadius = this.holeWinner ? ACC_RADIUS * this.wb.discOuter : 0;

    this.spiral = null;
    this.pose = createPose();
    this.spiralTime = 0;
    this.lapseNow = 1;
    /** 'pass' → 'spiral' → ('drain' | 'fade') → 'commit' → 'after' → 'done' */
    this.stage = 'pass';
    this.stageTime = 0;
    this.afterTime = 0;
    this.winnerPos = [...posA];
    this.victimPos = [...posB];
    this.victimVel = [...orbit.velB];

    this.field = {
      uDt: { value: 0 },
      uCentre0: { value: new THREE.Vector3().fromArray(posA) },
      uCentre1: { value: new THREE.Vector3().fromArray(posB) },
      uGm: { value: new THREE.Vector2(this.gmWinner, this.gmVictim0) },
      uEps2: { value: new THREE.Vector2(this.eps2Winner, this.eps2Victim) },
      uIndirect: { value: new THREE.Vector3() },
      uWinnerVel: { value: new THREE.Vector3() },
      uDrag: { value: 0 },
      uHole: { value: this.holeWinner ? 1 : 0 },
      uHoleNormal: { value: new THREE.Vector3().fromArray(this.normal) },
      uAccRadius: { value: this.accRadius },
      uCapture: { value: 0 },
      uAccRate: { value: ACC_RATE },
      uSpinMax: { value: ACC_SPIN_MAX },
      uSettle: { value: ACC_SETTLE },
      uTimeLeft: { value: 1e3 },
    };

    /** @type {{ gpu: GPUComputationRenderer, pos: object, vel: object, galaxy: object | null, uniforms: object | null, textures: THREE.Texture[] }[]} */
    this.sims = [];
    this.stream = null;
    this.preview = null;
    this.remnantReady = false;
    if (!this.holeWinner) {
      // Built in a worker while the galaxies meet (no stall at the end).
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
    return this.preview?.group ? [this.winner, this.victim, this.preview] : [this.winner, this.victim];
  }

  /** The camera target: the barycentre in the opening pass, then the winner. */
  centre(out = new THREE.Vector3()) {
    if (this.stage !== 'pass') return out.fromArray(this.winnerPos);
    const s = this.centres;
    const M = s.mass[0] + s.mass[1];
    return out.set(
      (s.mass[0] * s.pos[0][0] + s.mass[1] * s.pos[1][0]) / M,
      (s.mass[0] * s.pos[0][1] + s.mass[1] * s.pos[1][1]) / M,
      (s.mass[0] * s.pos[0][2] + s.mass[1] * s.pos[1][2]) / M,
    );
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
   * spiral (0 in the opening pass), the distance between the centres, the
   * orbit frequency (Hz) and the seconds since the merge.
   */
  status(out = {}) {
    const p = this.pose;
    const spiral = this.spiral !== null;
    out.stage = this.stage;
    out.kind = this.kind;
    out.progress = this.stage === 'after' || this.stage === 'done' ? 1 : spiral ? p.progress : 0;
    out.distance = Math.hypot(this.victimPos[0] - this.winnerPos[0], this.victimPos[1] - this.winnerPos[1], this.victimPos[2] - this.winnerPos[2]);
    out.startDistance = this.startDistance;
    out.handoverDistance = spiral ? this.spiral.r0 : out.distance;
    out.inContact = this.centres.interacting;
    out.orbitHz = spiral && p.radius > 0 ? Math.hypot(p.vel[0] - p.winnerVel[0], p.vel[1] - p.winnerVel[1], p.vel[2] - p.winnerVel[2]) / (2 * Math.PI * p.radius) : 0;
    out.afterTime = this.afterTime;
    out.merged = spiral && p.stage === 'merged';
    out.turnsDone = spiral ? p.turnsDone : 0;
    out.winnerRadius = this.wb.radius;
    out.victimRadius = this.vb.radius;
    out.winnerHole = this.wb.hole;
    out.winnerDisc = this.wb.discOuter * (this.winner.holeScale || 1);
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
      if (this.stage === 'pass' && !this.centres.interacting) {
        // Far apart: the centres fast-forward, the stars stay analytic.
        stepCentres(this.centres, dt * warpFactor(this.centres));
        this.readCentres();
        if (this.centres.interacting) this.startStars();
      } else {
        this.stepInteracting(dt);
      }
      if (this.stage === 'spiral' && this.pose.stage === 'merged') this.stage = this.holeWinner ? 'drain' : 'fade';
      if (this.stage === 'drain' || this.stage === 'fade') {
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
          return { type: 'commit', winnerId: this.winner.id, victimId: this.victim.id, patch: this.commitPatch() };
        }
      }
    }
    this.applyLooks();
    return null;
  }

  /** The store patch: the growth, and the winner where it came to rest. */
  commitPatch() {
    const position = this.winnerPos.map((x) => Math.round(x * 100) / 100);
    return { ...this.patch, look: { ...(this.patch.look ?? {}), position } };
  }

  /** In contact: substeps of the star simulation with the centres in step. */
  stepInteracting(dt) {
    const dtStar = dt * this.lapseNow;
    const n = this.sims.length > 0 ? Math.max(1, starSubsteps(dtStar)) : 1;
    for (let i = 0; i < n; i++) {
      const hPath = dt / n;
      const hStar = dtStar / n;
      if (this.stage === 'pass') {
        stepCentres(this.centres, hStar);
        this.readCentres();
        const merged = HEAD_ON * 0.5 * (this.wb.radius + this.vb.radius);
        if (watchPass(this.watch, separation(this.centres), hStar, merged)) this.handover();
      } else {
        this.spiralTime += hPath;
        // The physics path keeps going during the blend, to blend from.
        const b = blendFactor(this.spiralTime);
        if (b < 1) stepCentres(this.centres, hStar);
        spiralPose(this.spiral, this.spiralTime, this.pose);
        this.blendPaths(b);
        this.lapseNow = 1 + (this.spiral.lapse - 1) * b;
      }
      this.winner.group.position.fromArray(this.winnerPos);
      this.victim.group.position.fromArray(this.victimPos);
      if (this.sims.length > 0) {
        this.setField(hStar);
        for (const sim of this.sims) sim.gpu.compute();
      }
    }
  }

  readCentres() {
    const s = this.centres;
    for (let k = 0; k < 3; k++) {
      this.winnerPos[k] = s.pos[0][k];
      this.victimPos[k] = s.pos[1][k];
      this.victimVel[k] = s.vel[1][k];
      _winnerVel[k] = s.vel[0][k];
      _winnerAcc[k] = 0;
    }
    this.winner.group.position.fromArray(this.winnerPos);
    this.victim.group.position.fromArray(this.victimPos);
  }

  /** The first close pass is over: the consumption takes over from here. */
  handover() {
    const s = this.centres;
    const eps2 = this.eps2Winner + this.eps2Victim;
    this.spiral = designSpiral({
      kind: this.kind,
      winnerPos: s.pos[0],
      winnerVel: s.vel[0],
      victimPos: s.pos[1],
      victimVel: s.vel[1],
      spin: spinAxis(this.normal, this.winner.speed),
      gm: this.gmWinner + this.gmVictim0,
      eps2,
      rEnd: mergeRadius(this.wb),
      turns: this.turns,
      seconds: this.seconds,
    });
    this.spiralTime = 0;
    spiralPose(this.spiral, 0, this.pose);
    this.stage = 'spiral';
    if (this.kind === KIND.HOLE_HOLE) this.stream = this.createStream(this.streamCount);
  }

  /**
   * The victim at blend b: the physics path (relative to the physics
   * winner) → the spiral, both around the settling winner. Velocities in
   * path time.
   */
  blendPaths(b) {
    const p = this.pose;
    const s = this.centres;
    for (let k = 0; k < 3; k++) {
      this.winnerPos[k] = p.winnerPos[k];
      const relPhys = s.pos[1][k] - s.pos[0][k];
      const relSpiral = p.pos[k] - p.winnerPos[k];
      this.victimPos[k] = p.winnerPos[k] + relPhys + (relSpiral - relPhys) * b;
      const velPhys = (s.vel[1][k] - s.vel[0][k]) * this.lapseNow;
      const velSpiral = p.vel[k] - p.winnerVel[k];
      this.victimVel[k] = p.winnerVel[k] + velPhys + (velSpiral - velPhys) * b;
      _winnerVel[k] = p.winnerVel[k];
      _winnerAcc[k] = p.winnerAcc[k];
    }
  }

  /** Contact: hand the stars, as they are now, to the GPU (one pass each, collisionInit.glsl). */
  startStars() {
    // A winning hole's own star cloud stays analytic (it moves with the hole).
    const bodies = this.holeWinner ? [this.victim] : [this.winner, this.victim];
    for (const g of bodies) {
      const sim = this.createGalaxySim(g);
      const u = sim.uniforms;
      const b = g === this.winner ? 0 : 1;
      u.uCentreVel.value.fromArray(this.centres.vel[b]);
      for (const [variable, define] of [[sim.pos, '#define WRITE_POSITION\n'], [sim.vel, '']]) {
        const material = sim.gpu.createShaderMaterial(define + INIT_SHADER, { ...g.uniforms, ...u });
        sim.gpu.doRenderTarget(material, sim.gpu.getCurrentRenderTarget(variable));
        material.dispose();
      }
    }
  }

  /** The result is in the store (the victim is gone): only the winner's after-effects remain. */
  committed() {
    this.freeSimulation();
    if (this.preview?.group) this.removePreview?.(this.preview);
    this.preview = null;
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
      const feed = feedLevel(this.kind, this.turns, this.turns, t);
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

  /** The current looks, the lens split and the textures. */
  applyLooks() {
    const w = this.winner;
    const v = this.victim;
    const turnsDone = this.spiral ? this.pose.turnsDone : 0;
    const progress = this.spiral ? this.pose.progress : 0;
    const disruption = this.centres.disruption;
    if (this.holeWinner) {
      const feed = feedLevel(this.kind, turnsDone, this.turns);
      w.setFeeding(feed);
      w.setHoleLook(winnerGrowth(progress), 1 + DISC_FEED_GAIN * feed, 1 + feed);
      const rs = w.rsUnit * w.radius * w.holeScale;
      const view = { center: this.winnerPos, capture: captureRadius(rs), reach: LENS_REACH * rs };
      v.setConsumeView(view);
      if (this.kind === KIND.HOLE_HOLE) {
        v.setHoleLook(victimHoleScale(turnsDone, this.turns), 1, 1);
        this.updateStream(view);
      } else {
        v.setGasFade(gasFade(Math.max(disruption[1], eatenShare(this.kind, turnsDone, this.turns))));
      }
      // Whatever is left at the end of the drain goes with the victim.
      if (this.stage === 'drain' || this.stage === 'commit') v.setFade(1 - smooth(this.stageTime / DRAIN_SECONDS));
    } else {
      const fade = this.stage === 'fade' || this.stage === 'commit' ? smooth(this.stageTime / MERGE_FADE_SECONDS) : 0;
      v.setGasFade(gasFade(Math.max(disruption[1], eatenShare(this.kind, turnsDone, this.turns))) * (1 - fade));
      // The winner keeps at least half its glow: it is the galaxy that stays.
      w.setGasFade((0.5 + 0.5 * gasFade(disruption[0])) * (1 - 0.4 * smooth(progress)) * (1 - fade));
      w.setFade(1 - fade);
      v.setFade(1 - fade);
      // The merger's time-lapse also turns the galaxies' analytic spin.
      w.timeScale = v.timeScale = this.lapseNow;
      if (this.preview?.group) {
        const r = this.preview;
        r.group.position.fromArray(this.winnerPos);
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

  /**
   * Field uniforms for one substep of h star seconds. In the opening pass
   * the frame is inertial (no indirect term); in the spiral it is the
   * winner's, and path-time rates are turned into star time (÷ the time
   * factor, an acceleration ÷ its square).
   */
  setField(h) {
    const f = this.field;
    const L = this.lapseNow;
    const spiral = this.spiral !== null;
    const p = this.pose;
    const pull = spiral ? victimPull(this.kind, p.turnsDone, this.turns) : 1;
    const gmVictim = this.gmVictim0 * pull;
    f.uDt.value = h;
    f.uCentre0.value.fromArray(this.winnerPos);
    f.uCentre1.value.fromArray(this.victimPos);
    f.uGm.value.set(this.gmWinner, gmVictim);
    if (spiral) {
      for (let k = 0; k < 3; k++) _winnerAcc[k] /= L * L;
      indirectAccel(_indirect, this.winnerPos, this.victimPos, gmVictim, this.eps2Victim, _winnerAcc);
      for (let k = 0; k < 3; k++) _winnerAcc[k] *= L * L;
    } else {
      _indirect[0] = _indirect[1] = _indirect[2] = 0;
    }
    f.uIndirect.value.fromArray(_indirect);
    f.uWinnerVel.value.fromArray(_winnerVel).divideScalar(spiral ? L : 1);
    if (this.holeWinner) {
      const w = this.winner;
      const draining = this.stage === 'drain';
      f.uDrag.value = spiral ? freeDrag(p, this.seconds) / L : 0;
      f.uCapture.value = captureRadius(w.rsUnit * w.radius * w.holeScale);
      // Draining: everything left falls in.
      f.uAccRadius.value = draining ? NO_RELEASE : this.accRadius;
      f.uAccRate.value = ACC_RATE / L;
      f.uSpinMax.value = ACC_SPIN_MAX / L;
      f.uSettle.value = ACC_SETTLE / L;
      const left = draining ? Math.max(0, DRAIN_SECONDS - this.stageTime) : spiral ? p.timeLeft + DRAIN_SECONDS : 1e3;
      f.uTimeLeft.value = left * L;
    }
    for (const sim of this.sims) {
      const u = sim.uniforms;
      if (!u) continue;
      const g = sim.galaxy;
      g.group.updateMatrixWorld();
      u.uMatrix.value.copy(g.group.matrixWorld);
      u.uCentre.value.copy(g.group.position);
    }
    if (this.stream) {
      const s = this.stream.uniforms;
      const v = this.victim;
      s.uProgress.value = (1 - victimHoleScale(p.turnsDone, this.turns)) / STREAM_BIRTHS_END;
      s.uSpawnRadius.value = v.hole.discSize * v.rsUnit * v.radius * Math.max(v.holeScale, 0.05);
      s.uVictimGm.value = Math.max(gmVictim, this.gmVictim0 * 0.05);
      s.uVictimVel.value.fromArray(this.victimVel).divideScalar(L);
    }
  }

  /** A body's GPU star simulation (the textures start empty; startStars fills them). */
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
    this.sims.push({ gpu, pos, vel, galaxy: null, uniforms: null, textures: [seedTexture] });

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
      this.preview = {};
      return;
    }
    r.group.position.fromArray(this.winnerPos);
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
    if (this.preview?.group) this.removePreview?.(this.preview);
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
