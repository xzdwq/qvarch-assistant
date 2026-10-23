import { constants, setPriority } from 'node:os'
import { readProjects, releaseState, setReleaseDataDir } from './config'
import { setReleaseSink, type ReleaseMessage } from './panel'
import { ReleaseSession } from './session'

/**
 * The release builder in its own process (an Electron utility process): scanning hundreds of branches,
 * building the chronology and the dry-run spawn many git processes and parse their output — on the main
 * thread that froze the whole app and, with a dozen git processes at normal priority, the mouse too.
 * Here it runs apart, below normal priority (git processes started from here inherit it on Windows).
 */
try {
  setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL)
} catch {
  // not allowed — fine
}

type In = { type: 'init'; dataDir: string } | { type: 'open'; id: string; resume?: boolean } | { type: 'cmd'; msg: { command: string } & Record<string, unknown> }

const port = process.parentPort
setReleaseSink((msg: ReleaseMessage) => port.postMessage({ type: 'msg', msg }))
let session: ReleaseSession | undefined

port.on('message', (e) => {
  const m = e.data as In
  try {
    switch (m.type) {
      case 'init':
        setReleaseDataDir(m.dataDir)
        break
      case 'open': {
        const project = readProjects().find((p) => p.id === m.id)
        if (!project) throw new Error('Проект не найден')
        session = new ReleaseSession({ workspaceState: releaseState })
        const ctx = { projectId: project.id, projectName: project.name }
        void (m.resume ? session.resume(project, ctx) : session.start(project, ctx))
        break
      }
      case 'cmd':
        void session?.dispatch(m.msg)
        break
      default: {
        // a message this worker does not know — ignored
        const unknown: never = m
        void unknown
      }
    }
  } catch (err) {
    port.postMessage({ type: 'msg', msg: { command: 'error', message: err instanceof Error ? err.message : String(err) } })
  }
})
