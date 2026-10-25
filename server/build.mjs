// The server, one file (the app's shared protocol bundled in; the drivers stay packages).
import { build } from 'esbuild'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const own = join(here, 'node_modules')
/**
 * A package is taken from the server's own dependencies only (a shared module of the app that pulls a package the
 * server does not list fails here, on any computer — not only in the image, where the app's packages are absent).
 */
const ownPackagesOnly = {
  name: 'own-packages-only',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === 'own') return undefined
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: here, pluginData: 'own' })
      if (r.errors.length) return { errors: [{ text: `${args.path}: not a dependency of the server (imported by ${relative(here, args.importer)})` }] }
      if (!r.external && !r.path.startsWith(own + sep)) return { errors: [{ text: `${args.path}: resolved outside the server's packages (${r.path})` }] }
      return r
    })
  },
}

await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg', 'ws', 'pg-native'],
  plugins: [ownPackagesOnly],
  sourcemap: true,
  logLevel: 'info',
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.js',
})
