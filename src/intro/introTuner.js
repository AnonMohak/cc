import GUI from 'lil-gui';
import { MARCH_LOOK, COMPOSITE_LOOK, LOOK_LIMITS, clampLook } from './introLook.js';
import { BLACK_FULL, REFERENCE_SHOTS, filmFrameAt } from './introTimeline.js';
import { copyDialog } from '../ui/dialog.js';

/**
 * The ?tune view for the intro cinematic: a clock you can stop, scrub and
 * jump to each film shot; the film frame for the current moment beside or
 * over ours (the clip's frames from images/clip/, scripts/clip-frames.mjs:
 * dev server only, never shipped); and live sliders for every look value,
 * with "Copy values" for pasting the result into introLook.js. While it is
 * open the intro neither ends nor locks the input (app.js).
 *
 * @param {{ intro: import('./IntroCinematic.js').IntroCinematic, container: HTMLElement }} options
 */
export function createIntroTuner({ intro, container }) {
  const state = { time: 0, playing: false, mode: 'split', split: 0.5, opacity: 0.5 };

  // The film frame over the canvas (no input: the canvas stays usable).
  const overlay = document.createElement('img');
  overlay.className = 'intro-tune-ref';
  overlay.alt = '';
  overlay.hidden = true;
  overlay.addEventListener('error', () => (overlay.hidden = true));
  container.appendChild(overlay);
  let shown = null;

  function showReference() {
    const film = filmFrameAt(state.time);
    const url = film && `${import.meta.env.BASE_URL}images/clip/${film.shot}/${String(film.frame).padStart(4, '0')}.png`;
    overlay.hidden = !url || state.mode === 'off';
    if (overlay.hidden) return;
    if (url !== shown) {
      shown = url;
      overlay.src = url;
    }
    overlay.style.opacity = state.mode === 'overlay' ? String(state.opacity) : '1';
    overlay.style.clipPath = state.mode === 'split' ? `inset(0 0 0 ${state.split * 100}%)` : 'none';
  }

  const gui = new GUI({ title: 'Intro tuning', width: 320 });
  gui.domElement.classList.add('intro-tune-panel');

  const clock = gui.addFolder('Clock');
  const timeCtrl = clock.add(state, 'time', 0, BLACK_FULL, 0.01).name('Time (s)').listen();
  clock.add(state, 'playing').name('Play');
  const shots = Object.fromEntries(
    Object.entries(REFERENCE_SHOTS).map(([name, t]) => [
      `Shot: ${name}`,
      () => {
        state.time = t;
        state.playing = false;
        showReference();
      },
    ]),
  );
  for (const name of Object.keys(shots)) clock.add(shots, name);
  timeCtrl.onChange(() => {
    state.playing = false;
    showReference();
  });

  const ref = gui.addFolder('Film frame');
  ref.add(state, 'mode', ['split', 'overlay', 'off']).name('Compare').onChange(showReference);
  ref.add(state, 'split', 0, 1, 0.01).name('Split at').onChange(showReference);
  ref.add(state, 'opacity', 0, 1, 0.01).name('Overlay opacity').onChange(showReference);

  const look = intro.getLook();
  // The final grade over the whole intro (GRADE_*: after every shot's own
  // grade, never on a camera key), as plain sliders: a colour picker stops
  // at 1.
  const grade = { brightness: 1, red: 1, green: 1, blue: 1, lift: 0, gamma: 1, saturation: 1 };
  const applyGrade = () =>
    intro.setLook({
      GRADE_SLOPE: [grade.brightness * grade.red, grade.brightness * grade.green, grade.brightness * grade.blue],
      GRADE_OFFSET: [grade.lift, grade.lift, grade.lift],
      GRADE_POWER: [1 / grade.gamma, 1 / grade.gamma, 1 / grade.gamma],
      GRADE_SAT: grade.saturation,
    });
  const final = gui.addFolder('Final grade (whole intro)');
  final.add(grade, 'brightness', 0.3, 2, 0.01).onChange(applyGrade);
  for (const c of ['red', 'green', 'blue']) final.add(grade, c, 0.5, 1.5, 0.01).onChange(applyGrade);
  final.add(grade, 'lift', -0.1, 0.1, 0.001).onChange(applyGrade);
  final.add(grade, 'gamma', 0.5, 2, 0.01).onChange(applyGrade);
  final.add(grade, 'saturation', 0, 2, 0.01).onChange(applyGrade);
  function addLook(folderName, defaults) {
    const folder = gui.addFolder(folderName);
    for (const name of Object.keys(defaults)) {
      if (name.startsWith('GRADE_')) continue;
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
  showReference();

  return {
    /** Advance the clock (real seconds); returns the time to show. */
    tick(dt) {
      if (state.playing) {
        state.time = (state.time + dt) % BLACK_FULL;
        showReference();
      }
      return state.time;
    },
    dispose() {
      gui.destroy();
      overlay.remove();
    },
  };
}
