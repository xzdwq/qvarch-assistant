import { ref, type Ref } from 'vue'
import type { TermConfig } from '@shared/terminal'
import { moveItem } from '@shared/terminalEdit'
import { startListDrag } from '../../lib/listDrag'
import type { TermConfigState } from './useTermConfig'

type ListKey = 'presets' | 'vars' | 'watches'

/** Reordering one of the settings' lists (presets / variables / reactions) by the handle; kept when dropped. */
export function useConfigListReorder<K extends ListKey>({ cfg, saveCfg }: TermConfigState, key: K, listEl: Ref<HTMLElement | undefined>, onReordered?: () => void) {
  const dragId = ref<string>()
  function startDrag(e: PointerEvent, id: string): void {
    if (!listEl.value) return
    dragId.value = id
    startListDrag(e, {
      list: listEl.value,
      index: (cfg.value[key] as Array<{ id: string }>).findIndex((p) => p.id === id),
      move: (from, to) => {
        cfg.value[key] = moveItem(cfg.value[key] as TermConfig[K] & unknown[], from, to) as TermConfig[K]
      },
      done: () => {
        dragId.value = undefined
        saveCfg({ [key]: cfg.value[key] })
        onReordered?.()
      },
    })
  }
  return { dragId, startDrag }
}
