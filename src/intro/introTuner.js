import GUI from 'lil-gui';
import { MARCH_LOOK, COMPOSITE_LOOK, LOOK_LIMITS, clampLook } from './introLook.js';
import { BLACK_FULL, REFERENCE_SHOTS } from './introTimeline.js';
import { shotNumberFromName, contentBounds } from './tunerMath.js';
import { copyDialog } from '../ui/dialog.js';

/**
 * The ?tune view for the intro cinematic: a clock you can stop, scrub and
 * jump to each reference shot; the reference stills (loaded from your own
 * disk, never shipped) beside or over the frame; and live sliders for every
 * look value, with "Copy values" for pasting the result into introLook.js.
 * While it is open the intro neither ends nor locks the input (app.js).
 *
 * @param {{ intro: import('./IntroCinematic.js').IntroCinematic, container: HTMLElement }} options
 */
export function createIntroTuner({ intro, container }) {
  const state = { time: REFERENCE_SHOTS[1], playing: false, shot: 1, mode: 'split', split: 0.5, opacity: 0.5 };
  const stills = new Map(); // shot number → object URL of the trimmed still

  // The reference over the canvas (no input: the canvas stays usable).
  const overlay = document.createElement('img');
  overlay.className = 'intro-tune-ref';
  overlay.alt = '';
  overlay.hidden = true;
  container.appendChild(overlay);

  function showReference() {
    const url = stills.get(state.shot);
    overlay.hidden = !url || state.mode === 'off';
    if (overlay.hidden) return;
    if (overlay.src !== url) overlay.src = url;
    overlay.style.opacity = state.mode === 'overlay' ? String(state.opacity) : '1';
    overlay.style.clipPath = state.mode === 'split' ? `inset(0 0 0 ${state.split * 100}%)` : 'none';
  }

  // Trim a player's grey or black bars, so the still lines up with the frame.
  async function trimmed(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { x0, y0, x1, y1 } = contentBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const out = document.createElement('canvas');
    out.width = x1 - x0;
    out.height = y1 - y0;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
    return URL.createObjectURL(blob);
  }

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.multiple = true;
  picker.hidden = true;
  container.appendChild(picker);
  picker.addEventListener('change', async () => {
    for (const file of picker.files) {
      const n = shotNumberFromName(file.name);
      if (n === null) continue;
      if (stills.has(n)) URL.revokeObjectURL(stills.get(n));
      stills.set(n, await trimmed(file));
    }
    picker.value = '';
    showReference();
  });

  const gui = new GUI({ title: 'Intro tuning', width: 320 });
  gui.domElement.classList.add('intro-tune-panel');

  const clock = gui.addFolder('Clock');
  const timeCtrl = clock.add(state, 'time', 0, BLACK_FULL, 0.05).name('Time (s)').listen();
  clock.add(state, 'playing').name('Play');
  const shots = Object.fromEntries(
    Object.entries(REFERENCE_SHOTS).map(([n, t]) => [
      `Shot ${n}`,
      () => {
        state.shot = Number(n);
        state.time = t;
        state.playing = false;
        showReference();
      },
    ]),
  );
  for (const name of Object.keys(shots)) clock.add(shots, name);
  timeCtrl.onChange(() => (state.playing = false));

  const ref = gui.addFolder('Reference stills');
  ref.add({ load: () => picker.click() }, 'load').name('Load stills… (name them 1–10)');
  ref.add(state, 'shot', Object.keys(REFERENCE_SHOTS).map(Number)).name('Shot').listen().onChange(showReference);
  ref.add(state, 'mode', ['split', 'overlay', 'off']).name('Compare').onChange(showReference);
  ref.add(state, 'split', 0, 1, 0.01).name('Split at').onChange(showReference);
  ref.add(state, 'opacity', 0, 1, 0.01).name('Overlay opacity').onChange(showReference);

  const look = intro.getLook();
  function addLook(folderName, defaults) {
    const folder = gui.addFolder(folderName);
    for (const name of Object.keys(defaults)) {
      const ctrl = Array.isArray(look[name])
        ? folder.addColor(look, name, 1)
        : folder.add(look, name, ...LOOK_LIMITS[name]);
      ctrl.onChange((v) => intro.setLook({ [name]: Array.isArray(v) ? v : clampLook(name, v) }));
    }
    folder.close();
  }
  addLook('Disc look', MARCH_LOOK);
  addLook('Film look', COMPOSITE_LOOK);
  gui.add(
    {
      copy: async () => {
        const json = JSON.stringify(intro.getLook());
        try {
          await navigator.clipboard.writeText(json);
        } catch {
          copyDialog('Copy these look values:', json);
        }
      },
    },
    'copy',
  ).name('Copy values');

  return {
    /** Advance the clock (real seconds); returns the time to show. */
    tick(dt) {
      if (state.playing) state.time = (state.time + dt) % BLACK_FULL;
      return state.time;
    },
    dispose() {
      gui.destroy();
      overlay.remove();
      picker.remove();
      for (const url of stills.values()) URL.revokeObjectURL(url);
    },
  };
}
