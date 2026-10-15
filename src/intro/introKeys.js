/**
 * The intro's camera keys (introTimeline.js reads them), as data: t (s), r
 * (Rs), el (deg above the disc plane), az (deg, the disc turns toward
 * +azimuth), lead (deg the view turns from the hole toward the motion),
 * aimY (Rs: the aim point's height), roll (deg), fov (deg, vertical), exp
 * (exposure), sparse (0–1: inner gas thinned to clumps), haze, sat, ghost.
 *
 * Inside the film shots (introTimeline.js FILM_SCHEDULE) the keys sit at
 * measured clip frames: first poses from the measured shadow circles
 * (shotSolve.js solveShot, filmMeasures.js) with a chosen field of view;
 * scripts/fit-intro.mjs refines them against the clip. Between the shots
 * the keys are set by hand (smooth moves).
 */

const key = (t, r, el, az, lead, aimY, fov, more = {}) => ({ t, r, el, az, lead, aimY, roll: 0, fov, exp: 1, sparse: 0, haze: 0, sat: 1, ghost: 0, ...more });

export const CAMERA_KEYS = [
  // Gap → dome (film shot 'gap-dome', clip frames 0–152, from 0 s): one
  // continuous dolly zoom in the film. The camera starts inside the clear
  // gap (wide lens), moves back across the disc's inner edge and rises over
  // the cloud tops while the lens narrows, so the shadow keeps its size and
  // the near disc's dark clouds spread down over the lower ring.
  key(0, 2.87, 0, 0, -11.77, -0.66, 90, { exp: 0.09, sparse: 1, sat: 0.5 }),
  key(2.002, 2.76, 0, 2.4, -11.96, -0.72, 90, { exp: 0.06, sparse: 1, sat: 0.5 }),
  key(3.003, 2.89, 0.3, 3.6, -12.15, -0.71, 84, { exp: 0.25, sparse: 1, sat: 0.5 }),
  key(3.754, 3.98, 1.5, 4.5, -10.07, -0.68, 60, { exp: 0.5, sparse: 0.8, sat: 0.5 }),
  key(4.254, 5.88, 3.5, 5.1, -7.48, -0.76, 42, { exp: 0.9, sparse: 0.3 }),
  key(5.005, 7.75, 4.5, 6, -6.83, -0.62, 32, { exp: 0.9 }),
  key(6.256, 8.55, 5, 7.5, -6.88, -0.69, 28, { exp: 0.9, sat: 0.4 }),
  // Move: down toward the cloud tops, turning to the glow.
  key(9.7, 7, 4, 22, -20, -0.3, 50),
  // Low over the clouds (film shot 'clouds', from 13 s).
  key(13, 8, 3, 40, -40, 0.3, 60, { exp: 1.2 }),
  key(15.42, 7.8, 3, 44, -40, 0.3, 60, { exp: 1.2 }),
  // Move: turn until the hole is at the left.
  key(18.5, 7.5, 4, 65, -40, -1, 60, { exp: 2 }),
  // Flame wall (film shot 'wall', from 21.6 s).
  key(21.6, 7.16, 4, 90, -37.8, -2.3, 60, { exp: 3.9, sat: 1.9, ghost: 1 }),
  key(26.104, 7.45, 4, 100, -45.9, -1.89, 60, { exp: 2.4, sat: 1.6, ghost: 1 }),
  key(30.609, 6.73, 4, 110, -51.5, -1.24, 60, { exp: 1.65, sat: 1.7, ghost: 1 }),
  // Move along the disc.
  key(34, 7.5, 4, 140, -45, -2, 65, { exp: 1 }),
  // Skim (film shot 'skim', from 37.1 s; the shadow shows from frame 559).
  key(38.101, 7.17, 4, 170, -40.4, -5.4, 70, { exp: 0.74, sat: 0.8 }),
  key(39.603, 6.29, 4, 176, -40.1, -2.85, 70, { exp: 0.74, sat: 0.8 }),
  key(40.854, 5.36, 4, 182, -40.2, -1.56, 70, { exp: 0.74, sat: 0.8 }),
  // Move: turn up into the light.
  key(44.2, 5.2, 5, 190, -25, 1, 65, { exp: 1.2 }),
  // Bright light (film shot 'bright', from 47.4 s).
  key(47.4, 5, 6, 200, -10, 4, 60, { exp: 1.5 }),
  key(50.03, 4.9, 6, 203, -10, 4, 60, { exp: 1.5 }),
  // The hole from farther away (film shot 'hole-far', from 52 s; it fades in
  // over its first 0.8 s).
  key(52.751, 6.7, 8, 200.5, 3, 0.7, 50, { exp: 1.2 }),
  key(56.296, 6.63, 8, 202, 3.3, 0.6, 50, { exp: 1.2 }),
  // The plunge: a fast push-in with a narrowing lens, so the shadow fills
  // the frame before the film's last shot (the spray of bright specks over
  // the black, from 57.4 s), then a slow fall on.
  key(57, 4, 8, 210, 0, 0, 20, { sparse: 1 }),
  key(59.1, 2.5, 8, 222, 0, 0, 18, { sparse: 1 }),
  key(65, 1.2, 8, 236, 0, 0, 16, { sparse: 1 }),
];
