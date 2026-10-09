/**
 * PURE: target volumes and fade times for the soundscape (audio/soundscape.js).
 *
 * Modes:
 * - ambient: the generated space drone, very quiet (under everything).
 * - wait: the intro fall's idle wait; the fall track rises from MUSIC_MIN to
 *   MUSIC_LEVEL by the time the fall starts.
 * - fall: the fall track at MUSIC_LEVEL.
 * - end: fallen in; the track fades out over MUSIC_END_FADE, then the drone
 *   comes back.
 * The music needs a track that can play; without one the drone simply keeps
 * playing through the intro.
 */

/** Drone level: barely there. */
export const AMBIENT_LEVEL = 0.05;
/** Fall music level. */
export const MUSIC_LEVEL = 0.6;
/** Music level at the start-box click (the wait's rise starts here). */
export const MUSIC_MIN = 0.01;
/** Crossfade times (s): music in when the fall starts, out when it is left. */
export const MUSIC_FADE_IN = 3;
export const MUSIC_FADE_OUT = 2.5;
/** Fallen in: the music fades out over this many seconds, then the drone returns. */
export const MUSIC_END_FADE = 5;
/** Seconds for the drone to come back after the end fade. */
export const AMBIENT_RETURN = 3;

/**
 * @param {{ enabled: boolean, mode: 'ambient' | 'wait' | 'fall' | 'end', hasMusic: boolean }} state
 * @returns {{ ambient: number, music: number }}
 */
export function mixLevels({ enabled, mode, hasMusic }) {
  if (!enabled) return { ambient: 0, music: 0 };
  if ((mode === 'wait' || mode === 'fall') && hasMusic) return { ambient: 0, music: MUSIC_LEVEL };
  return { ambient: AMBIENT_LEVEL, music: 0 };
}

/**
 * How the gains move into `mode`: fade seconds for each, a delay before the
 * drone starts (the end fade finishes first), and whether the music rise is
 * exponential (wait: an even rise to the ear) from MUSIC_MIN.
 * @param {'ambient' | 'wait' | 'fall' | 'end'} mode
 * @param {number} waitLeft seconds until the fall starts (wait only)
 * @returns {{ music: number, ambient: number, ambientDelay: number, rise: boolean }}
 */
export function mixFades(mode, waitLeft = 0) {
  if (mode === 'wait') {
    const t = Math.max(waitLeft, 0.5);
    return { music: t, ambient: Math.min(t, MUSIC_FADE_OUT), ambientDelay: 0, rise: true };
  }
  if (mode === 'fall') return { music: MUSIC_FADE_IN, ambient: MUSIC_FADE_IN, ambientDelay: 0, rise: false };
  if (mode === 'end') return { music: MUSIC_END_FADE, ambient: AMBIENT_RETURN, ambientDelay: MUSIC_END_FADE, rise: false };
  return { music: MUSIC_FADE_OUT, ambient: MUSIC_FADE_OUT, ambientDelay: 0, rise: false };
}

/** Consumption rumble (scene/CollisionSim.js status): its loudest level. */
export const RUMBLE_MAX = 0.35;
/** Seconds for the rumble to die away after the merge. */
export const RUMBLE_DECAY = 1.5;
/** Low-pass cutoff (Hz) of the rumble, from a slow to a fast orbit. */
export const RUMBLE_CUTOFF_MIN = 45;
export const RUMBLE_CUTOFF_MAX = 170;

/**
 * Rumble level 0–RUMBLE_MAX during a consumption: quiet in the approach,
 * louder with each turn (with a pulse once per orbit), full at the merge,
 * then it dies away. 0 without one.
 * @param {{ stage?: string, progress?: number, turnsDone?: number, afterTime?: number, merged?: boolean } | null} status
 */
export function rumbleLevel(status) {
  if (!status || !status.stage || status.stage === 'done') return 0;
  if (status.stage === 'after') return RUMBLE_MAX * Math.exp(-status.afterTime / RUMBLE_DECAY);
  if (status.merged) return RUMBLE_MAX;
  const rise = 0.15 + 0.85 * Math.min(1, status.progress) ** 1.5;
  const pulse = 0.85 + 0.15 * Math.cos(2 * Math.PI * (status.turnsDone ?? 0));
  return RUMBLE_MAX * rise * pulse;
}

/** Rumble cutoff (Hz): it rises with the orbit frequency, so the chirp is heard. */
export function rumbleCutoff(orbitHz) {
  return Math.min(RUMBLE_CUTOFF_MAX, RUMBLE_CUTOFF_MIN + 40 * Math.max(0, orbitHz));
}
