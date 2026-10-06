# Galaxy

An interactive 3D galaxy sandbox in the browser. Users create, edit, and delete realistic procedural galaxies and fly the camera around them.

> Status: feature-complete (M0–M9) plus the visual overhaul (V1–V6: density-wave stars + raymarched volume). New work: keep tests passing and `npm run build` clean before each LOCAL commit (no pushes until GitHub is set up). Ideas backlog: `future-suggestions.md`.

## Features

Required:

- Create and delete galaxies (many can exist at once, each at its own position).
- Change a galaxy's size, particle count, colors (core and edge), and shape.
- Change a galaxy's rotation speed (including reverse and zero).
- Zoom in and out (mouse wheel / pinch, via OrbitControls).

Additional:

- **Presets**: spiral, barred spiral, elliptical, irregular. A new galaxy starts from a preset.
- **Real-galaxy catalogue** (`galaxy/catalogue.js`): M31, M51, M101, M104, M87, LMC with real facts in an info card (`ui/infoCard.js`). Size follows the real diameter; the true inclination is shown from the home camera view, and Focus keeps it.
- **Selection**: click or tap a galaxy to select it; the selected galaxy brightens ×1.15 and the others dim to ×0.75 (no overlay). Double-click / double-tap or "Focus" flies the camera to it.
- **Realistic rendering** (researched against real galaxies): density-wave spiral arms, black-body star colours, young blue stars that light up on arm crests, pink H II nebulae, a Sérsic bulge, an exponential × sech² disc and dust lanes on the inner arm edges (edge-on: a midplane dust lane).
- **Live structure controls**: arm count, winding, density wave, arm contrast, flocculence, dust, diffuse glow and bulge profile change instantly (shader uniforms).
- **Bloom**: lifts only bright cores and stars (threshold 0.45).
- **Background starfield**: a static far starfield.
- **Global controls**: pause/resume, time scale, quality (volume step budget), exposure, bloom, dust on/off and amount, auto-rotate camera.
- **FPS readout**: add `?fps` to the URL.
- **Persistence**: the scene saves to `localStorage` and restores on reload; "Reset scene" clears it.
- **Screenshot**: export the canvas as PNG.
- **Sharing** (`state/shareCodec.js`): copy a share link (scene → deflate → base64url in `#scene=`; opened links go through `deserialize` validation, then the hash is removed), export/import the scene as JSON (`ui/fileIO.js`).
- **Undo / redo** (`state/history.js`): galaxy changes only (not selection or settings); bursts within 400 ms are one step. Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y, and panel buttons.
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
│   ├── densityModel.js      # PURE JS mirror of shaders/chunks/model.glsl: orbits, arms, dust column, black-body, Sérsic, bounds
│   ├── generateGalaxy.js    # PURE: shape + seed → orbital elements (aOrbit vec4, aStar vec3) + H II population
│   ├── galaxyUniforms.js    # One uniform set per galaxy, shared BY REFERENCE by all its materials
│   ├── starMaterials.js     # Star + H II ShaderMaterials (additive points)
│   ├── volumeMaterial.js    # Raymarched body (back faces, dst = emission + dst·transmittance)
│   ├── Galaxy.js            # Owns group + volume Mesh + stars Points + H II Points; set{Shape,Structure,Look,Motion}, tick, dispose
│   ├── emphasis.js          # PURE: selection brightness targets + frame-rate independent ease
│   ├── lod.js               # PURE: on-screen footprint → volume step count
│   ├── presets.js           # spiral (M51/M101), barred (NGC 1300), elliptical (M87), irregular (LMC)
│   ├── catalogue.js         # Real galaxies: facts + params; tiltForInclination, catalogueViewDirection
│   ├── params.js            # LIMITS + defaults for shape / structure / look / motion, clamp functions
│   └── shaders/             # *.glsl via ?raw; chunks/{model,noise,stars}.glsl joined by glsl.js
├── scene/
│   ├── GalaxyManager.js     # Map<id, Galaxy>; applies store diffs to the scene
│   ├── diffGalaxies.js      # PURE: prev/next galaxy lists → { added, removed, shapeChanged, lookChanged }
│   ├── starfield.js         # Static background stars
│   └── picking.js           # PURE: ray vs galaxy disc planes → galaxy id
├── state/
│   ├── store.js             # Tiny observable store + pure reducer
│   ├── actions.js           # Action creators (inject id/seed sources for tests)
│   ├── placement.js         # PURE: free spot for a new galaxy near the camera target
│   ├── history.js           # Undo/redo stack over store galaxies (grouped steps)
│   ├── shareCodec.js        # Scene ⇄ URL-safe code (CompressionStream deflate-raw)
│   └── persistence.js       # Serialize/deserialize store to localStorage (versioned, storage injected)
├── util/debounce.js
└── ui/
    ├── controlPanel.js      # lil-gui: Scene / Selected galaxy / Settings folders; dispatches store actions
    ├── pointerInput.js      # Tap/click select, double-tap focus (pure createTapDetector)
    ├── keyboard.js          # PURE keyToCommand + attachKeyboard
    ├── fpsMeter.js          # ?fps readout (own clock; loop dt is capped)
    └── notice.js            # Centred message overlay
```

Tests live next to the code: `src/galaxy/generateGalaxy.test.js`, etc.

### Key design decisions

- **Galaxy entry = four groups.** `shape` (star populations → geometry rebuild), `structure` (arms, dust, volume → uniforms), `look` (size, colours, tilt, position → uniforms/transforms), `motion` (speed, differential, pattern speed → uniforms). `diffGalaxies` rebuilds only on `SHAPE_KEYS`/seed changes.
- **Arms are a density wave, computed on the GPU.** Disc stars store orbital elements, not positions. The vertex shader places each star at r = a·(1 + e·cos ψ), ψ = m(θ − φ(a)), with a log-spiral φ(a) that also turns rigidly at the pattern speed. Orbits crowd along the arms; stars flow through them; the pattern never winds up. Arm count, winding and eccentricity are therefore live uniforms.
- **Phase on the CPU.** Each galaxy accumulates `phase += dt * speed` and sends `uPhase`; a speed change never makes stars jump.
- **Hybrid rendering, one model.** Draw order per galaxy: volume (renderOrder 0) → stars (1) → H II (2). The volume and the stars call the same GLSL model chunk (`model.glsl`, mirrored and unit-tested in `densityModel.js`), so arms, bar and dust agree. Stars get analytic dust toward the camera (`gs_dustTau`) instead of depth sorting.
- **Change the model in two places.** Any formula change goes into `densityModel.js` AND `chunks/model.glsl`; `glsl.test.js` pins shared constants.
- **Picking uses math, not `Raycaster` on `Points`.** Raycasting a `Points` object loops over every vertex. Intersect the ray with each galaxy's disc plane instead.
- **Generation is pure and seeded.** `generateGalaxy(params, seed)` uses a seeded PRNG (e.g. mulberry32), never `Math.random`. The same input gives the same galaxy. This makes it testable and lets persistence store params instead of vertices.
- **Store holds plain data only.** Galaxy entries are JSON-serializable params (`id`, `name`, `preset`, `seed`, shape, structure, look, motion). Three.js objects live only in `GalaxyManager`. Saved state is v2 (`galaxy-sandbox:v2`); v1 saves migrate once (`migrateV1`).
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
5. Check the frame rate (`?fps`) with the maximum particle budget and with the camera inside a galaxy, at each Quality level.
6. Look at each preset face-on, at 45° and edge-on; edge-on spirals must show a dark midplane dust lane.

Headless browsers (SwiftShader) render on the CPU at ~1 s per frame with the volume on: use them for correctness and screenshots, never for speed or for wall-clock-sensitive checks.

To check for GPU leaks, watch `renderer.info.memory.geometries` and `.textures`; the counts must return to the baseline after deletes. In dev, `window.__app` exposes `store`, `actions`, `galaxies`, `renderer`, `loop` and `commands` for console checks.

Do not add WebGL or screenshot tests unless asked; they are slow and flaky in CI.

## Important constraints

- **Performance budget:** max 200 000 particles per galaxy, max 10 galaxies, ~1 000 000 particles total. Target 60 fps on a mid-range laptop GPU. Enforce limits in `params.js` and in the create action.
- **Volume fill rate:** the raymarch costs (covered pixels × steps). Keep `QUALITY.*.steps` ≤ the shader `MAX_STEPS` (96), keep the box tight (`volumeBounds`), and keep `lod.js` cutting steps for full-screen and tiny galaxies. Fade emission to 0 at the box faces so the box never shows.
- **Bloom:** threshold 0.45, radius 0.3. A lower threshold floods dust lanes; a wider radius paints a halo far around bright cores.
- **Pixel ratio:** cap at `Math.min(devicePixelRatio, 2)`. Pass it to the shader (`uPixelRatio`) so point size is the same on all screens.
- **Dispose GPU resources** on delete and on rebuild. A geometry rebuild must dispose the old `BufferGeometry` first.
- **No per-frame allocation** in the animation loop (no `new Vector3()` etc. inside `tick`).
- **Debounce rebuilds** from sliders that change geometry (e.g. on `onFinishChange`, or a ~100 ms debounce) so dragging stays smooth.
- **Blending:** star and H II points use `AdditiveBlending`, `depthWrite: false` (depth writes on points draw black squares). The volume uses `CustomBlending` One / SrcAlpha (emission + transmittance) on `BackSide`, `depthWrite: false`.
- **Camera limits:** set OrbitControls `minDistance` / `maxDistance` and the camera `near` / `far` to match, so zoom never passes through the far plane.
- **Bundle:** `vite.config.js` puts `three` in its own chunk (~570 kB) and sets `chunkSizeWarningLimit: 600`. App code is ~85 kB.
- **Persistence is versioned.** Bump the version key when the stored shape changes, and migrate or reset old data.
- **Browser only, no backend.** The app is a static site from `vite build`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `AnonMohak/cc`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
