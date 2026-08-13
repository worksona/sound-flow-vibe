import { defineConfig } from 'vite'

// Self-contained app: relative base so the build deploys at any path
// (netlify site root, a /field/ subpath, or its own repo later).
export default defineConfig({
  base: './',
  server: { port: 5180 },
  build: { target: 'es2022' },
})
