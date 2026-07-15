import { defineConfig } from 'vite';

export default defineConfig({
  base: '/3d-gem-hunter/',
  build: {
    sourcemap: true,
    manifest: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three-runtime',
              test: /node_modules[\\/]three[\\/]/
            }
          ]
        }
      }
    }
  }
});
