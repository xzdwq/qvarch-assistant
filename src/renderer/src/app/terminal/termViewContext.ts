import { inject, provide, ref, type InjectionKey } from 'vue'
import { useTermAlerts } from '../../lib/terminal'
import { usePresetEditor } from './usePresetEditor'
import { usePresetRunner } from './usePresetRunner'
import { useTermConfig } from './useTermConfig'
import { useTermShells } from './useTermShells'
import { useTermViewPrefs } from './useTermViewPrefs'
import { useVarEditor } from './useVarEditor'
import { useWatchEditor } from './useWatchEditor'

/** Everything the terminal section's parts share: the view's settings, the shells, the config and its editors. */
function createTermView() {
  const prefs = useTermViewPrefs()
  const { alerts, watchError } = useTermAlerts()
  const config = useTermConfig()
  const shells = useTermShells()
  const runner = usePresetRunner(shells)
  const presets = usePresetEditor(config)
  const vars = useVarEditor(config, shells, prefs.sideTab, runner.runError)
  const watches = useWatchEditor(config)
  /** The guide dialog open. */
  const helpOpen = ref(false)
  return { prefs, alerts, watchError, config, shells, runner, presets, vars, watches, helpOpen }
}
export type TermView = ReturnType<typeof createTermView>
const TERM_VIEW: InjectionKey<TermView> = Symbol('termView')

/** The terminal section's shared state, made by the section and given to its parts. */
export function provideTermView(): TermView {
  const view = createTermView()
  provide(TERM_VIEW, view)
  return view
}
/** The terminal section's shared state, inside one of its parts. */
export function useTermView(): TermView {
  const view = inject(TERM_VIEW)
  if (!view) throw new Error('useTermView: outside the terminal section')
  return view
}
