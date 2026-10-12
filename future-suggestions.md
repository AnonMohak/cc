# Future suggestions

Ideas to make Galaxy Sandbox more feature-rich and better looking. None of these are built yet. Each item says what it is and, where useful, how it fits the current architecture (store → GalaxyManager → Galaxy layers, shaders in `src/galaxy/shaders/`).

## Features

- **Camera rotation animation | FPS | Camera angle.** (Noted for later; the details are still to decide.)

## Platform

- **WebGPU / TSL renderer** with compute shaders: more stars and faster volumes.
- **WebXR / VR mode** to stand inside a galaxy.

## Intro black hole fixes (tried once, scrapped; find another way)

A first attempt was built on a branch and then dropped. The problems and the ideas stay valid; the way to build them is still open.

- **Camera rotation in the intro fall.** Problem: the fall feels like only the black hole spins and the camera is stuck. Cause: the camera circles the hole at a fixed 20° height (`updateFallCamera` in `app.js`), always aims at the exact centre and keeps the horizon level. The disc is round, so every point on that circle gives the same picture; only the faint sky moves, and the disc spin-up (×15) is the only motion the eye sees. Goal: the user feels that they revolve around the hole while it spins (like the Earth around the Sun while the Sun turns on its axis). Ideas that were tried:
  - More turns (3 instead of ~1.2), faster as the camera nears the hole (speed ∝ (r0/r)^0.75, capped at 6×), from a precomputed angle table so it does not depend on the frame rate.
  - A tilted orbit: the height swings between ~5° and ~45° once per turn, so the disc shape changes all the time; back to the 20° film shot for the plunge.
  - Lead and bank: aim ~8° ahead along the orbit (the hole sits off centre, the sky streams across) and roll the horizon into the turn (up to ~12°); reset `camera.up` when the fall ends.
  - Foreground dust grains that the camera passes (parallax), drawn after the lens pass (layer `JETS`) and hidden behind the shadow like the jets.
  - Brighter sky stars during the fall (×1.6) and a gentler disc spin-up (×6).
- **Horizontal line through the black hole.** Problem: a straight horizontal line goes through the middle of the hole and looks false. Cause: the lens streak in `BlackHolePass.js` (`shade()`, `STREAK_GAIN` / `STREAK_LENGTH`): a ~1.2 px line level with the screen, reaching across the full screen width, that does not follow the disc tilt. Idea that was tried: a short, soft Gaussian glow along the disc's long axis on screen (perpendicular to the projected disc normal), sized by the disc and fainter, none for a face-on disc.
- **More fps without much quality loss.** Done: the lens rectangle (scissor), the lens flare skipped when nothing passes its threshold, and supersampling on edges only. On the intro scene on a UHD 630 at 720p the black-hole pass is now ~16 of ~21 ms at the film shot and ~26 of ~32 ms close up (fine disc streaks count as edges there). Measure with `?fps` first.
  - Temporal supersampling for the lens: 1 ray per frame on a rotating sub-pixel offset, blended with the last frames (reproject; reset on fast motion), instead of 4 rays every frame.
  - Bake the disc look (profile × streak noise) into a small polar texture when the hole params change.
  - Dynamic resolution inside a tier before Auto drops a whole tier.
  - Cheaper bloom on phones (fewer mips or quarter resolution).
  - `mediump` where it is safe on mobile GPUs; `highp` only for positions and the light-path lookup.
