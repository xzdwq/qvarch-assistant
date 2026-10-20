import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Qvarch as an MCP server for AI assistants (Claude Code in VS Code / the terminal, Claude Desktop): the
 * notebook, its runnable blocks, Jira, the time of «Моя работа», the Браузер — as tools.
 * Streamable HTTP on 127.0.0.1 only, a bearer token, pages of other sites refused (Origin). Plain JSON answers,
 * no sessions. Claude Desktop speaks stdio only: a small bridge (run by the app's own exe as Node) passes its
 * lines here.
 */
export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
}
export interface McpConfig {
  on: boolean
  port: number
  token: string
  /** Hosts the AI may run tests against without asking (wildcards). */
  allow: string[]
}
export interface McpInfo extends McpConfig {
  url: string
  listening: boolean
  error?: string
  bridge: string
  exe: string
}
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
export const DEFAULT_ALLOW = ['*-dev*', '*-qa*', 'localhost', '127.0.0.1']

export class Mcp {
  private server?: Server
  private file: string
  private bridgeFile: string
  cfg: McpConfig
  private listening = false
  private error?: string
  private port = 0

  constructor(
    root: string,
    private tools: () => McpTool[],
    private version: string,
  ) {
    this.file = join(root, 'mcp.json')
    this.bridgeFile = join(root, 'mcp-bridge.cjs')
    let c: Partial<McpConfig> = {}
    try {
      if (existsSync(this.file)) c = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<McpConfig>
    } catch {
      // a new one
    }
    this.cfg = {
      on: c.on ?? true,
      port: Number(c.port) > 1023 && Number(c.port) < 65536 ? Number(c.port) : 7843,
      token: typeof c.token === 'string' && c.token.length >= 24 ? c.token : randomBytes(24).toString('hex'),
      allow: Array.isArray(c.allow) && c.allow.every((x) => typeof x === 'string') ? c.allow : DEFAULT_ALLOW,
    }
    this.save()
  }
  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.cfg, null, 1))
  }
  info(): McpInfo {
    return { ...this.cfg, port: this.port || this.cfg.port, url: `http://127.0.0.1:${this.port || this.cfg.port}/mcp`, listening: this.listening, error: this.error, bridge: this.bridgeFile, exe: process.execPath }
  }
  async set(patch: Partial<McpConfig> & { newToken?: boolean }): Promise<McpInfo> {
    if (typeof patch.on === 'boolean') this.cfg.on = patch.on
    if (Number(patch.port) > 1023 && Number(patch.port) < 65536) this.cfg.port = Number(patch.port)
    if (Array.isArray(patch.allow)) this.cfg.allow = patch.allow.map((x) => String(x).trim()).filter(Boolean).slice(0, 50)
    if (patch.newToken) this.cfg.token = randomBytes(24).toString('hex')
    this.save()
    await this.restart()
    return this.info()
  }

  async restart(): Promise<void> {
    this.stop()
    this.writeBridge()
    if (!this.cfg.on) return
    for (let p = this.cfg.port; p < this.cfg.port + 10; p++) {
      try {
        await this.listen(p)
        this.port = p
        this.listening = true
        this.error = p === this.cfg.port ? undefined : `Порт ${this.cfg.port} занят — работает на ${p}`
        this.writeBridge()
        return
      } catch {
        // busy — the next one
      }
    }
    this.error = `Порты ${this.cfg.port}–${this.cfg.port + 9} заняты`
  }
  stop(): void {
    this.server?.close()
    this.server = undefined
    this.listening = false
  }
  private listen(port: number): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res))
    return new Promise((ok, fail) => {
      server.once('error', fail)
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        ok()
      })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (code: number, body?: unknown) => {
      res.writeHead(code, body === undefined ? {} : { 'Content-Type': 'application/json' })
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    // a page in a browser never gets in (DNS rebinding, a site calling localhost)
    const origin = req.headers.origin
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return json(403, { error: 'origin' })
    if (!(req.url ?? '').startsWith('/mcp')) return json(404)
    if (req.headers.authorization !== `Bearer ${this.cfg.token}`) return json(401, { error: 'Нужен токен Qvarch (Настройки → AI-ассистенты)' })
    if (req.method === 'GET' || req.method === 'DELETE') return json(405)
    if (req.method !== 'POST') return json(405)
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 10 * 1024 * 1024) return json(413)
    }
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    const list = Array.isArray(msg) ? msg : [msg]
    const out = (await Promise.all(list.map((m) => this.rpc(m as Rpc)))).filter((x) => x !== undefined)
    if (!out.length) return json(202)
    json(200, Array.isArray(msg) ? out : out[0])
  }

  private async rpc(m: Rpc): Promise<unknown> {
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } })
    // a notification / a response: nothing back
    if (m.id === undefined || m.id === null || !m.method) return undefined
    switch (m.method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'qvarch', title: 'Qvarch Assistant', version: this.version },
          instructions:
            'Qvarch — блокнот с исполняемыми заметками (HTTP, JS/TS, Playwright), «Моя работа» (учёт времени), Jira и встроенный браузер. Перед тем как писать блоки, вызови qvarch_guide. Автотесты по задаче — в папке задачи (task_folder). Учитывай время работы через work_track.',
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: this.tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
      case 'tools/call': {
        const name = String(m.params?.name ?? '')
        const t = this.tools().find((x) => x.name === name)
        if (!t) return fail(-32602, `Нет инструмента ${name}`)
        try {
          const text = await t.run((m.params?.arguments ?? {}) as Record<string, unknown>)
          return ok({ content: [{ type: 'text', text }] })
        } catch (e) {
          return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
        }
      }
      default:
        return fail(-32601, `Метод ${m.method} не поддерживается`)
    }
  }

  /** The stdio bridge for Claude Desktop (run as: <the app's exe> <this file>, ELECTRON_RUN_AS_NODE=1). */
  private writeBridge(): void {
    const src = `// Qvarch Assistant — MCP over stdio for Claude Desktop: each line goes to the app's local server.
const http = require('http')
const fs = require('fs')
const path = require('path')
const cfgFile = path.join(__dirname, 'mcp.json')
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch { return {} } }
const port = ${this.port || this.cfg.port}
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (line) send(line)
  }
})
function send(line) {
  let id = null
  try { id = JSON.parse(line).id ?? null } catch {}
  const c = readCfg()
  const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + c.token } }, (res) => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', (x) => (body += x))
    res.on('end', () => { if (res.statusCode === 200 && body) process.stdout.write(body.replace(/\\n/g, ' ') + '\\n') })
  })
  req.on('error', () => {
    if (id !== null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Qvarch Assistant не запущен — откройте приложение' } }) + '\\n')
  })
  req.end(line)
}
`
    writeFileSync(this.bridgeFile, src)
  }
}
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> & { name?: string; arguments?: unknown; protocolVersion?: string } }

/** Whether a host is on the allowed list (wildcards *). */
export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase()
  return allow.some((p) => new RegExp(`^${p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(h))
}
