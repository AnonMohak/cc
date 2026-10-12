/**
 * Film-stock colour of black-body light, as the film computed it (James et
 * al. 2015, arXiv:1502.03808): the Planck spectrum through the spectral
 * sensitivity curves of the camera film (Kodak 5245), white-balanced so a
 * 6500 K black body gives equal RGB, then normalised by 0.30R + 0.59G +
 * 0.11B (blue dimmed, red brightened). The exact 5245 curves are not public
 * here, so each layer is a Gaussian at a typical colour-negative peak. Pure.
 */

/** Film layer sensitivities: peak (nm) and width σ (nm), red, green, blue. */
export const FILM_LAYERS = [
  { peak: 645, sigma: 28 },
  { peak: 548, sigma: 30 },
  { peak: 447, sigma: 24 },
];
/** The white point: a black body at this temperature gives equal RGB. */
export const WHITE_K = 6500;
/** Gargantua's disc: one temperature (K). */
export const DISC_K = 4500;

/** Planck spectral radiance at λ (nm) and T (K), arbitrary units. */
export function planck(lambdaNm, kelvin) {
  const l = lambdaNm * 1e-9;
  const c2 = 1.4388e-2; // h c / k (m K)
  return 1 / (l ** 5 * (Math.exp(c2 / (l * kelvin)) - 1));
}

/** Raw film exposure (R, G, B) of a black body: ∫ B(λ, T) S_c(λ) dλ. */
export function filmResponse(kelvin) {
  const out = [0, 0, 0];
  for (let nm = 380; nm <= 780; nm += 2) {
    const b = planck(nm, kelvin);
    FILM_LAYERS.forEach(({ peak, sigma }, c) => {
      out[c] += b * Math.exp(-0.5 * ((nm - peak) / sigma) ** 2);
    });
  }
  return out;
}

/**
 * The colour of a black body at `kelvin` as the film rendered it: white-
 * balanced to WHITE_K, normalised so 0.30R + 0.59G + 0.11B = 1.
 * @returns {number[]} linear RGB
 */
export function filmColour(kelvin) {
  const raw = filmResponse(kelvin);
  const white = filmResponse(WHITE_K);
  const rgb = raw.map((v, c) => v / white[c]);
  const norm = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  return rgb.map((v) => v / norm);
}
