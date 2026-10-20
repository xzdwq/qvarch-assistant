import { createServer, type Server } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Playwright's Trace Viewer (the web app that comes with playwright-core) served on 127.0.0.1 — opened in the
 * app's browser. Besides its own files it gives only trace files from `root` (the notes' runs), and only to
 * whoever has the session's secret (a random part of every address).
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.zip': 'application/zip',
}

export class TraceServer {
  private server?: Server
  private port = 0
  private readonly secret = randomBytes(12).toString('hex')
  private readonly app: string

  constructor(private root: string) {
    // the viewer's files inside playwright-core (also inside app.asar — Electron's fs reads it)
    this.app = join(dirname(require.resolve('playwright-core/package.json')), 'lib', 'vite', 'traceViewer')
  }

  /** The viewer's address for a trace file (under root). */
  async url(traceFile: string): Promise<string> {
    const file = resolve(traceFile)
    if (!this.inside(file)) throw new Error('Недопустимый путь')
    if (!existsSync(file)) throw new Error('Трассировки нет — выполните блок ещё раз')
    await this.start()
    const q = new URLSearchParams()
    if (sep !== '/') q.set('pathSeparator', sep)
    q.set('trace', `file?path=${encodeURIComponent(file)}`)
    return `http://127.0.0.1:${this.port}/${this.secret}/trace/index.html?${q.toString()}`
  }

  private inside(file: string): boolean {
    const r = resolve(this.root)
    return file.toLowerCase().startsWith((r + sep).toLowerCase())
  }

  private start(): Promise<void> {
    if (this.server) return Promise.resolve()
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      const prefix = `/${this.secret}/trace`
      if (!u.pathname.startsWith(prefix + '/')) return void ((res.statusCode = 404), res.end())
      const rel = decodeURIComponent(u.pathname.slice(prefix.length))
      let file: string
      if (rel === '/file') {
        file = resolve(u.searchParams.get('path') ?? '')
        if (!this.inside(file)) return void ((res.statusCode = 403), res.end())
      } else {
        file = normalize(join(this.app, rel))
        if (!file.startsWith(this.app + sep)) return void ((res.statusCode = 403), res.end())
      }
      let size: number
      try {
        const st = statSync(file)
        if (!st.isFile()) throw new Error()
        size = st.size
      } catch {
        return void ((res.statusCode = 404), res.end())
      }
      res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader('Content-Length', String(size))
      res.setHeader('Cache-Control', 'no-cache')
      // the service worker must be allowed to control the whole viewer
      if (file.endsWith('sw.bundle.js')) res.setHeader('Service-Worker-Allowed', `/${this.secret}/trace/`)
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
    })
    return new Promise((ok, fail) => {
      server.once('error', fail)
      server.listen(0, '127.0.0.1', () => {
        const a = server.address()
        this.port = typeof a === 'object' && a ? a.port : 0
        this.server = server
        ok()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = undefined
  }
}
