import type { HttpFolder, HttpKV } from '../../shared/http'
import type { TermConfig } from '../../shared/terminal'
import { contentsOf, type AppContext } from '../app/appContext'
import { ClipLog } from '../clipLog'
import { HttpClient } from '../http'
import { Terminals } from '../terminal'
import { emit, handle, listen } from './router'

/** The tools of the app: the terminal's shells, the HTTP client, the clipboard's history. */
export function registerToolsIpc(app: AppContext): void {
  registerTerminal(app)
  registerHttp(app)
  registerClipboardHistory(app)
}

/** Shells that live until the app quits; their output and state go to the main window (the state — to the island too). */
function registerTerminal(app: AppContext): void {
  const term = new Terminals(
    app.store.root,
    (id, data, end) => app.emitToMain('onTermData', id, data, end),
    (list) => {
      app.emitToMain('onTermState', list)
      emit(contentsOf(app.windows.island?.win), 'onTermState', list)
    },
    (list, watchError) => app.emitToMain('onTermAlerts', { list, watchError }),
  )
  app.terminals = term
  handle('termCreate', (_e, cwd) => term.create(typeof cwd === 'string' ? cwd : undefined))
  listen('termWrite', (_e, id, data) => term.write(String(id), String(data)))
  listen('termResize', (_e, id, cols, rows) => term.resize(String(id), Number(cols), Number(rows)))
  handle('termKill', (_e, id) => term.kill(String(id)))
  handle('termRename', (_e, id, title) => term.rename(String(id), String(title)))
  handle('termReplay', (_e, id) => term.replay(String(id)))
  handle('termValues', (_e, id) => term.values(typeof id === 'string' ? id : undefined))
  handle('termAlerts', () => term.alerts())
  handle('termDismiss', (_e, id) => term.dismiss(typeof id === 'string' ? id : undefined))
  handle('termList', () => term.list())
  handle('termDirs', (_e, p) => term.dirs(String(p)))
  handle('termConfig', () => term.cfg)
  handle('termSetConfig', (_e, c) => term.setConfig(JSON.parse(JSON.stringify(c)) as Partial<TermConfig>))
  handle('termRender', (_e, id, cmd, answers) => term.render(String(id), String(cmd), answers ?? {}))
}

/** The HTTP section: its collection, a request run, a folder's chain (its steps as events), import from the browser. */
function registerHttp(app: AppContext): void {
  const http = new HttpClient(app.store.root)
  handle('httpLoad', () => http.load())
  handle('httpSave', (_e, doc) => http.save(doc))
  handle('httpRun', (_e, req, doc, runId) => http.run(req, doc, typeof runId === 'string' ? runId : undefined))
  handle('httpChain', (_e, ids, doc, stopOn, runId) => http.chain(Array.isArray(ids) ? ids.map(String) : [], doc, String(stopOn ?? ''), String(runId), (i, id, out) => app.emitToMain('onHttpChain', runId, i, id, out)))
  handle('httpAbort', (_e, runId) => http.abort(String(runId)))
  handle('httpImport', (_e, folder, vars) => http.import(JSON.parse(JSON.stringify(folder)) as HttpFolder, JSON.parse(JSON.stringify(vars)) as HttpKV[]))
}

/** The clipboard's history (texts copied anywhere; kept encrypted, the last 1000). */
function registerClipboardHistory(app: AppContext): void {
  const clips = new ClipLog(app.store.root, (s) => app.emitToMain('onClip', s))
  app.clipLog = clips
  handle('clipGet', () => clips.get())
  handle('clipSet', (_e, on) => clips.setOn(!!on))
  handle('clipRemove', (_e, id) => clips.remove(String(id)))
  handle('clipClear', () => clips.clear())
  handle('clipCopy', (_e, id) => clips.copy(String(id)))
}
