# Future suggestions

Ideas to make Galaxy Sandbox more feature-rich and better looking. None of these are built yet. Each item says what it is and, where useful, how it fits the current architecture (store → GalaxyManager → Galaxy layers, shaders in `src/galaxy/shaders/`).

## Visual

- **Multi-wavelength view modes.** Switch between visible light, the Hubble palette, JWST infrared (dust glows, stars fade), radio (cold gas) and X-ray (hot core). Each mode is one uniform switch in the existing star, H II and volume shaders.
- **Diffraction spikes** on the brightest stars (JWST 6-point or Hubble 4-point), plus a subtle lens flare. Draw them as a screen-space sprite pass for stars above a brightness threshold.
- **Central black hole.** An accretion disc and gravitational lensing (raymarched in a small screen-space pass around the core), with optional AGN jets.
- **Globular clusters** in the halo (dense old star balls), and **supernova flashes** that light up and fade over a few seconds.
- **Background sky.** A procedural Milky Way band and faint nebulae in place of the uniform starfield.
- **Cinematic post-processing.** Depth of field on the focused galaxy, vignette, film grain, light chromatic aberration and auto exposure.
- **Level of detail.** Far galaxies switch to a cheap impostor (a pre-rendered sprite) to save fill rate for the raymarched volume.

## Features

- **Galaxy collisions.** A GPU "N-body-lite" step (GPGPU textures or WebGPU compute) that creates tidal tails and bridges when two galaxies pass close.
- **Universe generator.** Build a random cluster or filament of galaxies in one click.
- **Camera modes.** A guided tour or cinematic fly-through, and a free-fly WASD mode.
- **Recording.** Video capture (MediaRecorder on the canvas stream) and GIF export.

## Platform

- **WebGPU / TSL renderer** with compute shaders: more stars and faster volumes.
- **WebXR / VR mode** to stand inside a galaxy.
