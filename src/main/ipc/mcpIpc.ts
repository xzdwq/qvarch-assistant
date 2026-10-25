import { app as electronApp, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpClient } from '../../shared/api'
import { contentsOf, type AppContext } from '../app/appContext'
import { Mcp, type McpTool } from '../mcp'
import { qvarchTools, type ToolCtx } from '../mcpTools'
import { CLAUDE_MISSING, commandOf, findClaude, viaShell } from '../agent/claudePath'
import { saveEntry } from '../tracker/dayEdits'
import { emit, handle, listen } from './router'
import { WindowAsk } from './windowAsk'

/** What the agents' runner takes from here: the server (turn tokens), what the tools are made of. */
export interface McpHost {
  mcp: Mcp
  toolCtx: ToolCtx
}
/**
 * AI assistants (MCP): the server and its tools; the notes' part is done by the window (where the editor holds the
 * notes) — asked by a message, answered by mcpReply.
 */
export function registerMcpIpc(app: AppContext): McpHost {
  const asker = new WindowAsk((id, op, args) => {
    const w = contentsOf(app.windows.main)
    if (w) emit(w, 'onMcpCall', id, op, args)
    return !!w
  }, 'Окно Qvarch закрыто — откройте приложение')
  listen('mcpReply', (_e, id, ok, value) => asker.settle(String(id), ok, value))
  /** The window asked to do something with the notes; its answer (a run may take long — tests; the rest — seconds). */
  const askWindow = <T>(op: string, args: Record<string, unknown>): Promise<T> => asker.ask<T>(op, args, op === 'run' ? 30 * 60_000 : 60_000)
  const toolCtx: ToolCtx = {
    tree: () => app.vault.tree(),
    mkdir: (dir, name) => app.vault.create(dir, 'folder', name),
    issue: (key) => app.jira.issue(key),
    findIssues: (q) => app.jira.find(q, 0, 20).items,
    day: (d) => app.store.day(d),
    saveEntry: (d, input, opts) => saveEntry(app, d, input, opts),
    openInBrowser: (url) => void app.browser?.open(url),
    ui: askWindow,
    kinds: () => app.store.cfg.kinds,
    allow: (): string[] => mcp.cfg.allow,
    confirmHosts: async (hosts, note) => {
      const opts = {
        type: 'warning' as const,
        title: 'AI-ассистент: запуск против стенда',
        message: `${note}: адреса не из разрешённого списка`,
        detail: `${hosts.join('\n')}\n\nРазрешены без вопроса: ${mcp.cfg.allow.join(', ')}. Это может быть рабочий стенд — тесты могут менять данные. Разрешить на этот сеанс?`,
        buttons: ['Запретить', 'Разрешить'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }
      const main = app.windows.main
      const r = main && !main.isDestroyed() && main.isVisible() ? await dialog.showMessageBox(main, opts) : await dialog.showMessageBox(opts)
      return r.response === 1
    },
  }
  const mcp: Mcp = new Mcp(app.store.root, (): McpTool[] => qvarchTools(toolCtx), electronApp.getVersion())
  void mcp.restart()
  electronApp.on('will-quit', () => mcp.stop())
  handle('mcpInfo', () => mcp.info())
  handle('mcpSet', (_e, patch) => mcp.set(patch ?? {}))
  handle('mcpInstall', (_e, client) => {
    // (anything but Claude Desktop is set up as Claude Code, as before)
    const install = MCP_INSTALLERS[client === 'desktop' ? 'desktop' : 'code']
    return install(mcp.info())
  })
  return { mcp, toolCtx }
}

type McpServerInfo = ReturnType<Mcp['info']>
/** How Qvarch is set up in each AI client; the answer is what to tell the user. */
const MCP_INSTALLERS: Record<McpClient, (i: McpServerInfo) => Promise<string>> = {
  // Claude Desktop: its config gets the stdio bridge (the app's exe runs it as Node)
  desktop: async (i) => {
    const file = join(electronApp.getPath('appData'), 'Claude', 'claude_desktop_config.json')
    let cfg: { mcpServers?: Record<string, unknown> } = {}
    try {
      if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) as typeof cfg
    } catch {
      throw new Error(`Не удалось прочитать ${file} — поправьте его вручную`)
    }
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), qvarch: { command: i.exe, args: [i.bridge], env: { ELECTRON_RUN_AS_NODE: '1' } } }
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(cfg, null, 2))
    return `Готово: ${file}. Перезапустите Claude Desktop.`
  },
  // Claude Code (VS Code and the terminal share it): its own command, for the user
  code: async (i) => {
    // (the app is not started from a terminal: Claude Code is looked for where it is usually put, not only on the PATH)
    const bin = await findClaude(true)
    if (!bin) throw new Error(`${CLAUDE_MISSING}. Или выполните команду ниже вручную`)
    const shell = viaShell(bin)
    const { execFile } = await import('node:child_process')
    const run = (args: string[]) =>
      new Promise<string>((ok, fail) =>
        execFile(commandOf(bin), shell ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args, { shell, timeout: 30_000, windowsHide: true, env: bin.env, encoding: 'utf8' }, (err, out, errOut) =>
          err ? fail(new Error(String(errOut || err.message).trim().slice(0, 400))) : ok(String(out).trim()),
        ),
      )
    // set up anew: one set up before (an old token, an old port) is replaced
    await run(['mcp', 'remove', '--scope', 'user', 'qvarch']).catch(() => undefined)
    return (await run(['mcp', 'add', '--transport', 'http', '--scope', 'user', 'qvarch', i.url, '--header', `Authorization: Bearer ${i.token}`])) || 'Готово: qvarch добавлен в Claude Code'
  },
}
