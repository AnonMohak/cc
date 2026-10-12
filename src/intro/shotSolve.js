/**
 * Camera poses solved from the reference stills: the shadow's size on screen
 * gives the camera's distance from the hole, and the shadow's centre gives
 * where the camera aims. Units: Rs, the hole at the origin (introTimeline.js).
 * Pure.
 */

const DEG = Math.PI / 180;
/** Critical impact parameter (Rs): the shadow's edge, 3√3 / 2. */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;

/**
 * Angular radius (radians) of the shadow as the intro renders it from r (Rs):
 * sin α = b_c / r. The ray march sets camera rays in coordinate space, so the
 * impact parameter is r · sin(angle); a static observer's own frame would add
 * a factor √(1 − 1/r). Valid from b_c out (inside it the shadow fills the view).
 * @param {number} r
 */
export function shadowAngle(r) {
  return Math.asin(Math.min(1, B_CRIT / r));
}

/**
 * The camera distance (Rs) at which the shadow has angular radius α
 * (radians, 0–90°): the inverse of shadowAngle.
 * @param {number} alpha
 */
export function distanceForShadow(alpha) {
  return B_CRIT / Math.sin(Math.min(Math.max(alpha, 1e-6), Math.PI / 2));
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

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where the hole's centre lands on screen (u, v from the top-left, 0–1)
 * for a pose with no roll.
 * @param {{ r: number, el: number, az: number, lead: number, aimY: number }} pose
 * @param {number} fov vertical (deg)
 * @param {number} aspect width / height
 */
export function holeOnScreen(pose, fov, aspect) {
  const { position, target } = poseVectors(pose);
  const f = norm(sub(target, position));
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const h = sub([0, 0, 0], position);
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
  // Lead moves the hole across the screen, aimY up and down: alternate
  // one-dimensional bisections until both settle.
  for (let pass = 0; pass < 6; pass++) {
    let lo = -89;
    let hi = 89;
    for (let i = 0; i < 60; i++) {
      pose.lead = (lo + hi) / 2;
      // A positive lead turns the view toward the motion: the hole moves right.
      if (holeOnScreen(pose, fov, aspect)[0] < center[0]) lo = pose.lead;
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
      if (holeOnScreen(pose, fov, aspect)[1] < center[1]) lo = pose.aimY;
      else hi = pose.aimY;
    }
  }
  return { r, lead: pose.lead, aimY: pose.aimY };
}

/**
 * The shadow measured in each reference still (16:9 crop, bars trimmed):
 * radius as a share of the frame height, centre (u, v) from the top-left;
 * shots 7–9 show part of it, so a circle is fitted through its edge. The
 * film's lens is not known: each shot keeps the field of view chosen for it
 * (deg, vertical) and its elevation and azimuth (deg), and the solve gives
 * the distance and aim that reproduce the still's framing. Shots 1–3 take a
 * wide 90° view (they look wide-angle), which puts the camera inside the
 * clear gap near the hole (r < DISC_INNER), not in the gas. Shots 4–5 take a
 * long 28° lens: the camera is then outside the inner edge (~9–10 Rs), just
 * over the cloud tops, with the dense disc in front (the dark surface under
 * the dome). In shots 7–9 the shadow sits above the near disc: the camera
 * is a little below the disc plane (el < 0), the cloud arc overhead is the
 * disc's underside.
 */
export const STILL_ASPECT = 1261 / 710;
export const SHOT_MEASURES = {
  1: { radius: 0.49, center: [0.45, 0.41], fov: 90, el: 0, az: 0 },
  2: { radius: 0.56, center: [0.5, 0.33], fov: 90, el: 0, az: 4 },
  3: { radius: 0.49, center: [0.5, 0.46], fov: 90, el: 0, az: 8 },
  4: { radius: 0.55, center: [0.51, 0.4], fov: 28, el: 4.7, az: 14 },
  5: { radius: 0.6, center: [0.5, 0.4], fov: 28, el: 5, az: 19 },
  7: { radius: 0.36, center: [0.0, 0.25], fov: 58, el: -6, az: 90 },
  8: { radius: 0.43, center: [-0.036, 0.21], fov: 59, el: -6, az: 115 },
  9: { radius: 0.4, center: [-0.049, 0.22], fov: 60, el: -6, az: 140 },
};

/** The solved pose of a measured shot (r, lead, aimY plus its own el, az, fov). */
export function shotPose(n) {
  const m = SHOT_MEASURES[n];
  return { ...solveShot(m, STILL_ASPECT), el: m.el, az: m.az, fov: m.fov };
}
