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
 * The file is only the part the intro uses: 1:13-2:33 of the full theme
 * (80 s, 1.3 MB), so the music starts 10 s in (1:23 of the original). The
 * fall lasts 60 s and goes black in its last ~4 s. The first build peaks at
 * about 1:00-1:08 of this file (-13 dB), then drops to about -37 dB at 1:11,
 * so the black lands on the peak and holds over the quiet part. The track
 * starts 5 s early in the wait (0:05) and fades out 5 s after the black
 * (~1:15), leaving 5 s of margin at both ends.
 */
export const FALL_MUSIC_START = 10;
