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
- **Standalone black holes** (Scene → Add black hole; `BLACK_HOLE_TEMPLATE` in `presets.js`): a scene entry with `kind: 'blackhole'` and a fifth param group `hole` (`clampHole`: size as Rs / object radius, disc size in Rs, disc brightness, glow = halo + haze, inner/outer colours, jets, lens streak; all live uniforms). It reuses `Galaxy` for a sparse round star cloud (6k stars, no volume, no supernovae), so selection, picking, focus, undo, saving, sharing and the HUD work unchanged; galaxy entries have no `kind`/`hole` fields. It counts toward the galaxy and star budgets. They draw on every tier and follow the selection emphasis. Galaxies have no central black hole. Focus flies to the film shot (`filmShot` in `app.js`: `FILM_ELEVATION_DEG` 20° above the disc plane, so the near disc hides the bottom of the shadow; 0.9× the distance at which the disc fills the view).
- **Start scene**: every load opens on the **animation black hole**: a standalone black hole with `intro: true`. A saved scene with objects waits (`splitIntroStart` in store.js; app.js `pendingScene`, saved settings apply at once) and comes back when the intro ends for any reason: watched to the end and then a press, a press or wheel, the panel, a camera command or N (`restoreSavedScene`: loads it with the current settings, clears undo, flies to `CAMERA_HOME`; N then adds into it). While it waits, saves write the waiting scene, not the intro. A share link or import drops it. A fresh scene (first visit or Reset scene) is the animation black hole too: The first add of anything (galaxy, real galaxy, black hole; panel or N) replaces it in the same `galaxy/add` action (one undo step; `withoutIntro` in `store.js` also keeps it out of the budget and the placement), and app.js then focuses the new object. Edits do not clear the flag. Later adds remove nothing. A black hole the user adds never has the flag. The camera is not saved, so every load of the intro scene (`isIntroScene` in store.js: exactly the animation black hole) starts at the film shot; other scenes start at `CAMERA_HOME`.
- **Intro fall** (`core/blackHoleFall.js` pure state machine + curves, `ui/fallOverlay.js`, camera mode `'fall'` in app.js): after the start box closes, 5 s of idle on the intro scene starts a ~60 s fall. The camera orbit already starts in the wait (camera mode `'fall'` from the start box close; the distance holds): `fallAngle` (closed form on the wait + fall clock) eases in from rest, makes one full turn (`ORBIT_TURN`) by the plunge at `PLUNGE_START_U` (0.85) of the fall, then turns `PLUNGE_ANGLE` (0.45π) more, prograde with the disc and with a continuous speed. The camera eases to the film shot's 20° above the disc plane, and moves in log-distance with an u³ ease down to 1.2 Rs. The disc spins up (`Galaxy.setHoleSpin`, an accumulated `holeTime`), the fov widens by up to 25°, the lens warps more and more from half-way (`fallPose.warp` → `Galaxy.setHoleWarp` → `uLensWarp`: more bend `WARP_BEND`, a wider reach `warpedReach`, deeper source light and a swirl `WARP_SWIRL`; the exact lens uses `WARP_SHRINK` (a smaller impact parameter: more bend, a bigger shadow) and `WARP_SWIRL_EXACT` instead; all in `blackHole.js`; it eases out over the escape), and a DOM vignette and black (no GPU cost, every tier) close in. Fallen in, it holds black and draws no frames. A pointer press or wheel in the wait hands the camera back to orbit where it is (the same press orbits). A pointer press or wheel in the fall (capture phase; on the canvas it is swallowed), opening the panel, a camera command (F, G, T, Reset view, Reset scene) or a scene change ends it: fade in, fov eases back, fly back to the film shot (1.5 s). It runs once per page load, for everyone (also with `prefers-reduced-motion`). The start box shows an italic "Stay still to start the animation" hint (`#start-hint`, hidden by app.js unless the scene is the intro scene). While the fall waits and falls, a Screen Wake Lock (`ui/wakeLock.js`; re-taken when the page is shown again, a no-op where unsupported or refused) keeps a phone screen on, so the tap that would wake it never ends the fall; it is released once fallen in or done. The duration is time-based (60 s), so it does not depend on the start distance.
- **Real-galaxy catalogue** (`galaxy/catalogue.js`): M31, M51, M101, M104, M87, LMC with real facts in an info card (`ui/infoCard.js`). Size follows the real diameter; the true inclination is shown from the home camera view, and Focus keeps it.
- **Selection**: click or tap a galaxy to select it; the selected galaxy brightens ×1.15 and the others dim to ×0.75 (no overlay). Double-click / double-tap or "Focus" flies the camera to it.
- **Realistic rendering** (researched against real galaxies): density-wave spiral arms, black-body star colours, young blue stars that light up on arm crests, pink H II nebulae, a Sérsic bulge, an exponential × sech² disc and dust lanes on the inner arm edges (edge-on: a midplane dust lane).
- **Globular clusters**: 4–40 per galaxy (more in bulge-rich galaxies), dense Plummer balls of old stars on slow halo orbits. They are star kind `CLUSTER` (4) inside the normal star geometry (~2–6% of the count): `aOrbit` holds the cluster centre orbit and the `position` attribute holds the star's offset from the centre (`stars.vert.glsl` adds it only for this kind).
- **Collisions = consumption** (`galaxy/consumption.js` pure timeline, `galaxy/collision.js` pure physics, `scene/CollisionSim.js` GPU, `shaders/collisionStep.glsl` + `chunks/simInit.glsl`; Selected object → Collision: partner, a who-eats-whom line, Pass distance in mean radii, Approach speed × escape speed at contact, Collide / Stop collision). Black holes and galaxies alike, and it always ends with one object: a black hole eats a galaxy; the bigger hole (Rs) eats the smaller; the smaller galaxy (radius) merges into the bigger; a tie: the starter (the selected one) wins (`pickWinner`). Masses (`bodyPhysics`): a galaxy ∝ R² (`G_SIM`, softening 0.3 R); a hole ∝ Rs, a default hole = `HOLE_MASS` (4) default galaxies, softening half its disc. **1. Opening pass** (stage `'pass'`, the old free collision): both centres move under their mutual gravity (leapfrog, zero total momentum, `designOrbit`; `createCentres` with `friction: false`, so the pass is a clean fly-by); far apart they fast-forward (`warpFactor`) with analytic stars; at contact (`CONTACT` × (rA + rB)) one GPU pass (`collisionInit.glsl`) hands the stars to the simulation (both galaxies, or a hole's victim; a winning hole's own cloud stays analytic), in an inertial frame; tides make tails and bridges; gas fades by `disruption`. **2. Handover** (`watchPass`): after the closest approach, once the distance is back to `PASS_RATIO` (1.5) × it, or `PASS_HOLD` (4 s) after it, on a head-on merge, or after `PASS_MAX`. **3. Consumption** (stage `'spiral'`): the winner comes to rest (`SETTLE_SECONDS` e-fold; its kinematic acceleration goes into the indirect term so its stars come along; the drag is relative to its velocity, `uWinnerVel`); the victim's path blends from the physics path into the spiral over `BLEND_SECONDS` (3 s). Spiral (`designSpiral`, `spiralPose`, closed form): r = r0 (1 − τ)^¼ from the handover distance, dθ/dt = W · ω(r) with ω the circular speed of the real softened pull, so freed stars move with the path; one time factor W (`MIN_TIME_LAPSE`–`MAX_TIME_LAPSE`, ~1.5 for two default galaxies) makes the turn count exact (`turnsFor`: 5 for two holes in 24 s, 10–12 for a hole eating a galaxy in 75 s, 3 for two galaxies in 75 s; `INSPIRAL_SECONDS`, simulation time); star-time rates are path rates ÷ W (accelerations ÷ W²); a merger's analytic spin follows W (`Galaxy.timeScale`). The victim loses its pull as it is eaten (`victimPull`: a hole by its size, a galaxy from 25% to 85% of the spiral), so its stars come free. Star states (`STATE`; w of the position texture = state · 2 + crest): BOUND (empty texture before contact: analytic), FREE (gravity + a drag toward a hole winner, `freeDrag`), ACCRETE (inside `ACC_RADIUS` × the disc: an analytic spiral in the hole's disc plane, stable at any step, Kepler speed capped at `ACC_SPIN_MAX`, an infall that meets the deadline, `accretionRate`), GONE (inside `CAPTURE_RS` = 1.7 Rs). Hole vs hole: from the handover the victim's Rs and disc shrink by 1/5 per turn (`victimHoleScale`, `Galaxy.setHoleLook`) and its disc matter leaves in a gold stream (a second small simulation, `STREAM` in `collisionStep.glsl`, `stream.vert.glsl`: born at L1/L2 at the rate of the mass loss). Matter near a hole winner gets redder, dimmer and slower toward the capture radius (`chunks/consume.glsl` `cs_infall`); matter in front of the hole inside its lens reach draws after the lens pass on layer `JETS` (`AFTER_LENS`, `cs_afterLens`). For a hole winner the victim's lost mass goes into the hole (mass kept), a weak inward pull grows over 15–60% of the spiral (`infallPull`) so the tidal tails fall back, the drag stays low (`MAX_FREE_DRAG`), and the capture zone grows from 40% of the spiral through the drain (`consumeReach`, to `DRAIN_REACH` ×), so the debris spirals in gradually. **4. End**: holes drain gradually (`DRAIN_SECONDS`: 4 s for a hole, 10 s for a galaxy; the accretion deadline is `DRAIN_DONE` 70% of it, then the victim's last light fades, `drainFade`); galaxies fade from the simulated stars to a remnant preview (`GalaxyManager.createDetached`, built ahead in a Web Worker: `galaxy/generationCache.js` + `generateWorker.js`, so the rebuild at the commit does not stall; `Galaxy.setShape` skips the disc-map bake when only the count changed). The result goes into the store in one change (`galaxy/consume`, `consumeResult` plus the winner's rest position: a hole's Rs × `GROWTH` 1.2 through `hole.size`, at its limit through `look.radius`; a galaxy's radius × 1.2 and the star counts added, 200k limit; one undo step puts both back at their start; a selected victim hands the selection to the winner); then the after-effects (`afterSeconds`): the feeding flare (`feedLevel`, jets shown even when off, `uJetGain`, eased in as feed²), the merger flash (`flashGain`) and a gravitational-wave ripple (`rippleState` → `uLensRipple`) for two holes; a starburst (`starburstLevel` → `uStarburst`) after a merger. Stop part-way puts both back. One collision at a time; nothing transient is saved. The pair's move/reshape controls are locked (`collisionBroken`: `LOCKED_LOOK_KEYS`, `LOCKED_HOLE_KEYS`); any other store change to either object stops it (the commit's own change is ignored), as does a lost context. Needs `EXT_color_buffer_float` (`collisionSupported`). The HUD reads live positions. Auto camera (camera mode `'consume'`, `core/consumeCamera.js`; a cinema mode: an open controls panel hides when it starts, the Controls button brings it back): close on the pair (`frameRadius`, a black hole by its disc, filling `FILL` 85% of the half view via `framingDistance`; `orbitViewTan` fits the near-flat orbit by the screen width, or by the height × sin(view angle)), the common centre in the opening pass, then the winner, moving in as the victim spirals in down to the winner's end size; at least 15° above the winner's disc; a drag, scroll or Esc hands it back. Rumble (`soundscape.setRumble`, pure `rumbleLevel` / `rumbleCutoff`): louder with each turn, the cutoff follows the orbit frequency, it dies away after the merge.
- **Supernovae** (`galaxy/supernovae.js`, Settings → Supernovae): a seeded Poisson schedule (mean 9 s of simulation time per galaxy; nothing while paused) picks a star (young/arm stars preferred, never the bright core or cluster stars) and lights one of 4 reused flash points. The flash copies the star's `aOrbit`, so `gs_position` moves it with the star; light curve: fast rise, ~5 s fade, peak above the bloom threshold. The GLSL light curve mirrors `supernovaLight`.
- **Live structure controls**: arm count, winding, density wave, arm contrast, flocculence, dust, diffuse glow and bulge profile change instantly (shader uniforms).
- **Bloom**: lifts only bright cores and stars (threshold 0.45).
- **Lens flare** (`core/LensFlarePass.js`, Settings → Lens flare): a chain of tinted ghost discs on the line from each bright source through the screen centre. It reads the bloom pass's blurred mip 1 (no extra blur), keeps only the part above `FLARE_THRESHOLD`, and adds it before tone mapping. It runs only while bloom runs (so not on Low/Minimal). Sources near the screen centre cast no ghosts (they would only wash out a focused core or a black hole's shadow).
- **Diffraction spikes** (`shaders/chunks/spikes.glsl`, Settings → Star spikes: JWST 6+2 / Hubble 4 / Off): drawn inside point sprites, aligned to the screen like real telescope optics. On the 30 brightest background stars (a second sprite layer in `starfield.js`) and on supernova flashes (their sprite grows ×4). `spikeStyle(setting, tier)` in `quality.js` turns them off on Low/Minimal.
- **Cinematic pass** (`core/CinematicPass.js`, Settings → Cinematic): vignette, film grain and lateral chromatic aberration in one full-screen pass after `OutputPass` (display space). `cinematicEnabled(settings, tier)` in `quality.js` skips the pass when all three are 0 and on Low/Minimal.
- **Depth of field** (`core/DepthOfFieldPass.js`, pure maths in `core/dof.js`, Settings → Cinematic → Depth of field; 0 = off, default 0.35, saved as `depthOfField` (old saves stored `dof`, then 0 by default, so they get the new default); Medium/High only via `dofEnabled`): the selected object is in focus (else the orbit target); during a collision depth of field fades out over 1 s and back in after it (app.js `dofShare`; the setting is not changed; `focusSpan` / `uFocusRange` still keep every object of a collision sharp while it fades), with an eased focus pull (`easeFocus`, real time; the render gate stays active until it settles). Stars and volumes write no depth, so each object has an invisible proxy on layer `DOF` (`galaxy/dofProxy.js`: a flattened ellipsoid for galaxies, shared geometry and material; for a black hole a sphere just past the disc with its own material that writes the hole's depth only where the lens shows the hole: the near disc, the far disc after one bend of 2 Rs / b, and the core b < `HOLE_CORE_B`; elsewhere it discards, so the background seen through the lens keeps the far depth and blurs, with no sharp ring around a focused hole) that writes the object's CENTRE view depth into a quarter-res HalfFloat target (the background clears to `DOF_FAR`). Blur radius = `circleOfConfusion` (|d − f| / d, capped at `DOF_MAX_COC_PX` scaled by height; mirrored in GLSL). Half-res prep (colour + radius) → 16-tap golden-angle gather where a tap counts only if its own radius reaches the pixel (no sharp-object smear) → full-res mix by radius. Runs after JetPass (everything optical blurs together); the black holes' lens streaks are camera optics, so while it runs `BlackHolePass` leaves them out (`uStreaks`) and the DOF composite adds them after the blur (`STREAK_GLSL`, the same uniforms by reference); ~2 ms on a UHD 630 at 1600×900.
- **Wavelength view modes** (`galaxy/bands.js`, Settings → View, V key cycles): visible, Hubble palette (SHO: Hα gold, [O III] teal), JWST infrared (dust nearly transparent and glowing, stars dim), radio 21 cm (no stars; gas glows along the arms with a central hole) and X-ray (~0.5% of stars as compact sources, hot inner gas, bright supernovae). Each band is a row of gains and colour matrices sent as `uBand*` uniforms (`applyBandUniforms`); visible is the identity. The volume adds a gas/dust emission term (from the same dust density) and applies the colour matrix once after the march. Sky and field stars get a tint. Dropped X-ray stars are moved outside the clip volume (a 0 px point still draws 1 px on some GPUs).
- **Black hole rendering** (`galaxy/blackHole.js` pure math, `core/BlackHolePass.js`): styled after Gargantua (*Interstellar*), not strict physics. **Lens chain:** the lenses go nearest first (`lensOrder` → `uOrder`); each works in its own Rs (`uLensRs`) and bends the ray the one before it bent, from its closest approach, and the scene light is read once at the end, so two holes near each other lens each other (one lens alone gives exactly the single-lens result; the march texture serves camera rays only, so a ray another lens bent first takes the exact lens). Only standalone black holes are drawn (`Galaxy.blackHoleInfo` returns false for galaxies). **Accurate tier (`QUALITY.accurate.holeMarch`; a manual quality choice above High, never picked by Auto: not in `TIER_ORDER`, `holeSteps` 40 ≤ `MAX_HOLE_STEPS` 64):** the largest lens is ray-marched at 0.4–0.7 of the screen resolution (`marchScaleFor`: the budget is a full-screen hole at 0.4, so a smaller hole gets more resolution; 0.1 buckets) into a HalfFloat target (rgb disc light, a transmittance): velocity Verlet on the photon-orbit equation (`traceRay` in `blackHole.js`, tested against the exact deflection; mirrored in the march shader), starting at the march sphere (`discOuter · MARCH_SPHERE_K`), captured inside the photon sphere moving inward; a flared Gaussian disc volume (H = 0.07 + 0.04 R) sampled only inside |z| < 3H with a slab step limit, two noise reads per sample (both streak octaves), scalar emission with a flux-weighted colour applied after the loop, and a 2×2 ordered first-step jitter that the composite's four half-texel bilinear taps cancel. The main pass composites it (background · T + disc, the background bent once at closest approach by `deflection`) and keeps a painted full-resolution photon ring (core ≥ ~1 px, energy kept, plus a soft tail `RING_TAIL`), the halo, cavity and streak; other lenses and other tiers use the exact lens below. Cost on a UHD 630 at 1080p: +0.2–3 ms over Medium. In the march only, the disc reaches in to `MARCH_INNER` (1.7 Rs, like Gargantua's near-extremal spin) instead of the ISCO, with its look evaluated at a remapped radius (`marchDiscRadius`, mirrored in the shader), so no dark band shows between the photon ring and the lensed inner edge up close. One screen pass after bloom and lens flare (so neither floods the shadow), before tone mapping, only while a hole is resolved (lens fades in from 2 to 4 px shadow; `update()` disables the pass otherwise). **Exact lens (every tier but the march):** each lens pixel follows its exact Schwarzschild light path from `galaxy/photonLut.js` (Binet's equation u'' + u = 1.5u² tabulated per impact parameter, rows in log |b − b_crit|; RGBA32F, manual bilinear via `texelFetch`; built once at startup, ~30 ms; tested against a direct RK4 integration). The path stays in its own plane (e1: hole → camera, e2: the side it turns to); every crossing of the disc plane along it (up to 3: the near disc, the arches over and under the shadow, the photon rings) is a disc image, composited front to back; the disc is opaque (alpha = edge fade) and reaches in to `MARCH_INNER` with a soft inner rim (`EXACT_INNER_SOFT`); the sky shows where the path escapes; captured paths are the shadow. One path per pixel, so there are no seams or folds between images (the old one-bend model switched between a near and a far image and showed fold lines). The intro-fall warp shrinks the impact parameter (`WARP_SHRINK`) and turns the ray's plane about the hole (`WARP_SWIRL_EXACT`). Headless: ~1–4% more per frame than the old one-bend lens. Screen light is read on a plane `SOURCE_DEPTH` (40 Rs) behind the hole, not at infinity (else a bright galaxy core behind it becomes a white Einstein ring), and dimmed toward the hole (a cleared cavity, back to full at `LENS_REACH`); rays bent off the screen see the sky texture (shared `scene/sky.js` uniforms) plus procedural stars. Each lens has its own disc size, gain, glow, streak and colours (`uLensDisc`, `uLensHot`, `uLensCool`); a band tints them by its `agnHot`/`agnCool` over the visible ones. The disc: Shakura–Sunyaev profile, no Doppler beaming (both sides equally bright, like the film), gold by default, fine concentric streaks (two noise reads at an explicit LOD; a third, finer one on the intro tier), slow Keplerian shear, a soft haze for thickness, a warm glow halo and a horizontal lens streak. Jets (`jet.*.glsl`, gold) are camera-facing strips along the axis with a 1.5 px minimum width (energy kept): a core plus a soft halo (they draw after bloom). They are on layer `JETS` and drawn by `core/JetPass.js` after the black-hole pass (only while one is visible), so the lens and its cleared cavity never dim the base; with no depth test, the jet shader hides itself behind the shadow (view ray inside `SHADOW_B`, point beyond closest approach) and behind the near disc (ray crosses the disc annulus first, `uJetDiscOuter`). Bands scale them (`agnGain`, `jetGain`).
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
- **Camera modes** (app.js `setCameraMode`): orbit (default); consume (the collision auto camera; OrbitControls on but not updated, its `start` event hands back); free-fly (`core/flyControls.js`: WASD, Q/E, Shift, drag to look; OrbitControls disabled, target handed back on exit); guided tour (`core/tour.js` pure state machine: fly to each galaxy, then orbit; any drag/scroll or Esc stops); fall (the intro fall: OrbitControls disabled and not updated, so `minDistance` does not clamp). Focus always returns to orbit.
- **Sound** (`audio/soundscape.js`, pure mix in `audio/soundMix.js`, Settings → Sound, M key; on by default): a generated space drone (low-passed brown noise with a drifting cutoff + three slow-swelling low drones; no files, no licence) at a very low level (`AMBIENT_LEVEL` 0.05), and the intro-fall music (sound modes `wait` / `fall` / `end` in `soundMix.js`, from the fall phase in app.js `soundMode`): it starts at the start-box click, early by the wait's length (so the fall itself still starts at `FALL_MUSIC_START`), and rises exponentially from `MUSIC_MIN` to full by the time the fall starts; fallen in, it fades out over `MUSIC_END_FADE` (5 s), then the drone returns. Leaving the intro early crossfades back to the drone (2.5 s). The fall track is `FALL_MUSIC_URL` in `audio/tracks.js`, started at `FALL_MUSIC_START` (0:10, so the black at the end of the 60 s fall lands on the theme's first peak at about 1:00-1:08). The file is local and committed: `public/audio/interstellar.mp3`, trimmed to the 80 s the intro uses (1:13-2:33 of the full theme, 1.3 MB; 5 s of margin before the wait and after the end fade). If the fall timing changes, re-trim from the full theme and move `FALL_MUSIC_START`. The track is downloaded whole with `fetch` and played from a Blob URL, because Cloudflare Pages ignores HTTP Range requests and a streamed file then cannot seek to `FALL_MUSIC_START`; a tiny silent WAV is played in the unlock gesture so iOS allows the element to play later. A track that arrives late in the fall starts where it would be by then. The music is used only once it can play (`canplaythrough` on the Blob); empty, missing or broken = the drone keeps playing through the fall; use a file in `public/audio/` or a CORS-enabled URL, because the music runs through a `MediaElementSource` and a cross-origin file without CORS is silent there. Nothing is built until the first user gesture (window capture listeners: the start-box click), as browsers require; the media element is also started once in that gesture for iOS. Sound off fades out and suspends the `AudioContext`; it is also suspended while the page is hidden.
- **Keyboard**: Space pause · N add · F focus · Delete remove · Esc leave camera mode (also the collision auto camera) / deselect · H show/hide panel · P screenshot · R record video · T tour · G free-fly · V next view mode · M sound on / off · Ctrl+Z / Ctrl+Shift+Z undo/redo (`ui/keyboard.js`).
- **Start box** (`index.html` + `ui/startScreen.js`): static HTML with inline CSS, so the first paint is dark and styled before the JS loads. It blurs the live scene (`backdrop-filter`), shows touch or mouse controls via `(pointer: coarse)`, and says "Loading…" until the first frame renders, then "Click/Tap anywhere to start". On every load. While open it swallows pointer and key input (window capture listener), so the start click never selects/orbits and Space never pauses; Auto quality skips those frames (the blur costs GPU). Removed from the DOM after a 0.3 s fade.
- **Panel visibility** (`ui/panelToggle.js`): the lil-gui panel starts hidden on every load (desktop and phone) behind a "Controls" button in the top-right corner; "Hide" in the panel title bar (a separate absolutely-positioned button: the title is itself a `<button>`) puts it away. H toggles the same state. The root title no longer collapses (`gui.openAnimated` is a no-op). Both fade with opacity + visibility (150 ms, none with reduced motion); the hidden one is `inert`. UI state only, never saved. Hide-button CSS is scoped under `.lil-gui` because lil-gui's `.lil-gui button` rule loads later and would win.
- **Look**: UI font JetBrains Mono (`public/fonts/`, Latin woff2 400/600, OFL), `--mono` in `index.html`. The lil-gui panel is translucent glass (`style.css`); on phones it is up to 250 px wide and its width comes from CSS, not the GUI `width` option (inline wins). Every row uses one grid: labels left-aligned (ellipsis when too long), widgets in one fixed column flush right (`--widget-column`, a share of the panel width, so nested folders line up), buttons full width and centred, numbers and hex codes right-aligned in same-width value boxes. Dropdowns fill the column; where `appearance: base-select` is supported the real select is the widget and its list is drawn in the panel glass and font (elsewhere: dark option colours). `color-scheme: dark` for native popups. Overlays (toast, notice, info card, HUD, badges) use `--mono` too. Confirm and copy boxes are in-app (`ui/dialog.js`: `confirmDialog`, `copyDialog`; on `<body>`, above the panel, they take every key: Esc cancels, Enter confirms), never `window.confirm`/`prompt`. Only the OS file picker and colour picker stay native.
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
npm run preview      # serve the production build (at /three/galaxy-sandbox/)
npm test             # run Vitest once
npm run test:watch   # run Vitest in watch mode
```

## Deploy

Production: `https://me-momo.co.in/three/galaxy-sandbox/` on Cloudflare Pages. `vite.config.js` sets `base` to `/three/galaxy-sandbox/` for `vite build` only (`BASE_PATH` overrides; dev stays at `/`), so every runtime URL to a `public/` file must use `import.meta.env.BASE_URL` (as `FALL_MUSIC_URL` does), never a leading `/`. `deploy/router-worker/` is the Worker that owns `me-momo.co.in` and `www` (custom domains): project paths go to their Pages projects (`src/routes.js`, tested), everything else to the main site Worker `my-site-temp` (service binding `SITE`).

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
│   ├── createComposer.js    # EffectComposer: scene → UnrealBloomPass → LensFlarePass → BlackHolePass → JetPass → DepthOfFieldPass → ExposureMeterPass → OutputPass (ACES) → CinematicPass
│   ├── BlackHolePass.js     # Black-hole lensing, shadow and disc (exact light paths; Accurate: geodesic ray march)
│   ├── JetPass.js           # Black-hole jets, drawn after the lens (layer JETS)
│   ├── LensFlarePass.js     # Lens-flare ghosts from the bloom mips
│   ├── ExposureMeterPass.js # Auto-exposure meter + async readback
│   ├── autoExposure.js      # PURE: meter decode, target factor, eye-like adaptation
│   ├── CinematicPass.js     # Vignette, film grain, chromatic aberration (one ShaderPass)
│   ├── DepthOfFieldPass.js  # Depth of field: proxy depth, half-res gather blur, composite
│   ├── dof.js               # PURE: circle of confusion, focus easing
│   ├── loop.js              # Single animation loop; owns pause, time scale, dt cap
│   ├── cameraFly.js         # Eased camera move + framingPosition (no tween lib)
│   ├── flyControls.js       # Free-fly WASD camera (pure moveDirection / applyLook)
│   ├── GalaxyScenePass.js   # Background → low-res volumes (composite) → stars; replaces RenderPass
│   ├── layers.js            # Render layers: STARS, VOLUME, BACKGROUND, JETS, DOF
│   ├── quality.js           # Quality tiers + helpers; qualityGovernor.js picks one (Auto)
│   ├── renderGate.js        # Render on demand
│   ├── gpuTimer.js          # GPU pass timings for ?fps
│   ├── tour.js              # Guided tour state machine
│   ├── consumeCamera.js     # PURE: consumption auto-camera maths
│   ├── blackHoleFall.js     # PURE: intro fall state machine and curves
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
│   ├── consumption.js       # PURE: consumption timeline (who eats whom, scripted path, release, after-effects, store patch)
│   ├── collision.js         # PURE: collision physics (star states, init + step mirrors of simInit/collisionStep.glsl)
│   ├── generationCache.js   # A galaxy built ahead (merger remnant), off the main thread via generateWorker.js
│   ├── bands.js             # PURE: wavelength view modes (gains + colour matrices per band)
│   ├── blackHole.js         # PURE: light deflection, geodesic traceRay, lens selection
│   ├── photonLut.js         # PURE: exact Schwarzschild light paths as a lookup table (Binet's equation) for the BlackHolePass lens
│   ├── lod.js               # PURE: on-screen footprint → volume steps + star LOD (fewer, brighter far stars)
│   ├── presets.js           # spiral (M51/M101), barred (NGC 1300), elliptical (M87), irregular (LMC)
│   ├── catalogue.js         # Real galaxies: facts + params; tiltForInclination, catalogueViewDirection
│   ├── dofProxy.js          # Invisible depth-of-field stand-ins (layer DOF)
│   ├── discMap.js           # PURE bake of in-plane arms/bar/dust (pattern frame) → half-float texture
│   ├── noiseTexture.js      # Shared tileable fbm texture (flocculence, dust filaments)
│   ├── params.js            # LIMITS + defaults for shape / structure / look / motion, clamp functions
│   └── shaders/             # *.glsl via ?raw; chunks/{model,noise,stars,spikes,simInit,consume}.glsl joined by glsl.js
├── scene/
│   ├── GalaxyManager.js     # Map<id, Galaxy>; applies store diffs to the scene
│   ├── diffGalaxies.js      # PURE: prev/next galaxy lists → { added, removed, shapeChanged, lookChanged }
│   ├── CollisionSim.js      # One running consumption: scripted path + GPU star simulation (ping-pong textures), stream, preview
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
├── audio/
│   ├── soundscape.js        # Web Audio: generated drone + fall music, crossfades, gesture unlock
│   ├── soundMix.js          # PURE: target levels per mode
│   └── tracks.js            # Music URLs (FALL_MUSIC_URL; empty = drone only)
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
    ├── fallOverlay.js       # Vignette + black for the intro fall (DOM)
    ├── wakeLock.js          # Screen Wake Lock while the intro fall runs
    ├── fileIO.js            # Download text / pick a file
    ├── notice.js            # Centred message overlay
    ├── dialog.js            # In-app confirm / copy dialogs (no window.confirm)
    └── startScreen.js       # Start box: pure loading → ready → closed state + DOM wiring
```

Tests live next to the code: `src/galaxy/generateGalaxy.test.js`, etc.

### Key design decisions

- **Galaxy entry = four groups.** `shape` (star populations → geometry rebuild), `structure` (arms, dust, volume → uniforms), `look` (size, colours, tilt, position → uniforms/transforms), `motion` (speed, differential, pattern speed → uniforms). A standalone black hole adds `hole` (→ uniforms). `diffGalaxies` rebuilds only on `SHAPE_KEYS`/seed changes.
- **Arms are a density wave, computed on the GPU.** Disc stars store orbital elements, not positions. The vertex shader places each star at r = a·(1 + e·cos ψ), ψ = m(θ − φ(a)), with a log-spiral φ(a) that also turns rigidly at the pattern speed. Orbits crowd along the arms; stars flow through them; the pattern never winds up. Arm count, winding and eccentricity are therefore live uniforms.
- **Phase on the CPU.** Each galaxy accumulates `phase += dt * speed` and sends `uPhase`; a speed change never makes stars jump.
- **Hybrid rendering, one model.** Draw order per galaxy: volume (renderOrder 0) → stars (1) → H II (2). The volume and the stars call the same GLSL model chunk (`model.glsl`, mirrored and unit-tested in `densityModel.js`), so arms, bar and dust agree. Stars get analytic dust toward the camera (`gs_dustTau`) instead of depth sorting.
- **Change the model in two places.** Any formula change goes into `densityModel.js` AND `chunks/model.glsl`; `glsl.test.js` pins shared constants.
- **Picking uses math, not `Raycaster` on `Points`.** Raycasting a `Points` object loops over every vertex. Intersect the ray with each galaxy's disc plane instead.
- **Generation is pure and seeded.** `generateGalaxy(params, seed)` uses a seeded PRNG (e.g. mulberry32), never `Math.random`. The same input gives the same galaxy. This makes it testable and lets persistence store params instead of vertices.
- **Store holds plain data only.** Galaxy entries are JSON-serializable params (`id`, `name`, `preset`, `seed`, shape, structure, look, motion). Three.js objects live only in `GalaxyManager`. Saved state is v4 (`galaxy-sandbox:v4`; v3 added the optional `kind`/`hole` fields, v4 the optional `intro` flag); a v3 save that is exactly one black hole migrates to the intro scene (`migrateV3`), v2 saves load as they are and v1 saves migrate once (`migrateV1`).
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
  - **Intro tier**: while the scene is the intro scene (`isIntroScene`), `activeTier` returns `intro` (`introMobile` on phones) over Auto and any fixed tier, and the governor does not measure. It is High without the ray march, with the exact lens supersampled (`holeSamples` 4, phones 2: rotated-grid rays, only for pixels inside a lens reach) plus a finer streak octave (`uDetail`). The scene is only one hole with 6k stars, so the lens is the cost. The first add (the hole goes) returns to the normal tier. Not in `TIER_ORDER` or `QUALITY_OPTIONS`.
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
