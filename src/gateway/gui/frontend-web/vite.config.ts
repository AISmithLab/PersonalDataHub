import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dirname,
  // react-native-web's View/Text ignore a raw `className` prop — it's only
  // forwarded to the DOM via NativeWind's babel transform (which wraps RN
  // core components with its CSS interop), so it must run here too, not just
  // in Metro's config for the native build.
  plugins: [react({ babel: { presets: ['nativewind/babel'] } }), viteSingleFile()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
    // Many RN packages (e.g. react-native-safe-area-context) ship their web
    // override as plain `.web.js`, not `.web.jsx`/`.web.ts(x)` — without it
    // here, Vite falls through to the native entry point instead.
    extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
