/**
 * Music files. Empty, or a file that is missing or fails to load: the
 * generated ambient drone plays instead.
 *
 * Use a file in `public/audio/` (prefixed with BASE_URL, so it also works when
 * the site is served under a path) or a URL whose
 * server sends CORS headers (Access-Control-Allow-Origin). The music runs
 * through Web Audio for its fades, and a cross-origin file without CORS
 * plays as silence there.
 */

/** Plays during the intro fall into the black hole: Interstellar main theme (Hans Zimmer), a local file. */
export const FALL_MUSIC_URL = `${import.meta.env.BASE_URL}audio/interstellar.mp3`;

/**
 * Where the fall music starts (s): chosen so the plunge lands on the peak.
 * The fall lasts 60 s and goes black in its last ~4 s. In this file the first
 * build peaks at about 2:13-2:21 (-13 dB), then drops to about -37 dB at
 * 2:24. Starting at 1:23 puts the black on the peak and holds it over the
 * quiet part. (The first ~22 s of the track are near silent.)
 */
export const FALL_MUSIC_START = 83;
