import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

/** The app's version, put into the window's code (the status bar shows it). */
const VERSION = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  // main and preload keep their node_modules out of the bundle (electron-vite's `build.externalizeDeps`, on by default)
  main: {
    // ws (a dev dependency — bundled) is told its optional native add-ons are not there: bundled, their require()
    // becomes an empty stub that ws would take for the add-on (a scenario's bridge failed on its first frame)
    define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
    // the release builder runs in its own (utility) process — see src/main/release/worker.ts
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), releaseWorker: resolve('src/main/release/worker.ts'), codeWorker: resolve('src/main/runner/codeWorker.ts'), loopWorker: resolve('src/main/runner/loopWorker.ts'), pwWorker: resolve('src/main/runner/pwWorker.ts'), hookWorker: resolve('src/main/runner/hookWorker.ts'), sqlWorker: resolve('src/main/sql/worker.ts') } } },
  },
  preload: {
    // the app's windows, and the browser's pages — the section's and the notes' (sign-in forms, a scenario's recording)
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), browser: resolve('src/preload/browser.ts') } } },
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    resolve: { alias: { '@shared': resolve('src/shared'), '@nb': resolve('src/notebook'), '@renderer': resolve('src/renderer/src') } },
    // <webview> is Electron's own element (the notes' browser component)
    plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } } }), tailwindcss()],
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
