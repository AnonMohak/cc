/**
 * Render layers. The galaxy scene pass draws them in separate steps:
 * background stars → volumes (low resolution) → stars and nebulae. Jets are
 * drawn later, by JetPass, after the black-hole pass.
 */
export const LAYERS = {
  /** Galaxy stars and H II regions (three's default layer). */
  STARS: 0,
  /** Raymarched galaxy bodies, rendered at reduced resolution. */
  VOLUME: 1,
  /** Far background starfield. */
  BACKGROUND: 2,
  /** Black-hole jets (core/JetPass.js), drawn after the black-hole pass. */
  JETS: 3,
  /** Depth-of-field proxies (galaxy/dofProxy.js), drawn only by DepthOfFieldPass. */
  DOF: 4,
};
