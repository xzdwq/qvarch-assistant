import { ref } from 'vue'
import type { TermConfig } from '@shared/terminal'

/** The terminal's settings (presets, variables, reactions, the profile switch), loaded once and saved by part. */
export function useTermConfig() {
  const cfg = ref<TermConfig>({ presets: [], vars: [], watches: [], profile: true })
  void window.qa.termConfig().then((c) => (cfg.value = c))
  /** A part of the settings kept (plain data — IPC cannot clone proxies). */
  function saveCfg(part: Partial<TermConfig>): void {
    void window.qa.termSetConfig(JSON.parse(JSON.stringify(part)) as Partial<TermConfig>)
  }
  /** New shells load the PowerShell profile or not. */
  async function setProfile(on: boolean): Promise<void> {
    cfg.value = await window.qa.termSetConfig({ profile: on })
  }
  return { cfg, saveCfg, setProfile }
}
export type TermConfigState = ReturnType<typeof useTermConfig>
