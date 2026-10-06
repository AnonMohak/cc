import { buildPalette, createIndexer, indexFrame, encodeGif } from '../util/gif.js';

const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
const VIDEO_FPS = 30;
const VIDEO_BITRATE = 12_000_000;
export const MAX_VIDEO_SECONDS = 60;

/** First supported recording type, or null if video capture is unavailable. */
export function pickVideoType(isSupported) {
  return VIDEO_TYPES.find((t) => isSupported(t)) ?? null;
}

/** "0:07" style timer. */
export function formatClock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Video recording of the canvas with MediaRecorder. Stops by itself after
 * MAX_VIDEO_SECONDS.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ onStop: (blob: Blob, extension: string) => void }} handlers
 */
export function createVideoRecorder(canvas, { onStop }) {
  const supported =
    typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
  const type = supported ? pickVideoType((t) => MediaRecorder.isTypeSupported(t)) : null;
  let recorder = null;
  let startedAt = 0;
  let autoStop = null;

  return {
    isSupported: () => type !== null,
    isRecording: () => recorder !== null,
    elapsed: () => (recorder ? (performance.now() - startedAt) / 1000 : 0),
    start() {
      if (!type || recorder) return false;
      const chunks = [];
      const stream = canvas.captureStream(VIDEO_FPS);
      recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onStop(new Blob(chunks, { type }), type.startsWith('video/mp4') ? 'mp4' : 'webm');
      };
      recorder.start(1000);
      startedAt = performance.now();
      autoStop = setTimeout(() => this.stop(), MAX_VIDEO_SECONDS * 1000);
      return true;
    },
    stop() {
      if (!recorder) return;
      clearTimeout(autoStop);
      recorder.stop();
      recorder = null;
    },
  };
}

/**
 * Short GIF capture. Call afterRender(now) right after each frame is drawn:
 * the WebGL drawing buffer is only readable until the browser composites,
 * so frames are copied in the same task (no preserveDrawingBuffer cost).
 *
 * @param {HTMLCanvasElement} source WebGL canvas
 * @param {{ seconds?: number, fps?: number, width?: number }} [options]
 */
export function createGifCapture(source, { seconds = 4, fps = 12, width = 480 } = {}) {
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  let capture = null;
  let encoding = false;

  return {
    isCapturing: () => capture !== null,
    isEncoding: () => encoding,
    progress: () => (capture ? { frames: capture.frames.length, total: capture.total } : null),
    /** @returns {Promise<Blob>} resolves with the encoded GIF */
    start() {
      if (capture || encoding) return capture?.promise ?? Promise.reject(new Error('busy'));
      const aspect = source.height / source.width;
      scratch.width = width;
      scratch.height = Math.max(2, Math.round((width * aspect) / 2) * 2);
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      capture = { frames: [], times: [], total: Math.round(seconds * fps), next: 0, resolve, promise };
      return promise;
    },
    afterRender(now) {
      if (!capture || now < capture.next) return;
      capture.next = now + 1000 / fps;
      ctx.drawImage(source, 0, 0, scratch.width, scratch.height);
      capture.frames.push(ctx.getImageData(0, 0, scratch.width, scratch.height).data);
      capture.times.push(now);
      if (capture.frames.length >= capture.total) {
        const done = capture;
        capture = null;
        encoding = true;
        // Encode on a later task so the frame that finished capture is not delayed.
        setTimeout(() => {
          const blob = encodeFrames(done, scratch.width, scratch.height, fps);
          encoding = false;
          done.resolve(blob);
        }, 0);
      }
    },
  };
}

function encodeFrames({ frames, times }, width, height, fps) {
  const palette = buildPalette(frames);
  const index = createIndexer(palette);
  const indexed = frames.map((f) => indexFrame(f, index, width));
  // Real frame spacing (slow devices capture fewer frames per second).
  const delaysCs = times.map((t, i) => (i + 1 < times.length ? (times[i + 1] - t) / 10 : 100 / fps));
  return new Blob([encodeGif({ width, height, palette, frames: indexed, delaysCs })], { type: 'image/gif' });
}
