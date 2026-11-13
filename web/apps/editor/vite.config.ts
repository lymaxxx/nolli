import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // harfbuzzjs loads its WebAssembly with top-level await.
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['harfbuzzjs'] },
});
