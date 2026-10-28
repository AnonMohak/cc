/**
 * The pre-rendered intro (branch film-match): the cinematic rendered offline
 * at full quality (IntroCinematic.renderStill, scripts/render-intro.mjs) and
 * played as a video in sync with the intro clock. The real-time renderer
 * draws until the video is ready, and stays when it fails or is missing.
 */

/** The video files in public/video/, best first: [file, MIME type with codecs]. */
export const INTRO_VIDEO_FILES = [
  ['video/intro-av1.webm', 'video/webm; codecs="av01.0.08M.08"'],
  ['video/intro-h264.mp4', 'video/mp4; codecs="avc1.640028"'],
];
/** The same for portrait screens: 720 × 1280, the camera pulled back (introTimeline.js PORTRAIT_KEYS). */
export const PORTRAIT_VIDEO_FILES = [
  ['video/intro-portrait-av1.webm', 'video/webm; codecs="av01.0.05M.08"'],
  ['video/intro-portrait-h264.mp4', 'video/mp4; codecs="avc1.64001f"'],
];
/** Seek when the video is this far (s) from the intro clock. */
export const VIDEO_DRIFT = 0.25;

/**
 * The first file the browser can play, as a URL under `base`; null if none.
 * @param {(type: string) => string} canPlayType a video element's canPlayType
 * @param {string} base import.meta.env.BASE_URL
 * @param {boolean} [portrait] pick from the portrait files
 */
export function pickVideo(canPlayType, base = '/', portrait = false) {
  const file = (portrait ? PORTRAIT_VIDEO_FILES : INTRO_VIDEO_FILES).find(([, type]) => canPlayType(type) !== '');
  return file ? base + file[0] : null;
}

/**
 * Where the video should jump to for intro time `t`: null while it is close
 * enough (small drift is left alone, a seek costs a stutter).
 * @param {number} videoTime
 * @param {number} t
 * @param {number} duration the video's length (s)
 */
export function seekTarget(videoTime, t, duration) {
  const target = Math.min(Math.max(t, 0), Math.max(duration - 0.05, 0));
  return Math.abs(videoTime - target) > VIDEO_DRIFT ? target : null;
}

/**
 * A full-screen video under the fall overlay. The whole file is fetched and
 * played from a Blob URL (Cloudflare Pages ignores HTTP Range requests, and
 * Safari cannot stream a video without them).
 * @param {HTMLElement} container
 * @param {{ base?: string, before?: Element | null, portrait?: boolean }} [options]
 */
export function createIntroVideo(container, { base = '/', before = null, portrait = false } = {}) {
  const video = document.createElement('video');
  video.className = 'intro-video';
  video.muted = true; // the music plays from the soundscape
  video.playsInline = true;
  video.preload = 'auto';
  video.hidden = true;
  container.insertBefore(video, before);

  let state = 'loading'; // 'loading' | 'ready' | 'failed'
  let blobUrl = null;
  let disposed = false;
  const url = pickVideo((type) => video.canPlayType(type), base, portrait);
  const fail = () => {
    state = 'failed';
    video.hidden = true;
  };
  if (!url) fail();
  else {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`intro video: ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (disposed) return;
        blobUrl = URL.createObjectURL(blob);
        video.addEventListener('canplaythrough', () => (state = state === 'loading' ? 'ready' : state), { once: true });
        video.addEventListener('error', fail, { once: true });
        video.src = blobUrl;
        video.load();
      })
      .catch(fail);
  }

  return {
    /** True once the video plays instead of the real-time renderer. */
    get active() {
      return state === 'ready' && !video.hidden;
    },
    /**
     * Follow the intro clock.
     * @param {number} t intro seconds
     * @param {boolean} running false while the start box is open
     */
    sync(t, running) {
      if (state !== 'ready' || !running) return;
      const jump = seekTarget(video.currentTime, t, video.duration || 0);
      if (jump !== null) video.currentTime = jump;
      if (video.paused) {
        video.play().then(
          () => (video.hidden = false),
          () => fail(),
        );
      }
    },
    dispose() {
      disposed = true;
      video.pause();
      video.remove();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
  };
}
