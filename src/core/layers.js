/**
 * Render layers. The galaxy scene pass draws them in separate steps:
 * background stars → volumes (low resolution) → stars and nebulae.
 */
export const LAYERS = {
  /** Galaxy stars and H II regions (three's default layer). */
  STARS: 0,
  /** Raymarched galaxy bodies, rendered at reduced resolution. */
  VOLUME: 1,
  /** Far background starfield. */
  BACKGROUND: 2,
};
