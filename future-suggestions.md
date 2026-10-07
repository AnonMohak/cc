# Future suggestions

Ideas to make Galaxy Sandbox more feature-rich and better looking. None of these are built yet. Each item says what it is and, where useful, how it fits the current architecture (store → GalaxyManager → Galaxy layers, shaders in `src/galaxy/shaders/`).

## Visual

- **Depth of field** on the focused galaxy (needs depth data: stars do not write depth). Vignette, film grain, chromatic aberration (`core/CinematicPass.js`) and auto exposure (`core/autoExposure.js`) are already done.

## Features

- **Galaxy collisions.** A GPU "N-body-lite" step (GPGPU textures or WebGPU compute) that creates tidal tails and bridges when two galaxies pass close.
- Black Hole collisions and consumption. Black Hole gravitational interaction to the GPU N-body-lite simulation. Galaxies experiences tidal deformation, stretched streams, and bridges when passing near a black hole. Distance based capture zones for progressive particle consumption. Captured particles enter an accretion state and spiral towads the black hole before being consumed. Black Hole gravity uses softened inverse-squared accleration to maintain numerical stability. Designed to work with the existing GPGPU textures/WEBGPU compute pipeline. 

## Platform

- **WebGPU / TSL renderer** with compute shaders: more stars and faster volumes.
- **WebXR / VR mode** to stand inside a galaxy.
