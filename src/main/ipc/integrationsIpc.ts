import { BrowserWindow, app as electronApp, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUNDLE_EXT, MAX_BUNDLE, parseBundle } from '../../shared/docBundle'
import { cleanFileName } from '../../shared/transport/chat'
import type { AppContext } from '../app/appContext'
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
  const shared = transport.states
  handle('sharedFolders', () => shared.links())
  handle('sharedFind', (_e, doc) => shared.find(String(doc)))
  listen('sharedLog', (_e, line) => transport.log.write(`window ${String(line).slice(0, 500)}`))
  handle('sharedFolderLink', (_e, dir, link) => shared.writeLink(String(dir), link && typeof link === 'object' ? link : null))
  handle('sharedLoad', (_e, doc) => shared.load(String(doc)))
  handle('sharedSave', (_e, doc, kept) => shared.save(String(doc), { state: String(kept?.state ?? ''), ...(typeof kept?.text === 'string' ? { text: kept.text } : {}) }))
  handle('sharedMedia', (_e, space, rels, ways) => transport.syncMedia(String(space), Array.isArray(rels) ? rels.map(String) : [], { send: ways?.send !== false, fetch: ways?.fetch !== false }))
  handle('sharedResultsPut', (_e, space, doc, changes) => transport.results.put(String(space), String(doc), changes && typeof changes === 'object' ? changes : {}))
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
  handle('chatFileFromNotes', (_e, room, rel, withRuns) => {
    const path = String(rel)
    const { bundle } = app.vault.exportDoc(path, withRuns === true, electronApp.getVersion())
    const name = (path.replace(/\/+$/, '').split('/').pop() || 'Блокнот').replace(/\.(md|qboard)$/i, '')
    return transport.files.put(String(room), `${name}.${BUNDLE_EXT}`, 'application/json', new TextEncoder().encode(JSON.stringify(bundle)))
  })
  handle('chatFileToNotes', async (_e, room, id, dir) => {
    const bytes = await transport.files.get(String(room), String(id))
    if (bytes.byteLength > MAX_BUNDLE) throw new Error(`Файл больше ${MAX_BUNDLE / 1024 / 1024} МБ`)
    return app.vault.importDoc(parseBundle(new TextDecoder().decode(bytes)), String(dir ?? ''))
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
