import { defineConfig } from 'vite';

export default defineConfig({
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
    include: ['src/**/*.test.js'],
  },
});
