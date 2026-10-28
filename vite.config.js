import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {voskCspPlugin} from './scripts/vosk-csp-plugin.js';
import { BUILD_INFO } from './server/build-info.js';
export default defineConfig({
  define: { __MOTHER_BUILD__: JSON.stringify(BUILD_INFO) },
  plugins: [react(),voskCspPlugin()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react','react-dom'] } } } }
});
