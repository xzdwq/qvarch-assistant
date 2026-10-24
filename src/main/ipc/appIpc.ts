import type { AppContext } from '../app/appContext'
import { handle, listen } from './router'

/** The app itself: its settings (applied where they act), the island's place and focus, opening the main window, commands. */
export function registerAppIpc(app: AppContext): void {
  const { store, windows } = app
  handle('getSettings', () => store.publicSettings())
  handle('updateSettings', (_e, patch) => {
    const outlookBefore = JSON.stringify(store.cfg.outlook)
    const jiraEvery = store.cfg.jira.syncMin
    store.update(patch)
    if (patch.ui?.theme) windows.applyTheme()
    if (JSON.stringify(store.cfg.outlook) !== outlookBefore) app.outlook.start()
    if (store.cfg.jira.syncMin !== jiraEvery) app.jira.schedule()
    if (patch.autoStart !== undefined) windows.applyAutoStart()
    if (patch.sampleIntervalMs) app.probe.setInterval(patch.sampleIntervalMs)
    if (patch.captureTitles !== undefined) app.probe.setTitles(patch.captureTitles)
    if (patch.countKeys !== undefined) app.probe.setKeys(patch.countKeys)
    if (patch.voice) app.emitToAll('onVoice', app.voice.state())
    // attributes deleted / values taken out: the days they went off are shown again
    if (patch.attributes) app.broadcast()
    const s = store.publicSettings()
    app.emitToAll('onSettings', s)
    return s
  })

  listen('islandSolid', (_e, solid) => windows.island?.setSolid(solid))
  listen('islandRect', (_e, r) => windows.island?.setRect(r))
  listen('islandBlur', () => windows.island?.blur())
  listen('islandFocus', () => windows.island?.focus())
  handle('getIslandLayout', () => windows.island?.islandLayout ?? { up: false })
  listen('openMain', (_e, day, entryId) => windows.showMain(day || entryId ? { day, entryId } : undefined))
  listen('command', (_e, cmd) => windows.runCommand(cmd))
}
