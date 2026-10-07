/**
 * PURE: target volumes for the soundscape (audio/soundscape.js).
 *
 * - ambient: the generated space drone, very quiet (under everything).
 * - music: the intro-fall track, only during the fall and only when one is set.
 * Without a fall track the drone simply keeps playing through the fall.
 */

/** Drone level: barely there. */
export const AMBIENT_LEVEL = 0.05;
/** Fall music level. */
export const MUSIC_LEVEL = 0.6;
/** Crossfade times (s): music in when the fall starts, out when it ends. */
export const MUSIC_FADE_IN = 3;
export const MUSIC_FADE_OUT = 2.5;

/**
 * @param {{ enabled: boolean, mode: 'ambient' | 'fall', hasMusic: boolean }} state
 * @returns {{ ambient: number, music: number }}
 */
export function mixLevels({ enabled, mode, hasMusic }) {
  if (!enabled) return { ambient: 0, music: 0 };
  if (mode === 'fall' && hasMusic) return { ambient: 0, music: MUSIC_LEVEL };
  return { ambient: AMBIENT_LEVEL, music: 0 };
}
