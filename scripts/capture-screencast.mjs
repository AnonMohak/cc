// Record the app's own intro as the browser shows it (for versions with no
// tune view or offline renderer, such as master's intro fall): a headless
// page at --width × --height, the start box clicked once, then --seconds of
// screencast frames with their times. Writes <out>/f_NNNNN.jpg and
// <out>/frames.txt (an ffmpeg concat list with each frame's duration):
//
//   ffmpeg -f concat -i <out>/frames.txt -vf fps=24 ... video.mp4
//
// Vite serves the current folder: run it from the version's checkout.
//
//   node scripts/capture-screencast.mjs --out renders/x [--seconds 66] [--width 960] [--height 540] [--gpu high]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPage } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const out = arg('out', 'renders/screencast');
const seconds = Number(arg('seconds', 66));
const width = Number(arg('width', 960));
const height = Number(arg('height', 540));
mkdirSync(out, { recursive: true });

const page = await openPage({ gpu: arg('gpu', null), path: '/', ready: "document.querySelector('.start.is-ready')", width, height });
const frames = [];
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  page.on('Page.screencastFrame', (p) => {
    frames.push({ data: p.data, time: p.metadata.timestamp });
    page.send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  // One click: the start box closes and the intro begins (its own clock).
  const click = (type) => page.send('Input.dispatchMouseEvent', { type, x: width / 2, y: height / 2, button: 'left', clickCount: 1 });
  await click('mousePressed');
  await click('mouseReleased');
  const start = Date.now() / 1000;
  console.log(`recording ${seconds} s from the click`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await page.send('Page.stopScreencast');
  // Frames from the click on (a frame shown at the click starts at 0).
  const kept = frames.filter((f, i) => f.time >= start || (frames[i + 1]?.time ?? Infinity) > start);
  const list = ['ffconcat version 1.0'];
  kept.forEach((f, i) => {
    const name = `f_${String(i + 1).padStart(5, '0')}.jpg`;
    writeFileSync(join(out, name), Buffer.from(f.data, 'base64'));
    const from = Math.max(f.time, start);
    const to = i + 1 < kept.length ? kept[i + 1].time : start + seconds;
    list.push(`file '${name}'`, `duration ${Math.max(to - from, 0.001).toFixed(4)}`);
  });
  // The concat demuxer needs the last file again for its duration to count.
  if (kept.length) list.push(`file 'f_${String(kept.length).padStart(5, '0')}.jpg'`);
  writeFileSync(join(out, 'frames.txt'), list.join('\n') + '\n');
  const span = kept.length ? kept[kept.length - 1].time - Math.max(kept[0].time, start) : 0;
  console.log(`${kept.length} frames over ${span.toFixed(1)} s (${(kept.length / Math.max(span, 1e-3)).toFixed(1)} fps) -> ${out}`);
} finally {
  page.close();
}
