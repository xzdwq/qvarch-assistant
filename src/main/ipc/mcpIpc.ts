import { app as electronApp, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpClient } from '../../shared/api'
import { contentsOf, type AppContext } from '../app/appContext'
import { Mcp, type McpTool } from '../mcp'
import { qvarchTools } from '../mcpTools'
import { saveEntry } from '../tracker/dayEdits'
import { emit, handle, listen } from './router'

/**
 * AI assistants (MCP): the server and its tools; the notes' part is done by the window (where the editor holds the
 * notes) — asked by a message, answered by mcpReply.
 */
export function registerMcpIpc(app: AppContext): void {
  const pending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }>()
  listen('mcpReply', (_e, id, ok, value) => {
    const p = pending.get(String(id))
    if (!p) return
    pending.delete(String(id))
    clearTimeout(p.timer)
    if (ok) p.ok(value)
    else p.fail(new Error(String(value)))
  })
  /** The window asked to do something with the notes; its answer. */
  const askWindow = <T>(op: string, args: Record<string, unknown>): Promise<T> =>
    new Promise<T>((ok, fail) => {
      const w = contentsOf(app.windows.main)
      if (!w) return fail(new Error('Окно Qvarch закрыто — откройте приложение'))
      const id = randomUUID()
      // a run may take long (tests); the rest — seconds
      const timer = setTimeout(() => (pending.delete(id), fail(new Error('Окно Qvarch не ответило'))), op === 'run' ? 30 * 60_000 : 60_000)
      pending.set(id, { ok: ok as (v: unknown) => void, fail, timer })
      emit(w, 'onMcpCall', id, op, args)
    })
  const mcp: Mcp = new Mcp(
    app.store.root,
    (): McpTool[] =>
      qvarchTools({
        tree: () => app.vault.tree(),
        mkdir: (dir, name) => app.vault.create(dir, 'folder', name),
        issue: (key) => app.jira.issue(key),
        findIssues: (q) => app.jira.find(q, 0, 20).items,
        day: (d) => app.store.day(d),
        saveEntry: (d, input, opts) => saveEntry(app, d, input, opts),
        openInBrowser: (url) => void app.browser?.open(url),
        ui: askWindow,
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
      }),
    electronApp.getVersion(),
  )
  void mcp.restart()
  electronApp.on('will-quit', () => mcp.stop())
  handle('mcpInfo', () => mcp.info())
  handle('mcpSet', (_e, patch) => mcp.set(patch ?? {}))
  handle('mcpInstall', (_e, client) => {
    // (anything but Claude Desktop is set up as Claude Code, as before)
    const install = MCP_INSTALLERS[client === 'desktop' ? 'desktop' : 'code']
    return install(mcp.info())
  })
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
    const args = ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'qvarch', i.url, '--header', `Authorization: Bearer ${i.token}`]
    const { execFile } = await import('node:child_process')
    return new Promise<string>((ok, fail) =>
      execFile('claude', args, { shell: true, timeout: 30_000, windowsHide: true }, (err, out, errOut) => {
        if (err) fail(new Error(/not recognized|не является|ENOENT/i.test(String(errOut) + String(err)) ? 'Команда claude не найдена — выполните её вручную (скопируйте ниже)' : String(errOut || err.message).trim()))
        else ok(String(out).trim() || 'Готово: qvarch добавлен в Claude Code')
      }),
    )
  },
}
