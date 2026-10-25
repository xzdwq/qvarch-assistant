import { app as electronApp } from 'electron'
import type { TurnRequest } from '../../shared/agent/turn'
import { AgentRunner } from '../agent/agentRunner'
import { AgentStore } from '../agent/agentStore'
import { contentsOf, type AppContext } from '../app/appContext'
import type { McpHost } from './mcpIpc'
import { emit, handle, listen } from './router'

/** The AI agents: their profiles (keys kept encrypted) and their turns, asked by the window's chats. */
export function registerAgentIpc(app: AppContext, host: McpHost): void {
  const store = new AgentStore(app.store.root, () => app.store.cfg.transport.name)
  const runner = new AgentRunner(app, host, store)
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
  electronApp.on('before-quit', () => runner.stopAll())
}
