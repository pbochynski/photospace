import { defineConfig } from 'vite';

export default defineConfig({
  // Vite is smart enough to handle most things out of the box for a simple SPA.
  // We can add worker options here to ensure it's bundled correctly.
  worker: {
    format: 'es'
  }
});