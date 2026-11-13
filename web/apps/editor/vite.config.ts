import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Electron loads the built page from disk, so its assets need relative URLs.
  base: './',
  // harfbuzzjs loads its WebAssembly with top-level await.
  build: { target: 'es2022' },
  // The map worker is a module and inherits the font package's top-level await.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['harfbuzzjs'] },
});
