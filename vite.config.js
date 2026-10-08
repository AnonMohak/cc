import { defineConfig } from 'vite';

// The production site lives under a path on me-momo.co.in (deploy/router-worker
// forwards it to the Pages project). BASE_PATH overrides it, e.g. BASE_PATH=/
// for a build served at a domain root. The dev server always uses /.
const PROD_BASE = process.env.BASE_PATH ?? '/three/galaxy-sandbox/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PROD_BASE : '/',
  build: {
    rolldownOptions: {
      output: {
        // three changes rarely; a separate chunk stays cached across app releases.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
    // three (core + postprocessing + controls) is ~540 kB minified on its own;
    // it cannot be split further without lazy-loading the renderer.
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'deploy/**/*.test.js'],
  },
}));
