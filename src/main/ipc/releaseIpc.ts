import { app as electronApp, dialog, utilityProcess, type UtilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { contentsOf, type AppContext } from '../app/appContext'
import { deleteProject, importVscodeProjects, readProjects, saveProject, setReleaseDataDir } from '../release/config'
import { emit, handle } from './router'

/**
 * The release builder (the former VS Code extension): its projects, and its git work in a process of its own below
 * normal priority — the app (and the mouse) stay smooth; its news go to the main window as they come.
 */
export function registerReleaseIpc(app: AppContext): void {
  setReleaseDataDir(app.store.root)
  let releaseWorker: UtilityProcess | undefined
  const worker = (): UtilityProcess => {
    if (releaseWorker) return releaseWorker
    const w = utilityProcess.fork(app.script('releaseWorker.js'), [], { serviceName: 'Qvarch Release' })
    w.on('message', (m: { type: string; msg?: { command: string } & Record<string, unknown> }) => {
      if (m?.type === 'msg' && m.msg) emit(contentsOf(app.windows.main), 'onRelease', m.msg)
    })
    w.on('exit', () => {
      if (releaseWorker === w) releaseWorker = undefined
    })
    w.postMessage({ type: 'init', dataDir: app.store.root })
    releaseWorker = w
    return w
  }
  electronApp.on('before-quit', () => releaseWorker?.kill())
  handle('releaseOpen', (_e, id, resume) => {
    if (!readProjects().some((p) => p.id === id)) throw new Error('Проект не найден')
    // the section gets its data by messages as git answers — the call itself returns at once
    worker().postMessage({ type: 'open', id, resume })
  })
  handle('releaseCmd', (_e, msg) => worker().postMessage({ type: 'cmd', msg }))
  handle('releaseProjects', () => readProjects())
  handle('releaseSaveProject', (_e, p) => saveProject(p))
  handle('releaseDeleteProject', (_e, id) => deleteProject(id))
  handle('releaseImport', () => importVscodeProjects())
  handle('releasePickFolder', async () => {
    const main = app.windows.main
    const r = main ? await dialog.showOpenDialog(main, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? undefined : r.filePaths[0]
  })
  handle('releaseOpenInCode', (_e, path) => {
    // "code" is a .cmd on Windows — through the shell; the path is quoted
    const child = spawn('code', [`"${path.replace(/"/g, '')}"`], { shell: true, detached: true, stdio: 'ignore' })
    child.unref()
  })
}
