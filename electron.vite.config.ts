import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // the release builder runs in its own (utility) process — see src/main/release/worker.ts
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), releaseWorker: resolve('src/main/release/worker.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          island: resolve('src/renderer/island.html'),
        },
      },
    },
  },
})
