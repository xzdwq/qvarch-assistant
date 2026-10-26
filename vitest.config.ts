import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** Tests resolve the same aliases as the renderer build (electron.vite.config.ts). */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@nb': resolve('src/notebook'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    // the suites that drive a real (headless) browser start and close it in hooks: with the whole run loading the
    // machine that may take longer than the default 10 s
    hookTimeout: 60_000,
    // the tests' temporary folders taken away (tests/testTemp.ts)
    globalSetup: ['tests/globalSetup.ts'],
  },
})
