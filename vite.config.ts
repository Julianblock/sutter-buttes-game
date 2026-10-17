import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glsl'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
