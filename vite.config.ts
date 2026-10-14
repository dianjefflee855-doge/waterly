import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true, rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
} as any);
