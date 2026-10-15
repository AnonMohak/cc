/**
 * The film clip the intro is matched to (the slingshot past Gargantua in
 * Interstellar): its black-hole shots as frame ranges of the clip, and where
 * the 1-per-second stills (images/frame_NNN.png) sit in it. Numbers only:
 * the clip and its frames stay on the user's disk (images/, gitignored) and
 * are used only to measure (scripts/clip-frames.mjs, scripts/score-intro.mjs).
 * Pure.
 */

/** The clip's frame rate (NTSC film rate). */
export const CLIP_FPS = 24000 / 1001;

/**
 * The black-hole shots in film order: clip frames first–last (inclusive),
 * the stills they hold, and whether a spacecraft covers part of the frame
 * (masked out of every measurement; no ship is ever drawn). The gap and the
 * dome are one continuous shot in the film (the camera rises out of the
 * disc plane). Other clip shots show actors, cockpits or ships: unused.
 */
export const FILM_SHOTS = [
  { name: 'gap-dome', first: 0, last: 152, stills: [1, 2, 3, 4, 5, 6], ship: 'small' },
  { name: 'clouds', first: 213, last: 270, stills: [10, 11], ship: 'large' },
  { name: 'wall', first: 271, last: 488, stills: [12, 13, 14, 15, 16, 17, 18, 19, 20], ship: 'small' },
  { name: 'skim', first: 535, last: 629, stills: [23, 24, 25, 26], ship: 'small' },
  { name: 'bright', first: 630, last: 692, stills: [27, 28, 29], ship: 'large' },
];

/**
 * The clip frame of a still (frame_NNN.png, NNN from 1): the stills were
 * taken once a second, 24 clip frames apart, from clip frame 10 (each still
 * equals its clip frame exactly; frames counted from 0 in decode order).
 * @param {number} still
 */
export function stillClipFrame(still) {
  return 10 + 24 * (still - 1);
}

/** Seconds into the clip of a clip frame. */
export function clipSeconds(frame) {
  return frame / CLIP_FPS;
}

/** A shot's length (s). */
export function shotSeconds(shot) {
  return (shot.last - shot.first + 1) / CLIP_FPS;
}

/** The shot that holds a clip frame, or null (actors, cockpits, ships). */
export function shotOfFrame(frame) {
  return FILM_SHOTS.find((s) => frame >= s.first && frame <= s.last) ?? null;
}
