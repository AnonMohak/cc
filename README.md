# Galaxy Sandbox

Create, shape and explore realistic procedural galaxies in your browser — built with Three.js and Vite.

Spiral arms are real **density waves**: stars move on twisted elliptical orbits computed on the GPU, so arms form where orbits crowd together and never wind up. A raymarched volume adds the soft light of unresolved stars and dust lanes that absorb and redden the light behind them. Star colours come from black-body temperatures, young blue stars light up as they cross the arms, and pink H II nebulae glow along them.

## Features

- **Make and edit galaxies** — spiral, barred spiral, elliptical and irregular presets; change size, colours, tilt, rotation speed, arm count and winding, dust, bulge and more. Most sliders update live.
- **Real galaxies** — Andromeda (M31), Whirlpool (M51), Pinwheel (M101), Sombrero (M104), M87 and the Large Magellanic Cloud, shown at their real inclination with a fact card.
- **Universe generator** — one click builds a galaxy cluster (ellipticals in the core) or a filament.
- **Explore** — orbit and zoom, click to select, double-click to fly to a galaxy, a guided tour, and a free-fly mode.
- **HUD** — galaxy name labels, a light-year scale bar and a clickable minimap.
- **Share and save** — the scene saves automatically; copy a share link, export/import JSON, undo/redo.
- **Record** — screenshots, video (WebM/MP4) and 4-second GIFs.
- **Quality settings** — Low / Medium / High volume quality, exposure, bloom and dust controls.

## Quick start

Requires [Node.js](https://nodejs.org/) 20+ and a browser with WebGL 2.

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

The galaxy body is raymarched, so its cost grows with how much of the screen it covers. If the frame rate is low, set **Settings → Quality** to Low, lower the star count, or close galaxies you are not looking at. The app already reduces the work automatically when a galaxy fills the screen or is very small.

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
