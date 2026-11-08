import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';

// Dev-only preview pages live in preview/*.html (props sheet, vehicles, textures); the shipped app is index.html.
const previews = existsSync('preview') ? readdirSync('preview').filter((f) => f.endsWith('.html')) : [];
export default defineConfig(({ command }) => ({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'),
      ...(command === 'serve' ? Object.fromEntries(previews.map((f) => [f, resolve(__dirname, 'preview', f)])) : {}) } },
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
}));
