import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The API base the *browser* uses. In docker-compose builds this is baked in as
// a build arg; in local `npm run dev` it defaults to the proxied same-origin.
const API_BASE = process.env.VITE_API_BASE ?? '';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // dicomweb-client imports the Node "events" builtin; give it a browser shim
      events: 'events',
      xmlbuilder2: path.resolve(__dirname, 'src/shims/xmlbuilder2.ts'),
    },
    // Force one instance of each cornerstone package + dicom-parser so the tool
    // registry stays shared with ToolGroups.
    dedupe: [
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      '@cornerstonejs/dicom-image-loader',
      '@cornerstonejs/metadata',
      '@cornerstonejs/utils',
      'dicom-parser',
    ],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/dicom-web': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  define: {
    __API_BASE__: JSON.stringify(API_BASE),
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // dicom-image-loader must NOT be pre-bundled (its `new Worker(new URL(...))`
    // only resolves when served raw). Everything else cornerstone IS pre-bundled
    // so the browser's native ESM loader never sees the UMD wasm-codec glue
    // (which has no ESM default export).
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      'dicom-parser',
      'dicomweb-client',
      'events',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
});
