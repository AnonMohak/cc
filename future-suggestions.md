# Future suggestions

Ideas to make Galaxy Sandbox more feature-rich and better looking. None of these are built yet. Each item says what it is and, where useful, how it fits the current architecture (store → GalaxyManager → Galaxy layers, shaders in `src/galaxy/shaders/`).

## Visual

- **Depth of field** on the focused object. Tried once and reverted (to look at later): commit `862cca4` has a full version; `git revert` of the revert brings it back. How it worked: each galaxy and black hole had an invisible proxy (layer DOF) that wrote the object's centre view depth into a quarter-res target, because stars and volumes write no depth; then a half-res 16-tap gather blur and a full-res mix, after JetPass, Medium/High only, off by default, ~2 ms on a UHD 630. Open issue to fix first: a small sharp ring of background around a focused black hole, plus a short sharp piece of the lens streak. The black hole's proxy (a sphere just past the disc) gives the background seen through it the hole's focus distance. Possible fixes: give pixels inside the proxy but outside the disc and rings the background depth (`DOF_FAR`), or blur the lens streak in `BlackHolePass`. Vignette, film grain, chromatic aberration (`core/CinematicPass.js`) and auto exposure (`core/autoExposure.js`) are already done.

## Features

- Black Hole collisions and consumption. Black Hole gravitational interaction to the GPU N-body-lite simulation. Galaxies experiences tidal deformation, stretched streams, and bridges when passing near a black hole. Distance based capture zones for progressive particle consumption. Captured particles enter an accretion state and spiral towads the black hole before being consumed. Black Hole gravity uses softened inverse-squared accleration to maintain numerical stability. Designed to work with the existing GPGPU textures/WEBGPU compute pipeline. Builds on the galaxy collisions (`galaxy/collision.js`, `scene/CollisionSim.js`): add the black hole as a third Plummer mass in `collisionStep.glsl` and a capture radius there. 
- **Camera rotation animation | FPS | Camera angle.** (Noted for later; the details are still to decide.)

## Platform

- **WebGPU / TSL renderer** with compute shaders: more stars and faster volumes.
- **WebXR / VR mode** to stand inside a galaxy.
