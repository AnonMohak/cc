# Galaxy

An interactive 3D galaxy sandbox in the browser. Users create, edit, and delete realistic procedural galaxies and fly the camera around them.

> Status: feature-complete (milestones M0–M9). New work: keep tests passing and `npm run build` clean before each commit.

## Features

Required:

- Create and delete galaxies (many can exist at once, each at its own position).
- Change a galaxy's size, particle count, colors (core and edge), and shape.
- Change a galaxy's rotation speed (including reverse and zero).
- Zoom in and out (mouse wheel / pinch, via OrbitControls).

Additional:

- **Presets**: spiral, barred spiral, elliptical, irregular. A new galaxy starts from a preset.
- **Selection**: click or tap a galaxy to select it (a faint ring marks it); the control panel edits the selected one. Double-click / double-tap or "Focus" flies the camera to it.
- **Differential rotation**: inner stars orbit faster than outer stars, so arms wind like a real galaxy.
- **Bloom**: a glow post-process on the bright core and stars.
- **Background starfield and dust**: a static far starfield, plus dark dust lanes along the arms.
- **Global controls**: pause/resume time, global time scale, bloom strength, auto-rotate camera.
- **Persistence**: the scene saves to `localStorage` and restores on reload; "Reset scene" clears it.
- **Screenshot**: export the canvas as PNG.
- **Keyboard**: Space pause · N add · F focus · Delete remove · Esc deselect · H hide panel · P screenshot (`ui/keyboard.js`).
- **Robustness**: a notice when WebGL 2 is missing; WebGL context loss pauses and restores.

## Tech stack

| Area | Choice | Notes |
| --- | --- | --- |
| Language | JavaScript (ES modules) | No TypeScript. Use JSDoc types on public functions. |
| 3D | `three` (^0.186) | `WebGLRenderer`, `Points`, `ShaderMaterial`. |
| Addons | `three/addons/*` | `OrbitControls`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`. |
| Build / dev server | `vite` (^8) | GLSL loads with `?raw` imports. No GLSL plugin. |
| UI panel | `lil-gui` (^0.21) | Standard Three.js control GUI. |
| Tests | `vitest` (^5) | Runs in Node (`vite.config.js`); no browser, jsdom or WebGL. |

Do not add other runtime dependencies (no React, no UI framework, no state library) without asking.

## Dev commands

```sh
npm install          # install dependencies
npm run dev          # start the Vite dev server (http://localhost:5173)
npm run build        # production build to dist/
npm run preview      # serve the production build
npm test             # run Vitest once
npm run test:watch   # run Vitest in watch mode
```

## Architecture

Data flows one way: **UI → store → scene**. The UI never touches Three.js objects directly.

```
src/
├── main.js                  # Entry: WebGL 2 check, then startApp()
├── app.js                   # startApp(): wires store ↔ scene ↔ UI, commands, context loss, starts loop
├── style.css
├── core/
│   ├── createRenderer.js    # WebGLRenderer, pixel ratio, resize handling
│   ├── createCamera.js      # PerspectiveCamera + OrbitControls; CAMERA_LIMITS, CAMERA_HOME
│   ├── createComposer.js    # EffectComposer: RenderPass → UnrealBloomPass → OutputPass (ACES)
│   ├── loop.js              # Single animation loop; owns pause, time scale, dt cap
│   ├── cameraFly.js         # Eased camera move + framingPosition (no tween lib)
│   └── screenshot.js        # Render one frame → PNG download
├── galaxy/
│   ├── random.js            # Seeded PRNG (mulberry32) + Gaussian helper
│   ├── generateGalaxy.js    # PURE: shape + seed → { positions, radiusNorm, colorJitter, sizes, dust } in a UNIT disc
│   ├── Galaxy.js            # Owns Group + star Points + dust Points; setShape, setLook, tick, dispose
│   ├── galaxyMaterial.js    # Star ShaderMaterial; uniforms: uPhase, uDifferential, uSize, uColorInner/Outer, …
│   ├── dustMaterial.js      # Dust-lane ShaderMaterial (normal blending, dark)
│   ├── presets.js           # Preset param objects (spiral, barred, elliptical, irregular)
│   ├── params.js            # Defaults, LIMITS, SHAPE_KEYS, clamp functions
│   └── shaders/             # *.glsl, imported with ?raw
├── scene/
│   ├── GalaxyManager.js     # Map<id, Galaxy>; applies store diffs to the scene
│   ├── diffGalaxies.js      # PURE: prev/next galaxy lists → { added, removed, shapeChanged, lookChanged }
│   ├── starfield.js         # Static background stars
│   └── picking.js           # PURE: ray vs galaxy disc planes → galaxy id
├── state/
│   ├── store.js             # Tiny observable store + pure reducer
│   ├── actions.js           # Action creators (inject id/seed sources for tests)
│   ├── placement.js         # PURE: free spot for a new galaxy near the camera target
│   └── persistence.js       # Serialize/deserialize store to localStorage (versioned, storage injected)
├── util/debounce.js
└── ui/
    ├── controlPanel.js      # lil-gui: Scene / Selected galaxy / Settings folders; dispatches store actions
    ├── pointerInput.js      # Tap/click select, double-tap focus (pure createTapDetector)
    ├── keyboard.js          # PURE keyToCommand + attachKeyboard
    └── notice.js            # Centred message overlay
```

Tests live next to the code: `src/galaxy/generateGalaxy.test.js`, etc.

### Key design decisions

- **Rotation runs on the GPU, phase on the CPU.** Each galaxy accumulates `phase += dt * speed * timeScale` and sends `uPhase`. The vertex shader rotates each star by `uPhase * ω(r)`. Using `time * speed` would make the galaxy jump when speed changes.
- **Damped differential rotation.** `ω(r) = mix(1, 1/(r + 0.25), uDifferential)`. Pure ω ∝ 1/r winds the arms into a smear within a minute (the "winding problem").
- **Rebuild only when shape changes.** `SHAPE_KEYS` (count, arms, spin, randomness, randomnessPower, bulge, barLength, …) and the seed change the geometry. Galaxy radius is `group.scale` (stars are generated in a unit disc); colors are shader uniforms mixed by `aRadiusNorm`; speed, star size and tilt are uniforms or transforms.
- **Picking uses math, not `Raycaster` on `Points`.** Raycasting a `Points` object loops over every vertex. Intersect the ray with each galaxy's disc plane instead.
- **Generation is pure and seeded.** `generateGalaxy(params, seed)` uses a seeded PRNG (e.g. mulberry32), never `Math.random`. The same input gives the same galaxy. This makes it testable and lets persistence store params instead of vertices.
- **Store holds plain data only.** Galaxy entries are JSON-serializable params (`id`, `preset`, `position`, `seed`, shape, color, speed). Three.js objects live only in `GalaxyManager`.
- **One loop.** Only `core/loop.js` calls `requestAnimationFrame` / `setAnimationLoop`.

## Coding conventions

- ES modules, named exports. One main export per file; file name matches it (`Galaxy.js` exports `Galaxy`).
- `PascalCase` for classes, `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants. Shader uniforms start with `u`, attributes with `a`, varyings with `v`.
- 2-space indent, single quotes, semicolons (match `src/app.js`).
- Small factory functions over deep class hierarchies. Use classes only when an object owns GPU resources (`Galaxy`, `GalaxyManager`).
- Every object that creates a geometry, material, or texture has a `dispose()` method and calls it on removal.
- Keep pure logic (generation, params validation, persistence, store) free of `three` scene objects and the DOM so it runs in Node tests. Using `THREE.Color` for math is fine.
- Params are clamped through `params.js` before use. UI ranges read from the same limits.
- Write comments for *why* (physics approximations, shader math), not *what*.

## Testing strategy

**Unit tests (Vitest, Node):** cover all pure modules.

- `generateGalaxy`: array lengths equal `count * 3` (positions/colors); same seed gives identical output; different seeds differ; all points fall within `radius` (plus randomness margin); arm count shapes the angle distribution.
- `params`: clamping and defaults; invalid input (NaN, negative count) falls back safely.
- `store`: add / update / delete / select actions; subscribers fire; deleting the selected galaxy clears the selection.
- `persistence`: round trip preserves state; corrupt or old-version data loads the defaults without a throw.
- `Galaxy` / `GalaxyManager`: run in Node with real `three` objects (no renderer): rebuild vs. uniform-only updates, dispose calls, selection ring, dust settings.
- Input: `keyToCommand`, `createTapDetector`, `pickGalaxy`, `cameraFly` are pure and tested.

**Manual visual checks (run `npm run dev`) after each rendering change:**

1. Create, edit, and delete several galaxies. Deleted galaxies disappear and nothing leaks.
2. Speed slider changes rotation at once, with no stutter or rebuild.
3. Zoom from very close to very far. No clipping inside the near/far range.
4. Reload: the scene restores.
5. Check the frame rate stays smooth with the maximum total particle budget.

To check for GPU leaks, watch `renderer.info.memory.geometries` and `.textures`; the counts must return to the baseline after deletes. In dev, `window.__app` exposes `store`, `actions`, `galaxies`, `renderer`, `loop` and `commands` for console checks.

Do not add WebGL or screenshot tests unless asked; they are slow and flaky in CI.

## Important constraints

- **Performance budget:** max 200 000 particles per galaxy, max 10 galaxies, ~1 000 000 particles total. Target 60 fps on a mid-range laptop GPU. Enforce limits in `params.js` and in the create action.
- **Pixel ratio:** cap at `Math.min(devicePixelRatio, 2)`. Pass it to the shader (`uPixelRatio`) so point size is the same on all screens.
- **Dispose GPU resources** on delete and on rebuild. A geometry rebuild must dispose the old `BufferGeometry` first.
- **No per-frame allocation** in the animation loop (no `new Vector3()` etc. inside `tick`).
- **Debounce rebuilds** from sliders that change geometry (e.g. on `onFinishChange`, or a ~100 ms debounce) so dragging stays smooth.
- **Blending:** galaxy points use `AdditiveBlending`, `depthWrite: false`. Do not enable `depthWrite` on points; it causes black squares.
- **Camera limits:** set OrbitControls `minDistance` / `maxDistance` and the camera `near` / `far` to match, so zoom never passes through the far plane.
- **Bundle:** `vite.config.js` puts `three` in its own chunk (~570 kB) and sets `chunkSizeWarningLimit: 600`. App code is ~65 kB.
- **Persistence is versioned.** Bump the version key when the stored shape changes, and migrate or reset old data.
- **Browser only, no backend.** The app is a static site from `vite build`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `AnonMohak/cc`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
