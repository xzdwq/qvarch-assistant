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
    // the app's windows, and the browser section's pages (sign-in forms only)
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), browser: resolve('src/preload/browser.ts') } } },
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
