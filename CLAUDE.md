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
- **Globular clusters**: 4–40 per galaxy (more in bulge-rich galaxies), dense Plummer balls of old stars on slow halo orbits. They are star kind `CLUSTER` (4) inside the normal star geometry (~2–6% of the count): `aOrbit` holds the cluster centre orbit and the `position` attribute holds the star's offset from the centre (`stars.vert.glsl` adds it only for this kind).
- **Supernovae** (`galaxy/supernovae.js`, Settings → Supernovae): a seeded Poisson schedule (mean 9 s of simulation time per galaxy; nothing while paused) picks a star (young/arm stars preferred, never the bright core or cluster stars) and lights one of 4 reused flash points. The flash copies the star's `aOrbit`, so `gs_position` moves it with the star; light curve: fast rise, ~5 s fade, peak above the bloom threshold. The GLSL light curve mirrors `supernovaLight`.
- **Live structure controls**: arm count, winding, density wave, arm contrast, flocculence, dust, diffuse glow and bulge profile change instantly (shader uniforms).
- **Bloom**: lifts only bright cores and stars (threshold 0.45).
- **Lens flare** (`core/LensFlarePass.js`, Settings → Lens flare): a chain of tinted ghost discs on the line from each bright source through the screen centre. It reads the bloom pass's blurred mip 1 (no extra blur), keeps only the part above `FLARE_THRESHOLD`, and adds it before tone mapping. It runs only while bloom runs (so not on Low/Minimal). Sources near the screen centre cast no ghosts (they would only wash out a focused core or a black hole's shadow).
- **Diffraction spikes** (`shaders/chunks/spikes.glsl`, Settings → Star spikes: JWST 6+2 / Hubble 4 / Off): drawn inside point sprites, aligned to the screen like real telescope optics. On the 30 brightest background stars (a second sprite layer in `starfield.js`) and on supernova flashes (their sprite grows ×4). `spikeStyle(setting, tier)` in `quality.js` turns them off on Low/Minimal.
- **Cinematic pass** (`core/CinematicPass.js`, Settings → Cinematic): vignette, film grain and lateral chromatic aberration in one full-screen pass after `OutputPass` (display space). `cinematicEnabled(settings, tier)` in `quality.js` skips the pass when all three are 0 and on Low/Minimal.
- **Wavelength view modes** (`galaxy/bands.js`, Settings → View, V key cycles): visible, Hubble palette (SHO: Hα gold, [O III] teal), JWST infrared (dust nearly transparent and glowing, stars dim), radio 21 cm (no stars; gas glows along the arms with a central hole) and X-ray (~0.5% of stars as compact sources, hot inner gas, bright supernovae). Each band is a row of gains and colour matrices sent as `uBand*` uniforms (`applyBandUniforms`); visible is the identity. The volume adds a gas/dust emission term (from the same dust density) and applies the colour matrix once after the march. Sky and field stars get a tint. Dropped X-ray stars are moved outside the clip volume (a 0 px point still draws 1 px on some GPUs).
- **Central black holes** (`galaxy/blackHole.js` pure math, `core/BlackHolePass.js`, Settings → Black holes: On / On + jets / Off): styled after Gargantua (*Interstellar*), not strict physics. Size follows the bulge (none below `MIN_BULGE`), exaggerated (`RS_TYPICAL` 0.009) so it resolves only when zoomed toward a core (lens fades in from 2 to 4 px shadow). The disc and jet axis is seeded per galaxy (`discAxis`, uniform on the sphere; not stored), so any galaxy can show the edge-on look. One screen pass after bloom and lens flare (so neither floods the shadow), before tone mapping, only while a hole is resolved (`update()` disables it otherwise; off on Minimal): each ray is bent once at closest approach by the Schwarzschild deflection (`deflection`, mirrored in GLSL), which gives the shadow, the far disc arching over and under the hole, and thin photon rings (≥ ~1 px, energy kept). Screen light is read on a plane `SOURCE_DEPTH` (40 Rs) behind the hole, not at infinity (else the HDR bulge cusp becomes a white Einstein ring), and dimmed toward the hole (a cleared cavity, back to full at `LENS_REACH`); rays bent off the screen see the sky texture (shared `scene/sky.js` uniforms) plus procedural stars. The disc: Shakura–Sunyaev profile, no Doppler beaming (both sides equally bright, like the film), gold `agnHot`/`agnCool` colours per band, fine concentric streaks (two noise reads at an explicit LOD), slow Keplerian shear, a soft haze for thickness, a warm glow halo and an always-on horizontal lens streak. Jets (`jet.*.glsl`, gold) are camera-facing strips along `uJetAxis` with a 1.5 px minimum width (energy kept). Bands scale them (`agnGain`, `jetGain`).
- **Background sky** (`scene/sky.js`, model in `scene/skyMap.js`): a faint Milky Way band (thicker and warmer toward the galactic centre, star clouds, a filamentary dust rift, red/blue nebulae near the plane) baked once into a 1024×512 equirectangular sRGB texture in a Web Worker (`skyWorker.js`; main-thread fallback at 512×256), drawn on a camera-following sphere: one texture fetch per pixel. The static starfield is denser along the band (`starDensity`). Settings → Milky Way sky toggles it. Keep it far below the bloom threshold (`SKY_INTENSITY`).
- **Auto exposure** (`core/autoExposure.js` pure, `core/ExposureMeterPass.js`, Settings → Auto exposure, on by default): only darkens. A 64×64 RGBA8 meter of the HDR frame before `OutputPass` (so no feedback loop: it measures before the exposure it sets) stores packed log₂ luminance, a bright mask × centre weight and the weight; `readRenderTargetPixelsAsync` reads it back without a stall (one read in flight). `targetFactor` brings the bright, centre-weighted part to `KEY` (factor ≤ 1, ≥ 1/32, blended in by coverage, so black space never triggers it); `adapt` eases in log space on real time (darken ~0.5 s, brighten ~2 s). Final exposure = slider × factor. The render gate stays active until settled, and a late reading wakes it. Turning it off restores factor 1 at once; a failed readback disables it. `?fps` shows the factor.
- **Global controls**: pause/resume, time scale, quality (Auto or a fixed tier), exposure (auto + bias), bloom, dust on/off and amount, auto-rotate camera.
- **FPS readout**: add `?fps` to the URL — frame rate, GPU name, active quality tier and GPU ms per pass (`core/gpuTimer.js`).
- **Persistence**: the scene saves to `localStorage` and restores on reload; "Reset scene" clears it.
- **Recording** (`core/recorder.js`, Record folder): screenshot (P); video via MediaRecorder on `canvas.captureStream` (R to start/stop, WebM or MP4, auto-stop at 60 s); 4-second GIF with a dependency-free encoder (`util/gif.js`: median-cut palette, ordered dither, LZW). GIF frames are copied right after each render, so no `preserveDrawingBuffer`.
- **Sharing** (`state/shareCodec.js`): copy a share link (scene → deflate → base64url in `#scene=`; opened links go through `deserialize` validation, then the hash is removed), export/import the scene as JSON (`ui/fileIO.js`).
- **Universe generator** (`state/universe.js`, pure + seeded): replace the scene with a cluster (ellipticals in the core, spirals outside — morphology–density relation) or a filament (mostly spirals along an S-curve). Stays inside the galaxy/star budgets, never overlaps galaxies, frames the camera on the group, and is one undo step.
- **HUD** (`ui/hud.js`, math in `ui/hudMath.js`): clickable galaxy name labels, a light-year scale bar (1 world unit = 9,000 ly, `LY_PER_WORLD_UNIT`) and a top-down minimap (click a galaxy to fly to it). Each part toggles in Settings → HUD; labels start off.
- **Undo / redo** (`state/history.js`): galaxy changes only (not selection or settings); bursts within 400 ms are one step. Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y, and panel buttons.
- **Camera modes** (app.js `setCameraMode`): orbit (default); free-fly (`core/flyControls.js`: WASD, Q/E, Shift, drag to look; OrbitControls disabled, target handed back on exit); guided tour (`core/tour.js` pure state machine: fly to each galaxy, then orbit; any drag/scroll or Esc stops). Focus always returns to orbit.
- **Keyboard**: Space pause · N add · F focus · Delete remove · Esc leave camera mode / deselect · H show/hide panel · P screenshot · R record video · T tour · G free-fly · V next view mode · Ctrl+Z / Ctrl+Shift+Z undo/redo (`ui/keyboard.js`).
- **Start box** (`index.html` + `ui/startScreen.js`): static HTML with inline CSS, so the first paint is dark and styled before the JS loads. It blurs the live scene (`backdrop-filter`), shows touch or mouse controls via `(pointer: coarse)`, and says "Loading…" until the first frame renders, then "Click/Tap anywhere to start". On every load. While open it swallows pointer and key input (window capture listener), so the start click never selects/orbits and Space never pauses; Auto quality skips those frames (the blur costs GPU). Removed from the DOM after a 0.3 s fade.
- **Panel visibility** (`ui/panelToggle.js`): the lil-gui panel starts hidden on every load (desktop and phone) behind a "Controls" button in the top-right corner; "Hide ✕" in the panel title bar (a separate absolutely-positioned button: the title is itself a `<button>`) puts it away. H toggles the same state. The root title no longer collapses (`gui.openAnimated` is a no-op). Both fade with opacity + visibility (150 ms, none with reduced motion); the hidden one is `inert`. UI state only, never saved. Hide-button CSS is scoped under `.lil-gui` because lil-gui's `.lil-gui button` rule loads later and would win.
- **Look**: UI font JetBrains Mono (`public/fonts/`, Latin woff2 400/600, OFL), `--mono` in `index.html`. The lil-gui panel is translucent glass (`style.css`); on phones it is 220 px wide and its width comes from CSS, not the GUI `width` option (inline wins).
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
│   ├── createComposer.js    # EffectComposer: scene → UnrealBloomPass → LensFlarePass → BlackHolePass → ExposureMeterPass → OutputPass (ACES) → CinematicPass
│   ├── BlackHolePass.js     # Black-hole lensing, shadow and accretion disc (screen pass)
│   ├── LensFlarePass.js     # Lens-flare ghosts from the bloom mips
│   ├── ExposureMeterPass.js # Auto-exposure meter + async readback
│   ├── autoExposure.js      # PURE: meter decode, target factor, eye-like adaptation
│   ├── CinematicPass.js     # Vignette, film grain, chromatic aberration (one ShaderPass)
│   ├── loop.js              # Single animation loop; owns pause, time scale, dt cap
│   ├── cameraFly.js         # Eased camera move + framingPosition (no tween lib)
│   ├── flyControls.js       # Free-fly WASD camera (pure moveDirection / applyLook)
│   ├── GalaxyScenePass.js   # Background → low-res volumes (composite) → stars; replaces RenderPass
│   ├── layers.js            # Render layers: STARS, VOLUME, BACKGROUND
│   ├── quality.js           # Quality tiers + helpers; qualityGovernor.js picks one (Auto)
│   ├── renderGate.js        # Render on demand
│   ├── gpuTimer.js          # GPU pass timings for ?fps
│   ├── tour.js              # Guided tour state machine
│   ├── screenshot.js        # Render one frame → PNG download
│   └── recorder.js          # Video (MediaRecorder) + GIF capture
├── galaxy/
│   ├── random.js            # Seeded PRNG (mulberry32) + Gaussian helper
│   ├── densityModel.js      # PURE JS mirror of shaders/chunks/model.glsl: orbits, arms, dust column, black-body, Sérsic, bounds
│   ├── generateGalaxy.js    # PURE: shape + seed → orbital elements (aOrbit vec4, aStar vec3) + H II population
│   ├── galaxyUniforms.js    # One uniform set per galaxy, shared BY REFERENCE by all its materials
│   ├── starMaterials.js     # Star + H II ShaderMaterials (additive points)
│   ├── volumeMaterial.js    # Raymarched body (back faces, dst = emission + dst·transmittance)
│   ├── Galaxy.js            # Owns group + volume Mesh + stars Points + H II Points; set{Shape,Structure,Look,Motion}, tick, dispose
│   ├── emphasis.js          # PURE: selection brightness targets + frame-rate independent ease
│   ├── supernovae.js        # PURE: supernova light curve, Poisson schedule, site choice
│   ├── bands.js             # PURE: wavelength view modes (gains + colour matrices per band)
│   ├── blackHole.js         # PURE: black-hole size, disc axis, light deflection, lens selection
│   ├── lod.js               # PURE: on-screen footprint → volume steps + star LOD (fewer, brighter far stars)
│   ├── presets.js           # spiral (M51/M101), barred (NGC 1300), elliptical (M87), irregular (LMC)
│   ├── catalogue.js         # Real galaxies: facts + params; tiltForInclination, catalogueViewDirection
│   ├── discMap.js           # PURE bake of in-plane arms/bar/dust (pattern frame) → half-float texture
│   ├── noiseTexture.js      # Shared tileable fbm texture (flocculence, dust filaments)
│   ├── params.js            # LIMITS + defaults for shape / structure / look / motion, clamp functions
│   └── shaders/             # *.glsl via ?raw; chunks/{model,noise,stars,spikes}.glsl joined by glsl.js
├── scene/
│   ├── GalaxyManager.js     # Map<id, Galaxy>; applies store diffs to the scene
│   ├── diffGalaxies.js      # PURE: prev/next galaxy lists → { added, removed, shapeChanged, lookChanged }
│   ├── starfield.js         # Static background stars (denser along the band)
│   ├── sky.js               # Milky Way sky sphere; texture from skyWorker.js
│   ├── skyMap.js            # PURE sky model + equirect bake (no three.js: runs in the worker)
│   ├── skyWorker.js         # Bakes the sky map off the main thread
│   └── picking.js           # PURE: ray vs galaxy disc planes → galaxy id
├── state/
│   ├── store.js             # Tiny observable store + pure reducer
│   ├── actions.js           # Action creators (inject id/seed sources for tests)
│   ├── placement.js         # PURE: free spot for a new galaxy near the camera target
│   ├── history.js           # Undo/redo stack over store galaxies (grouped steps)
│   ├── shareCodec.js        # Scene ⇄ URL-safe code (CompressionStream deflate-raw)
│   ├── universe.js          # PURE seeded cluster/filament generator
│   └── persistence.js       # Serialize/deserialize store to localStorage (versioned, storage injected)
├── util/debounce.js
├── util/formatCount.js        # Short star counts: 80k, 1m
├── util/gif.js               # PURE GIF89a encoder (palette, dither, LZW)
└── ui/
    ├── controlPanel.js      # lil-gui: Scene / Selected galaxy / Settings folders; dispatches store actions
    ├── panelToggle.js       # Controls / Hide buttons: panel hidden by default
    ├── pointerInput.js      # Tap/click select, double-tap focus (pure createTapDetector)
    ├── keyboard.js          # PURE keyToCommand + attachKeyboard
    ├── fpsMeter.js          # ?fps readout (own clock; loop dt is capped)
    ├── hud.js / hudMath.js  # Labels, scale bar, minimap (pure layout math in hudMath)
    ├── infoCard.js          # Facts card for catalogue galaxies
    ├── fileIO.js            # Download text / pick a file
    ├── notice.js            # Centred message overlay
    └── startScreen.js       # Start box: pure loading → ready → closed state + DOM wiring
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
5. Check the frame rate (`?fps`) on an **integrated GPU** (the design target, e.g. Intel UHD 630 at 1080p) with the maximum particle budget and with the camera inside a galaxy, at each quality tier and with Auto.
6. Look at each preset face-on, at 45° and edge-on; edge-on spirals must show a dark midplane dust lane.

Headless browsers (SwiftShader) render on the CPU (~0.1–0.4 s per frame): use them for correctness, screenshots and **relative** speed (fragment cost scales the same way), never for absolute fps or wall-clock-sensitive checks.

To check for GPU leaks, watch `renderer.info.memory.geometries` and `.textures`; the counts must return to the baseline after deletes. In dev, `window.__app` exposes `store`, `actions`, `galaxies`, `renderer`, `loop` and `commands` for console checks.

Do not add WebGL or screenshot tests unless asked; they are slow and flaky in CI.

## Important constraints

- **Performance budget:** max 200 000 particles per galaxy, max 10 galaxies, ~1 000 000 particles total. Target 60 fps on a mid-range laptop GPU. Enforce limits in `params.js` and in the create action.
- **Performance target: integrated and mobile GPUs.** Trade visual fidelity for frame rate when needed. GPU cost is mostly the raymarched volume (covered pixels × steps × per-step work); keep all three small:
  - **Pixels:** volumes render into a reduced-resolution target in `core/GalaxyScenePass.js` (tier `volumeScale` 0.25–0.75), then composite with a small tent blur. Never move the volume back to full resolution.
  - **Per-step work:** nothing procedural in the step loop. In-plane fields (arms, bar, dust lanes) are baked into `uDiscMap` (`galaxy/discMap.js`, pattern frame, rotated at sample time); noise comes from the shared `noiseTexture.js`. New in-plane features go into the bake, not the shader loop. Loop invariants stay outside the loop.
  - **Steps:** march only (disc slab ∩ cylinder) ∪ bulge ellipsoid (`marchInterval`, mirrored in JS); steps = chord / `uStepLength`, capped by the tier and `lod.js`. Keep `QUALITY.*.steps` ≤ shader `MAX_STEPS` (96). Fade emission to 0 before the box and ellipsoid edges.
  - **Quality tiers** (`core/quality.js`) bundle every cost knob; **Auto** (default) uses `core/qualityGovernor.js` on real frame times (hysteresis; very slow frames are clamped, not ignored). Phones start at Low.
  - **Star LOD** (`lod.js` `starLod`): with many galaxies, star vertices are the main cost (10 far galaxies: ~95% of the frame). A far galaxy draws ~4 stars per covered pixel (min 3,000) via `setDrawRange`, and `uLodGain` (≤ 8) keeps its total light. Tier cap first, then LOD.
  - **Render on demand** (`core/renderGate.js`): no GPU frame when paused and idle; anything that changes the picture must `invalidate()` the gate or report itself active.
- **Bloom:** threshold 0.45, radius 0.3, rendered at half resolution; off on Low/Minimal. A lower threshold floods dust lanes; a wider radius paints a halo far around bright cores.
- **Pixel ratio:** capped per tier (1–2). Pass it to the shader (`uPixelRatio`) so point size is the same on all screens. No MSAA (`antialias: false`): everything goes through the composer.
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
