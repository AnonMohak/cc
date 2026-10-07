/**
 * Music files. Empty, or a file that is missing or fails to load: the
 * generated ambient drone plays instead.
 *
 * Use a file in `public/audio/` (for example '/audio/fall.mp3') or a URL whose
 * server sends CORS headers (Access-Control-Allow-Origin). The music runs
 * through Web Audio for its fades, and a cross-origin file without CORS
 * plays as silence there.
 */

/** Plays during the intro fall into the black hole. Drop the file at public/audio/interstellar.mp3. */
export const FALL_MUSIC_URL = '/audio/interstellar.mp3';
