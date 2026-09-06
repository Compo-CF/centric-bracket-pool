import { defineConfig } from 'vite';

// Served from https://<user>.github.io/centric-bracket-pool/ unless a custom
// domain is configured, in which case set BASE_PATH=/ in the deploy workflow.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/centric-bracket-pool/',
  build: { outDir: 'dist', sourcemap: true },
});
