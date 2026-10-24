// The server, one file (the app's shared protocol bundled in; the drivers stay packages).
import { build } from 'esbuild'

await build({ bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['pg', 'ws', 'pg-native'], sourcemap: true, logLevel: 'info', entryPoints: ['src/main.ts'], outfile: 'dist/server.js' })
