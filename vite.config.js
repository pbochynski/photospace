// vite.config.js

import { defineConfig } from 'vite';
import { copyFileSync } from 'fs';

export default defineConfig({
  // Tell Vite that your source code and entry point (index.html) are in the 'src' directory.
  root: 'src', 
  publicDir: '../public',
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
  },
  
  plugins: [
    {
      name: 'copy-sw',
      writeBundle() {
        copyFileSync('src/sw.js', 'dist/sw.js');
      }
    }
  ]
});