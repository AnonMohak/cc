/**
 * Multi-wavelength view modes. PURE data: each band is a set of gains and
 * colour matrices that the star, H II, supernova and volume shaders read as
 * uniforms (Galaxy.setBand), so a mode switch is a uniform write, never a
 * rebuild and never a branch in the volume loop.
 *
 * What each band shows (simplified, false colour like the real images):
 * - visible: the normal render (identity everywhere).
 * - hubble: the narrow-band "SHO" palette: Hα → gold, [O III] → teal.
 * - infrared (JWST): dust is nearly transparent (τ_IR ≈ 0.1 τ_V) and glows
 *   where young stars heat it; old stars stay as a dim warm haze.
 * - radio (21 cm HI): stars are invisible; cold neutral gas glows along the
 *   arms with a central hole, as in real HI maps.
 * - xray (Chandra): only compact sources (X-ray binaries, ~1% of stars), the
 *   hot gas around the bulge and supernova remnants.
 */

/** Values allowed in settings.band, in cycle order (V key). */
export const BAND_OPTIONS = ['visible', 'hubble', 'infrared', 'radio', 'xray'];

const LUMA = [0.2126, 0.7152, 0.0722];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Row-major 3×3 matrix: replace a colour by its luminance × `tint`. */
export function lumaTint([r, g, b]) {
  return [r, g, b].flatMap((t) => LUMA.map((w) => t * w));
}

// Mild gold/teal grade of the continuum: warm light → gold, blue → teal.
const SHO_GRADE = [1.25, 0.0, -0.25, 0.5, 0.5, 0.0, -0.6, 0.7, 0.9];

/**
 * Per band (all linear RGB):
 * - starGain / starKeep: star brightness and the fraction of stars drawn.
 * - starColor: matrix on the star colour (row-major).
 * - dustPass: multiplier on dust optical depth (stars, H II, volume).
 * - hiiGain / hiiColor / hiiCore: H II nebula brightness and colours.
 * - discGain / bulgeGain: smooth starlight of the disc and the bulge.
 * - discFalloff: > 0 makes disc light fall off as exp(−R / discFalloff).
 * - lightColor: matrix on the smooth starlight (applied after the march).
 * - gasColor: colour × gain of light emitted by the dust/gas itself.
 * - gasHole: radius (unit disc) of the central gas hole, 0 = none.
 * - agnGain / jetGain: accretion disc (BlackHolePass) and jet brightness:
 *   jets shine in radio (synchrotron), discs in X-ray.
 * - agnHot / agnCool: accretion-disc colour at the inner (hot) and outer edge.
 * - snGain: supernova flash brightness.
 * - skyTint / fieldGain: Milky Way background tint and field-star gain.
 */
export const BANDS = {
  visible: {
    label: 'Visible light',
    starGain: 1,
    starKeep: 1,
    starColor: IDENTITY,
    dustPass: 1,
    hiiGain: 1,
    hiiColor: [1.0, 0.16, 0.32], // Hα red-pink
    hiiCore: [0.9, 0.75, 1.0], // [O III] blue-white
    discGain: 1,
    discFalloff: 0,
    bulgeGain: 1,
    lightColor: IDENTITY,
    gasColor: [0, 0, 0],
    gasHole: 0,
    agnGain: 1,
    jetGain: 1,
    agnHot: [1.0, 0.82, 0.55], // Interstellar gold: white-hot inner edge
    agnCool: [1.0, 0.38, 0.06],
    snGain: 1,
    skyTint: [1, 1, 1],
    fieldGain: 1,
  },
  hubble: {
    label: 'Hubble palette (SHO)',
    starGain: 1,
    starKeep: 1,
    starColor: SHO_GRADE,
    dustPass: 1,
    hiiGain: 2,
    hiiColor: [0.85, 0.75, 0.15], // Hα mapped to green, [S II] red: gold
    hiiCore: [0.25, 0.8, 1.0], // [O III] mapped to blue: teal
    discGain: 1,
    discFalloff: 0,
    bulgeGain: 1,
    lightColor: SHO_GRADE,
    gasColor: [0.7, 0.6, 0.1], // diffuse Hα gold along the arms
    gasHole: 0,
    agnGain: 1,
    jetGain: 1,
    agnHot: [1.0, 0.9, 0.55], // gold inner, teal outer
    agnCool: [0.25, 0.75, 0.8],
    snGain: 1,
    skyTint: [0.95, 1.0, 0.9],
    fieldGain: 1,
  },
  infrared: {
    label: 'Infrared (JWST)',
    starGain: 0.35,
    starKeep: 1,
    starColor: lumaTint([1.0, 0.8, 0.6]),
    dustPass: 0.12,
    hiiGain: 0.9, // PAH emission around young clusters
    hiiColor: [1.0, 0.55, 0.2],
    hiiCore: [1.0, 0.95, 0.85],
    discGain: 0.35,
    discFalloff: 0,
    bulgeGain: 0.8, // old stars dominate the near-IR bulge
    lightColor: lumaTint([1.0, 0.8, 0.6]),
    gasColor: [3.6, 1.3, 0.3], // warm dust glow (the dust slab is thin: a strong gain)
    gasHole: 0,
    agnGain: 0.5,
    jetGain: 0.4,
    agnHot: [1.0, 0.55, 0.25], // deep red-orange
    agnCool: [0.75, 0.15, 0.05],
    snGain: 0.5,
    skyTint: [1.0, 0.6, 0.4],
    fieldGain: 0.5,
  },
  radio: {
    label: 'Radio (21 cm gas)',
    starGain: 0,
    starKeep: 1,
    starColor: IDENTITY,
    dustPass: 0, // radio passes through dust
    hiiGain: 0.12, // free-free emission
    hiiColor: [0.5, 0.75, 1.0],
    hiiCore: [0.9, 0.95, 1.0],
    discGain: 0,
    discFalloff: 0,
    bulgeGain: 0,
    lightColor: IDENTITY,
    gasColor: [0.9, 2.2, 5.0],
    gasHole: 0.22,
    agnGain: 0.3,
    jetGain: 4,
    agnHot: [1.0, 0.8, 0.6], // dim warm (agnGain dims it)
    agnCool: [0.7, 0.35, 0.15],
    snGain: 0.4, // remnants are radio sources too
    skyTint: [0.3, 0.5, 1.0],
    fieldGain: 0.03,
  },
  xray: {
    label: 'X-ray (Chandra)',
    starGain: 12, // the few stars left are bright compact sources
    starKeep: 0.005,
    starColor: lumaTint([0.75, 0.65, 1.0]),
    dustPass: 0.4,
    hiiGain: 0,
    hiiColor: [0, 0, 0],
    hiiCore: [0, 0, 0],
    discGain: 3, // diffuse hot gas of the inner disc and bar
    discFalloff: 0.18,
    bulgeGain: 4, // hot gas around the bulge
    lightColor: lumaTint([0.7, 0.55, 1.0]),
    gasColor: [0, 0, 0],
    gasHole: 0,
    agnGain: 3,
    jetGain: 2,
    agnHot: [0.85, 0.9, 1.0], // hot blue-white
    agnCool: [0.45, 0.5, 1.0],
    snGain: 3,
    skyTint: [0.5, 0.4, 1.0],
    fieldGain: 0.08,
  },
};

/** The band for a settings value (unknown → visible). */
export function bandFor(name) {
  return BANDS[name] ?? BANDS.visible;
}

/** The next band in BAND_OPTIONS (wraps), for the V key. */
export function nextBand(name) {
  const i = BAND_OPTIONS.indexOf(name);
  return BAND_OPTIONS[(i + 1) % BAND_OPTIONS.length];
}
