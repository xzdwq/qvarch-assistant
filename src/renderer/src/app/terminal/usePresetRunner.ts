import { nextTick, ref } from 'vue'
import { presetAsks, type TermPreset } from '@shared/terminal'
import { remoteError } from '../../../../shared/remoteError'
import type { TermShells } from './useTermShells'

/**
 * Running a preset: its ask(…) questions first, then the command worked out (in the main process, for the shell in
 * front) and typed into that shell; an insert that came out empty is shown first (the command would be cut).
 */
export function usePresetRunner(shells: TermShells) {
  const asking = ref<{ preset: TermPreset; fields: Array<{ label: string; value: string }> }>()
  const emptyAsk = ref<{ preset: TermPreset; id: string; text: string; empty: string[] }>()
  /** The last failure of a preset or of the variables' values. */
  const runError = ref('')

  async function runPreset(p: TermPreset): Promise<void> {
    runError.value = ''
    const asks = presetAsks(p.cmd)
    if (asks.length) {
      asking.value = { preset: p, fields: asks.map((a) => ({ label: a.label, value: a.def })) }
      return
    }
    await typePreset(p, {})
  }
  /** The command worked out with the answers and typed into the shell in front (a new one when there is none). */
  async function typePreset(p: TermPreset, answers: Record<string, string>): Promise<void> {
    const id = shells.curId.value ?? (await shells.newShell())
    if (!id) return
    try {
      const { text, empty } = await window.qa.termRender(id, p.cmd, answers)
      // an insert came out empty (no git branch here…) — ask first, the command would be cut
      if (empty.length) {
        emptyAsk.value = { preset: p, id, text, empty }
        return
      }
      await nextTick()
      shells.paneRefs.get(id)?.type(text, p.run)
    } catch (e) {
      runError.value = remoteError(e)
    }
  }
  /** The command with an empty insert typed anyway: run, or only typed in to finish by hand. */
  function emptyGo(run: boolean): void {
    const a = emptyAsk.value
    emptyAsk.value = undefined
    if (a) shells.paneRefs.get(a.id)?.type(a.text, run)
  }
  /** The questions answered: the preset goes on. */
  async function submitAsk(): Promise<void> {
    const a = asking.value
    if (!a) return
    asking.value = undefined
    await typePreset(a.preset, Object.fromEntries(a.fields.map((f) => [f.label, f.value])))
  }
  return { asking, emptyAsk, runError, runPreset, emptyGo, submitAsk }
}
