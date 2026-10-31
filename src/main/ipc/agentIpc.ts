import { app as electronApp } from 'electron'
import type { TurnRequest } from '../../shared/agent/turn'
import { AgentRunner } from '../agent/agentRunner'
import { AgentStore } from '../agent/agentStore'
import { HarnessStore } from '../agent/harnessStore'
import { GuideStore } from '../agent/guideStore'
import { guideIdOf } from '../../shared/agent/harness/guides'
import { contentsOf, type AppContext } from '../app/appContext'
import type { McpHost } from './mcpIpc'
import { emit, handle, listen } from './router'

/** The AI agents: their profiles (keys kept encrypted) and their turns, asked by the window's chats. */
export function registerAgentIpc(app: AppContext, host: McpHost): void {
  const store = new AgentStore(app.store.root, () => app.store.cfg.transport.name)
  const guides = new GuideStore(app.store.db.db)
  const runner = new AgentRunner(app, host, store, () => guides.list())
  handle('agentProfiles', () => store.profiles())
  handle('agentSave', (_e, profile, key) => store.save(profile, typeof key === 'string' ? key : undefined))
  handle('agentRemove', (_e, id) => store.remove(String(id)))
  handle('agentModels', (_e, id) => runner.models(String(id)))
  handle('agentRun', (_e, req: TurnRequest) =>
    runner.run(req, (line) => {
      const w = contentsOf(app.windows.main)
      if (w) emit(w, 'onAgentTrace', req.turn, line)
    }),
  )
  listen('agentStop', (_e, turn) => runner.stop(String(turn)))
  const harness = new HarnessStore(app.store.root)
  handle('harnessState', () => harness.state())
  handle('harnessSaveSettings', (_e, s) => harness.saveSettings(s))
  handle('harnessSaveRoomSettings', (_e, room, s) => harness.saveRoomSettings(String(room), s))
  handle('harnessSaveRun', (_e, run) => harness.saveRun(run))
  handle('harnessDropRun', (_e, room) => harness.dropRun(String(room)))
  // (the rules were a note of the vault before: its text becomes one of the person's instructions, once)
  const old = harness.takeOldRulesNote()
  if (old) {
    try {
      guides.save({ id: guideIdOf('my-rules', new Set(guides.list().map((g) => g.id))), title: 'Мои правила (из заметки)', summary: 'перенесено из прежней заметки правил harness', body: app.vault.read(old), enabled: true })
    } catch {
      // (the note is gone or empty: nothing to bring)
    }
  }
  handle('harnessGuides', () => guides.list())
  handle('harnessGuideSave', (_e, g) => guides.save(g))
  handle('harnessGuideRemove', (_e, id) => guides.remove(String(id)))
  handle('harnessGuideReset', (_e, id) => guides.reset(String(id)))
  electronApp.on('before-quit', () => runner.stopAll())
}
