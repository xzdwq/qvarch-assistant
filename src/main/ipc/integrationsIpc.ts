import { BrowserWindow, app as electronApp, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanFileName } from '../../shared/transport/chat'
import type { AppContext } from '../app/appContext'
import { SharedStates } from '../transport/sharedStates'
import { handle, listen } from './router'

/** Outlook / Teams (meetings → blocks, the Teams status → a call), the transport server and its chat, Jira (tasks, releases, sign-in, sync). */
export function registerIntegrationsIpc(app: AppContext): void {
  const { outlook, jira } = app
  handle('outlookState', () => outlook.state())
  handle('outlookLogin', () => outlook.login())
  handle('outlookLogout', () => outlook.logout())
  handle('outlookSync', () => outlook.sync())

  const { transport } = app
  handle('transportState', () => transport.state())
  handle('transportSetCode', (_e, code) => transport.setCode(String(code ?? '')))
  handle('transportReconnect', () => transport.reconnect())
  handle('serverCall', (_e, method, params) => transport.call(String(method), params))
  const shared = new SharedStates(app.store.root, app.vault.root)
  handle('sharedFolders', () => shared.links())
  handle('sharedFind', (_e, doc) => shared.find(String(doc)))
  listen('sharedLog', (_e, line) => transport.log.write(`window ${String(line).slice(0, 500)}`))
  handle('sharedFolderLink', (_e, dir, link) => shared.writeLink(String(dir), link && typeof link === 'object' ? link : null))
  handle('sharedLoad', (_e, doc) => shared.load(String(doc)))
  handle('sharedSave', (_e, doc, state) => shared.save(String(doc), String(state)))
  handle('sharedMedia', (_e, space, rels, ways) => transport.syncMedia(String(space), Array.isArray(rels) ? rels.map(String) : [], { send: ways?.send !== false, fetch: ways?.fetch !== false }))
  handle('sharedResultsPut', (_e, space, doc, entries) => transport.results.put(String(space), String(doc), entries && typeof entries === 'object' ? entries : {}))
  handle('chatFilePut', (_e, room, name, mime, bytes) => transport.files.put(String(room), String(name), String(mime ?? ''), bytes instanceof Uint8Array ? bytes : new Uint8Array()))
  handle('chatFileGet', (_e, room, id) => transport.files.get(String(room), String(id)))
  handle('chatFileSave', async (e, room, id, name) => {
    const bytes = await transport.files.get(String(room), String(id))
    const opts = { defaultPath: join(electronApp.getPath('downloads'), cleanFileName(String(name))) }
    const w = BrowserWindow.fromWebContents(e.sender)
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, bytes)
    return true
  })
  handle('sharedResultsGet', (_e, space, doc, since) => transport.results.get(String(space), String(doc), Number(since) || 0))

  handle('jiraState', () => jira.state())
  handle('jiraLogin', () => jira.login())
  handle('jiraLogout', () => jira.logout())
  handle('jiraSync', () => jira.sync())
  handle('jiraSetSecret', (_e, secret) => jira.setSecret(String(secret ?? '')))
  handle('jiraStar', (_e, key, on) => jira.star(key, on))
  handle('jiraSetMyStatus', (_e, key, status) => jira.setMyStatus(key, status))
  handle('jiraFind', (_e, q, offset, limit, mode, query) => jira.find(String(q ?? ''), Number(offset) || 0, Number(limit) || 50, mode === 'pick' ? 'pick' : 'list', query && typeof query === 'object' ? query : undefined))
  handle('jiraIssue', (_e, key) => jira.issue(String(key)))
  handle('jiraVersions', (_e, q, offset, limit) => jira.findVersions(String(q ?? ''), Number(offset) || 0, Number(limit) || 40))
  handle('jiraVersionIssues', (_e, id) => jira.versionIssues(String(id)))
}
