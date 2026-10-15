// Read and write images for the measuring scripts through ffmpeg (no
// packages): any image or video ffmpeg reads, scaled to w × h, as 8-bit RGB
// rows top to bottom. Needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process';

const BIG = 1 << 30;

/**
 * One image, or a video's frame at `seconds` (an exact seek), scaled to
 * w × h (area averaging), as RGB bytes.
 * @returns {Uint8Array}
 */
export function readRGB(file, w, h, seconds = null) {
  const seek = seconds === null ? [] : ['-ss', seconds.toFixed(4)];
  return new Uint8Array(
    execFileSync('ffmpeg', ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], {
      maxBuffer: BIG,
    }),
  );
}

/**
 * Frames of a numbered sequence (e.g. images/clip/wall/%04d.png from 271),
 * every `step`-th of `count`, scaled to w × h: an array of RGB byte arrays.
 */
export function readSequence(pattern, start, count, w, h, step = 1) {
  const out = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-start_number', String(start), '-i', pattern, '-frames:v', String(count), '-vf', `select='not(mod(n\\,${step}))',scale=${w}:${h}:flags=area`, '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
    { maxBuffer: BIG },
  );
  const size = w * h * 3;
  const frames = [];
  for (let i = 0; i + size <= out.length; i += size) frames.push(new Uint8Array(out.buffer, out.byteOffset + i, size));
  return frames;
}

/** Write RGB bytes (w × h) as an image file (the type from its extension). */
export function writeRGB(file, w, h, rgb) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-', '-q:v', '3', '-frames:v', '1', file], {
    input: Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length),
  });
}

/** A canvas of RGB bytes to draw check sheets on. */
export function canvas(w, h, fill = 20) {
  const rgb = new Uint8Array(w * h * 3).fill(fill);
  let clip = [0, 0, w, h];
  const set = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3]) return;
    rgb.set(c, 3 * (y * w + x));
  };
  return {
    w,
    h,
    rgb,
    /** Draw only inside x0 ≤ x < x1, y0 ≤ y < y1 from now on (no arguments: everywhere). */
    clip(x0 = 0, y0 = 0, x1 = w, y1 = h) {
      clip = [Math.max(0, x0), Math.max(0, y0), Math.min(w, x1), Math.min(h, y1)];
    },
    /** Paste RGB bytes of size pw × ph at (x0, y0). */
    paste(src, pw, ph, x0, y0) {
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (x0 + x < w && y0 + y < h) rgb.set(src.subarray(3 * (y * pw + x), 3 * (y * pw + x) + 3), 3 * ((y0 + y) * w + x0 + x));
    },
    circle(cx, cy, r, c) {
      const n = Math.max(16, Math.ceil(2 * Math.PI * r));
      for (let i = 0; i < n; i++) set(cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI), c);
    },
    line(x0, y0, x1, y1, c) {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
      for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    },
    rect(x0, y0, x1, y1, c) {
      this.line(x0, y0, x1, y0, c);
      this.line(x1, y0, x1, y1, c);
      this.line(x1, y1, x0, y1, c);
      this.line(x0, y1, x0, y0, c);
    },
  };
}
