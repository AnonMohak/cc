/**
 * Camera poses solved from the reference stills: the shadow's size on screen
 * gives the camera's distance from the hole, and the shadow's centre gives
 * where the camera aims. Units: Rs, the hole at the origin (introTimeline.js).
 * Pure.
 */

import { kerrShadow } from './gargantuaModel.js';

const DEG = Math.PI / 180;
const SHADOW = kerrShadow();
/**
 * The shadow's radius as an impact parameter (Rs): its half-height for the
 * spinning hole (2.525; its half-width is 2.539; 3√3 / 2 without spin).
 */
export const B_CRIT = SHADOW.polar;
/**
 * The shadow's centre sits this far (Rs) from the hole toward the side where
 * the disc comes at the camera (retrograde light passes farther out): the D.
 */
export const SHADOW_SHIFT = (SHADOW.retrograde - SHADOW.prograde) / 2;

/** The camera's view factor: sin α = b √(1 − 1/r) / r (a static observer). */
const viewFactor = (r) => Math.sqrt(Math.max(1 - 1 / r, 0)) / r;

/**
 * Angular radius (radians) of the shadow as the intro renders it from r (Rs):
 * sin α = b_c √(1 − 1/r) / r, a static observer's view (the march sets the
 * ray's radial speed from its direction, gargantuaModel.js bendRay). It fills
 * the view near the photon sphere.
 * @param {number} r
 */
export function shadowAngle(r) {
  return Math.asin(Math.min(1, B_CRIT * viewFactor(r)));
}

/**
 * The camera distance (Rs) at which the shadow has angular radius α
 * (radians, 0–90°): the inverse of shadowAngle.
 * @param {number} alpha
 */
export function distanceForShadow(alpha) {
  // sin α falls from its peak (near 1.5 Rs) outward: bisection out there.
  const target = Math.sin(Math.min(Math.max(alpha, 1e-6), Math.PI / 2));
  let lo = 1.5;
  let hi = 1e7;
  for (let i = 0; i < 200; i++) {
    const r = Math.sqrt(lo * hi);
    if (Math.min(1, B_CRIT * viewFactor(r)) > target) lo = r;
    else hi = r;
  }
  return Math.sqrt(lo * hi);
}

/**
 * The camera position and aim point of a pose (the same rules as
 * introTimeline.js keyPosition / keyTarget).
 */
export function poseVectors({ r, el, az, lead, aimY }) {
  const ring = r * Math.cos(el * DEG);
  const a = az * DEG;
  const l = lead * DEG;
  const position = [ring * Math.cos(a), r * Math.sin(el * DEG), ring * Math.sin(a)];
  const dx = -Math.cos(l) * Math.cos(a) - Math.sin(l) * Math.sin(a);
  const dz = -Math.cos(l) * Math.sin(a) + Math.sin(l) * Math.cos(a);
  const target = [position[0] + dx * ring, aimY, position[2] + dz * ring];
  return { position, target };
}

/**
 * The centre of the shadow (a world point, Rs) seen from a pose: the hole
 * moved SHADOW_SHIFT across the view, to the side where the disc's gas comes
 * toward the camera, less as the view tilts toward the spin axis.
 */
export function shadowCentre(pose) {
  const { position } = poseVectors(pose);
  const r = Math.hypot(...position);
  const f = position.map((x) => -x / r);
  // Horizontal, across the view: light passing on this side has L < 0. As
  // an angle it is SHADOW_SHIFT × the view factor; as a point near the hole,
  // × r times that.
  const k = SHADOW_SHIFT * Math.sqrt(Math.max(1 - 1 / r, 0));
  return [-f[2] * k, 0, f[0] * k];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where a world point (the hole's centre by default) lands on screen (u, v
 * from the top-left, 0–1) for a pose with no roll.
 * @param {{ r: number, el: number, az: number, lead: number, aimY: number }} pose
 * @param {number} fov vertical (deg)
 * @param {number} aspect width / height
 */
export function holeOnScreen(pose, fov, aspect, point = [0, 0, 0]) {
  const { position, target } = poseVectors(pose);
  const f = norm(sub(target, position));
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const h = sub(point, position);
  const z = dot(h, f);
  const tanY = Math.tan((fov / 2) * DEG);
  const x = dot(h, right) / z / (tanY * aspect);
  const y = dot(h, up) / z / tanY;
  return [0.5 + x / 2, 0.5 - y / 2];
}

/**
 * Solve a reference shot: the distance from the shadow's radius on screen
 * (a share of the frame height), then the lead and aim height that put the
 * hole's centre where the still has it.
 * @param {{ radius: number, center: number[], fov: number, el: number, az: number }} shot
 * @param {number} aspect the still's width / height
 * @returns {{ r: number, lead: number, aimY: number }}
 */
export function solveShot({ radius, center, fov, el, az }, aspect) {
  // The radius on screen is tan α / tan(fov / 2) of the half height.
  const alpha = Math.atan(2 * radius * Math.tan((fov / 2) * DEG));
  const r = distanceForShadow(alpha);
  const pose = { r, el, az, lead: 0, aimY: 0 };
  // The still's centre is the shadow's, not the hole's.
  const centre = shadowCentre(pose);
  // Lead moves the hole across the screen, aimY up and down: alternate
  // one-dimensional bisections until both settle.
  for (let pass = 0; pass < 6; pass++) {
    let lo = -89;
    let hi = 89;
    for (let i = 0; i < 60; i++) {
      pose.lead = (lo + hi) / 2;
      // A positive lead turns the view toward the motion: the hole moves right.
      if (holeOnScreen(pose, fov, aspect, centre)[0] < center[0]) lo = pose.lead;
      else hi = pose.lead;
    }
    // Pitch within ±60° of level (wider, the left-right search breaks down).
    const camY = r * Math.sin(el * DEG);
    const ring = r * Math.cos(el * DEG);
    lo = camY - ring * Math.tan(60 * DEG);
    hi = camY + ring * Math.tan(60 * DEG);
    for (let i = 0; i < 80; i++) {
      pose.aimY = (lo + hi) / 2;
      // Aiming higher moves the hole down the screen (v grows).
      if (holeOnScreen(pose, fov, aspect, centre)[1] < center[1]) lo = pose.aimY;
      else hi = pose.aimY;
    }
  }
  return { r, lead: pose.lead, aimY: pose.aimY };
}
