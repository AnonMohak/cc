/**
 * Music files. Empty, or a file that is missing or fails to load: the
 * generated ambient drone plays instead.
 *
 * Use a file in `public/audio/` (for example '/audio/fall.mp3') or a URL whose
 * server sends CORS headers (Access-Control-Allow-Origin). The music runs
 * through Web Audio for its fades, and a cross-origin file without CORS
 * plays as silence there.
 */

/**
 * Plays during the intro fall into the black hole: Interstellar main theme
 * (Hans Zimmer), streamed from the audio.com upload's CDN (CORS: *).
 *
 * This is a signed link (X-Amz-Expires = 6 days from 2026-10-05 17:44 UTC):
 * it stops working on 2026-10-11 at about 17:44 UTC, and then the drone plays
 * instead. For a lasting setup, save the file as public/audio/interstellar.mp3
 * and set this to '/audio/interstellar.mp3'.
 */
export const FALL_MUSIC_URL =
  'https://s3.ustatik.com/audio.com.audio/transcoding/85/19/1845855631841985-1845855631994643-1845855633379012.mp3' +
  '?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256' +
  '&X-Amz-Credential=F0E8U41NBMMW3Y027UTJ%2F20261005%2Feu-central-1%2Fs3%2Faws4_request' +
  '&X-Amz-Date=20261005T174418Z&X-Amz-SignedHeaders=host&X-Amz-Expires=518400' +
  '&X-Amz-Signature=5cbc56589a26e74551224e7c3af1a9796e10efeb8fbacdd0090f6b317cdea8db';

/**
 * Where the fall music starts (s): chosen so the plunge lands on the peak.
 * The fall lasts 60 s and goes black in its last ~4 s; the theme's strongest
 * build peaks at about 2:10-2:20 (-9 dB), then drops to about -30 dB at 2:23.
 * Starting at 1:20 puts the black on the peak and holds it over the quiet
 * part. (The first ~22 s of the track are near silent.)
 */
export const FALL_MUSIC_START = 80;
