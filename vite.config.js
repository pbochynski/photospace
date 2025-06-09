// vite.config.js

import { defineConfig } from 'vite';

export default defineConfig({
  // Tell Vite that your source code and entry point (index.html) are in the 'src' directory.
  root: 'src', 
  envDir: '..',
  
  worker: {
    format: 'es'
  },
  
  build: {
    // Tell Vite to put the build output in a 'dist' folder at the project root,
    // not inside 'src/dist'.
    outDir: '../dist',
    // Ensure the dist directory is empty before building
    emptyOutDir: true,
  }
});