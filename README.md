# Galaxy Sandbox

Create, shape and explore realistic procedural galaxies in your browser — built with Three.js and Vite.

Spiral arms are real **density waves**: stars move on twisted elliptical orbits computed on the GPU, so arms form where orbits crowd together and never wind up. A raymarched volume adds the soft light of unresolved stars and dust lanes that absorb and redden the light behind them. Star colours come from black-body temperatures, young blue stars light up as they cross the arms, and pink H II nebulae glow along them.

## Features

- **Make and edit galaxies** — spiral, barred spiral, elliptical and irregular presets; change size, colours, tilt, rotation speed, arm count and winding, dust, bulge and more. Most sliders update live.
- **Real galaxies** — Andromeda (M31), Whirlpool (M51), Pinwheel (M101), Sombrero (M104), M87 and the Large Magellanic Cloud, shown at their real inclination with a fact card.
- **Universe generator** — one click builds a galaxy cluster (ellipticals in the core) or a filament.
- **Galaxy collisions** — pick two galaxies and collide them (Selected galaxy → Collision): tidal tails and bridges form, a slow pass merges into one round remnant and a fast wide pass flies by. "Stop collision" puts both back.
- **Globular clusters and supernovae** — dense balls of old stars orbit in each halo, and supernovae flare up and fade in the arms every few seconds (can be turned off).
- **Diffraction spikes** — the brightest stars and supernovae show JWST-style 6-point or Hubble-style 4-point spikes (choose in Settings, or turn off).
- **Milky Way sky** — a faint procedural Milky Way band with dust lanes and nebulae behind the galaxies (can be turned off).
- **Explore** — orbit and zoom, click to select, double-click to fly to a galaxy, a guided tour, and a free-fly mode.
- **HUD** — galaxy name labels (off by default; Settings → HUD), a light-year scale bar and a clickable minimap.
- **Share and save** — the scene saves automatically; copy a share link, export/import JSON, undo/redo.
- **Record** — screenshots, video (WebM/MP4) and 4-second GIFs.
- **Start screen** — a translucent box over the live, blurred scene lists the controls for your device; click or tap to start. The UI uses JetBrains Mono, and the control panel is translucent glass (narrow on phones).
- **Black holes** — add standalone black holes in the Interstellar style; on the High tier the light bending is a real ray march through curved spacetime with a thick disc (see Physics).
- **Runs on ordinary hardware** — Auto quality adapts to your device (laptop integrated GPUs and phones included); or pick Minimal / Low / Medium / High.

## Physics

What in the app follows real physics or real astronomy, and the model behind it. Everything is scaled and simplified so it runs in real time; the code lives in `src/galaxy/` (galaxy model mirrored between `densityModel.js` and `shaders/chunks/model.glsl`).

**Black holes** (`blackHole.js`, `core/BlackHolePass.js`)

- **Light bending on the High tier is a real geodesic ray march.** Each pixel integrates its light ray through Schwarzschild spacetime (the photon-orbit equation d²p/dλ² = −1.5 h² p / r⁵). This gives the shadow at the true critical impact parameter √27/2 Rs, the photon sphere at 1.5 Rs, the far side of the disc lifted over and under the hole, and the thin higher-order images from light that loops the hole. Tests check it against the exact Schwarzschild deflection integral (within 1% for b ≥ 3.5 Rs).
- **Other tiers bend each ray once** by the Schwarzschild deflection angle: the second-order weak-field formula far away and the strong-deflection limit near the photon sphere.
- **Accretion disc:** the Shakura–Sunyaev thin-disc flux profile F ∝ r⁻³ (1 − √(r_in / r)), with the inner edge at the ISCO (3 Rs) and Keplerian shear (inner gas orbits faster, ω ∝ r⁻¹·⁵). On High the disc is a flared volume that emits and absorbs light along each ray.
- **Jets** leave along the spin axis, are hidden behind the shadow, and are dimmed where the disc is in front of them.

**Galaxies** (`densityModel.js`, `generateGalaxy.js`, `discMap.js`)

- **Spiral arms are density waves** (Lin–Shu / Lindblad): every disc star moves on a slightly elongated orbit whose orientation twists with radius, so orbits crowd into arms. Stars flow through the arms, the pattern turns rigidly, and the arms never wind up.
- **Rotation:** a damped flat rotation curve (inner orbits take less time per turn).
- **Structure:** an exponential disc with a sech² vertical profile, a Sérsic bulge (n ≈ 4 is de Vaucouleurs), a bar that turns with the pattern, and a stellar halo.
- **Dust:** an exponential dust slab whose optical depth dims and reddens the light behind it, concentrated on the inner (concave) edge of the arms, as in real spirals; edge-on discs show a dark midplane lane.
- **Stars:** black-body colours from their temperatures; young hot blue stars light up on the arm crests where star formation happens; pink H II regions (ionised hydrogen) glow there too.
- **Globular clusters** are Plummer spheres of old stars on slow halo orbits.
- **Supernovae** follow a Poisson schedule, prefer young stars (core-collapse) or anywhere in ellipticals (type Ia), and have a fast-rise, exponential-fade light curve.
- **Collisions** (`collision.js`) use the restricted N-body method of Toomre & Toomre (1972): each galaxy is a softened point mass (a Plummer sphere, mass ∝ radius²) and its stars are test particles that feel both galaxies, stepped on the GPU. The two centres also feel a drag while they overlap that fades for fast passes (∝ 1/v³, like Chandrasekhar dynamical friction), so slow encounters merge and fast ones escape. Tidal tails come out of the dynamics, not a script.

**Observing**

- **Wavelength views:** visible light; the Hubble SHO palette (Hα, [O III], [S II]); JWST-style infrared (dust becomes transparent and glows, stars dim); 21 cm radio (neutral hydrogen along the arms with a central hole, as in real HI maps); X-ray (a few compact sources, hot gas, bright supernovae).
- **Telescope optics:** diffraction spikes in the real JWST 6+2 and Hubble 4-point patterns.
- **Real galaxies** (M31, M51, M101, M104, M87, LMC) at their real relative diameters and inclinations; the scale bar uses 1 world unit = 9,000 light-years.

**Artistic choices (not physics)**

- No Doppler beaming: both sides of the disc are equally bright, as in the film *Interstellar* (a real disc is much brighter on the side moving toward you).
- The gold disc palette and the white-hot inner edge (a real disc this hot would look blue-white).
- Black holes are drawn far larger than real ones at galaxy scale, and the space around them is dimmed (a "cleared cavity") so the disc stands out.
- The horizontal lens streak, the glow halo and the soft haze around the disc on the lower tiers.
- The intro fall: its timing, camera path and the fade to black are cinematic, not a simulation of falling in.
- Collisions: the approach is fast-forwarded while the galaxies are far apart, the gas (the glowing body, nebulae and dust) simply fades as the discs are torn apart, and stars do not pull on each other (no self-gravity).

## Quick start

Requires [Node.js](https://nodejs.org/) 22.12+ (needed by Vitest; Vite alone needs 20.19+) and a browser with WebGL 2.

```sh
npm install
npm run dev        # open http://localhost:5173
```

Production build:

```sh
npm run build      # outputs to dist/
npm run preview    # serve the build locally
```

## Controls

The site opens with a start box over the blurred scene that lists these controls (touch or mouse/keyboard, to match the device). Click, tap or press Enter to start.

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Orbit / zoom / pan | Drag / scroll or pinch / right-drag | |
| Select a galaxy | Click or tap it (or its label) | Esc to deselect |
| Fly to a galaxy | Double-click, double-tap, or click it on the minimap | F (selected) |
| Add / delete a galaxy | Control panel | N / Delete |
| Pause | | Space |
| Undo / redo | | Ctrl+Z / Ctrl+Shift+Z |
| Guided tour | Panel → Camera | T |
| Free-fly | Panel → Camera | G, then WASD · Q/E · Shift · drag to look |
| Record video | Panel → Record | R |
| Screenshot | Panel → Record | P |
| Hide the panel | | H |

### URL options

- `?fps` — show a frame-rate readout (useful to choose a quality level for your GPU).
- `#scene=…` — a shared scene; created by **Share → Copy share link**.

## Performance

The app is built to run on integrated laptop GPUs and phones. **Settings → Quality → Auto** (the default) measures your frame rate and picks a quality tier for you; the panel shows the active tier. The galaxy glow renders at reduced resolution, its arm and dust detail is baked into textures, and nothing is redrawn while the scene is paused and still.

If it is still slow, pick **Minimal**, lower the star count, or remove galaxies you are not looking at. Add `?fps` to the URL to see the frame rate, your GPU and where GPU time goes. On laptops with two GPUs, setting the browser to "High performance" in Windows graphics settings helps further.

## Development

```sh
npm test             # run all unit tests (Vitest, Node — no browser needed)
npm run test:watch   # watch mode
```

```
src/
├── main.js / app.js   # entry point and wiring
├── core/              # renderer, camera, loop, camera modes, recording
├── galaxy/            # galaxy model, generator, materials, GLSL shaders
├── scene/             # scene sync, picking, background stars
├── state/             # store, persistence, sharing, undo, universe generator
├── ui/                # control panel, HUD, input, overlays
└── util/              # debounce, GIF encoder
```

Data flows one way: **UI → store → scene**. The physics model lives in `src/galaxy/densityModel.js` and is mirrored in `src/galaxy/shaders/chunks/model.glsl`; change both together.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture, design decisions, conventions and constraints, and [`future-suggestions.md`](future-suggestions.md) for planned ideas.

## Tech stack

[Three.js](https://threejs.org/) · [Vite](https://vite.dev/) · [lil-gui](https://lil-gui.georgealways.com/) · [Vitest](https://vitest.dev/) — plain JavaScript (ES modules), no framework, no backend.

## References

- Density-wave galaxy rendering: [beltoforion.de — Rendering a Galaxy with the density wave theory](https://beltoforion.de/en/spiral_galaxy_renderer)
- Galaxy structure and colours: [Caltech Ay124 lecture notes](https://sites.astro.caltech.edu/~george/ay124/2009/Ay124_Lec11.pdf), [NASA — M101](https://science.nasa.gov/wp-content/uploads/2023/07/hubble-litho-m101-pinwheel-galaxy.pdf)
- Volumetric galaxy rendering: [OpenSpace RenderableGalaxy](https://docs.openspaceproject.com/releases-v0.22/reference/asset-components/Renderable/RenderableGalaxy.html)
