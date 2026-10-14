import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the packaged .ehpk loads from any base URL.
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  build: { target: 'es2020' },
});
