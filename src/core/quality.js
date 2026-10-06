/**
 * Quality tiers. Each tier sets every GPU-cost knob at once; "Auto" lets the
 * governor (qualityGovernor.js) pick the tier from measured frame times.
 * Tuned for integrated and mobile GPUs: High is the most a typical laptop
 * iGPU should be asked for.
 */
export const QUALITY = {
  minimal: {
    label: 'Minimal',
    volumeScale: 0.25, // fraction of screen resolution for the raymarched volume
    steps: 10, // max raymarch steps per pixel
    bloom: 'off', // 'half' = half-resolution bloom, 'off' = no bloom pass
    maxPixelRatio: 1,
    starCap: 30_000, // stars drawn per galaxy (setDrawRange, no rebuild)
    volumeDust: false, // stars keep their own analytic dust either way
    maxPointPx: 8,
  },
  low: { label: 'Low', volumeScale: 0.35, steps: 14, bloom: 'off', maxPixelRatio: 1, starCap: 60_000, volumeDust: true, maxPointPx: 10 },
  medium: { label: 'Medium', volumeScale: 0.5, steps: 20, bloom: 'half', maxPixelRatio: 1.5, starCap: 120_000, volumeDust: true, maxPointPx: 14 },
  high: { label: 'High', volumeScale: 0.75, steps: 32, bloom: 'half', maxPixelRatio: 2, starCap: 200_000, volumeDust: true, maxPointPx: 18 },
};

/** Cheapest first: the governor moves along this list. */
export const TIER_ORDER = ['minimal', 'low', 'medium', 'high'];

/** Values allowed in settings.quality. */
export const QUALITY_OPTIONS = ['auto', ...TIER_ORDER];

/** Phones and tablets: coarse pointer or a small screen. */
export function isMobileDevice(win = globalThis.window) {
  if (!win) return false;
  const coarse = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(win.screen?.width ?? 1e4, win.screen?.height ?? 1e4) < 700;
  return coarse || small;
}

/** Where Auto starts before it has measured anything. */
export function startTier(mobile) {
  return mobile ? 'low' : 'medium';
}

/** Frame-time target for the governor (ms). */
export function targetFrameMs(mobile) {
  return mobile ? 1000 / 30 : 1000 / 50;
}

/** The tier actually in use for a settings value. */
export function activeTier(setting, autoTier) {
  return setting === 'auto' ? autoTier : setting;
}

/** Device pixel ratio to render at, capped by the tier. */
export function pixelRatioFor(devicePixelRatio, tierName) {
  return Math.min(devicePixelRatio || 1, QUALITY[tierName].maxPixelRatio);
}

/** Whether the bloom pass runs, from the user's strength and the tier. */
export function bloomEnabled(strength, tierName) {
  return strength > 0 && QUALITY[tierName].bloom !== 'off';
}
