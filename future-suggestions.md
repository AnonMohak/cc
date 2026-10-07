# Future suggestions

Ideas to make Galaxy Sandbox more feature-rich and better looking. None of these are built yet. Each item says what it is and, where useful, how it fits the current architecture (store → GalaxyManager → Galaxy layers, shaders in `src/galaxy/shaders/`).

## Visual

- **Multi-wavelength view modes.** Switch between visible light, the Hubble palette, JWST infrared (dust glows, stars fade), radio (cold gas) and X-ray (hot core). Each mode is one uniform switch in the existing star, H II and volume shaders.
- **Subtle lens flare** on very bright sources (supernovae, the brightest stars): faint ghosts along the line through the screen centre. Diffraction spikes are already done (`spikes.glsl`).
- **Central black hole.** An accretion disc and gravitational lensing (raymarched in a small screen-space pass around the core), with optional AGN jets.
- **Depth of field and auto exposure.** Depth of field on the focused galaxy (needs depth data: stars do not write depth) and auto exposure (needs a luminance reduction pass). Vignette, film grain and chromatic aberration are already done (`core/CinematicPass.js`).

## Features

- **Galaxy collisions.** A GPU "N-body-lite" step (GPGPU textures or WebGPU compute) that creates tidal tails and bridges when two galaxies pass close.

## Platform

- **WebGPU / TSL renderer** with compute shaders: more stars and faster volumes.
- **WebXR / VR mode** to stand inside a galaxy.
