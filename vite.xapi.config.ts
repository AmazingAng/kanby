import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'xapi-adapter'),
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
      'next/image': resolve(import.meta.dirname, 'xapi-adapter/next-image.tsx'),
      'next/link': resolve(import.meta.dirname, 'xapi-adapter/next-link.tsx'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-xapi/client'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
