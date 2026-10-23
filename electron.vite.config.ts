import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

/** The app's version, put into the window's code (the status bar shows it). */
const VERSION = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // the release builder runs in its own (utility) process — see src/main/release/worker.ts
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), releaseWorker: resolve('src/main/release/worker.ts'), codeWorker: resolve('src/main/runner/codeWorker.ts'), loopWorker: resolve('src/main/runner/loopWorker.ts'), pwWorker: resolve('src/main/runner/pwWorker.ts'), hookWorker: resolve('src/main/runner/hookWorker.ts'), sqlWorker: resolve('src/main/sql/worker.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // the app's windows, and the browser section's pages (sign-in forms only)
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), browser: resolve('src/preload/browser.ts') } } },
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // <webview> is Electron's own element (the notes' browser component)
    plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } } })],
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
