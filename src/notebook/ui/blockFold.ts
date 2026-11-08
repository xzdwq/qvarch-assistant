import { inject, provide, type InjectionKey, type Ref } from 'vue'
import { useFold } from '@renderer/lib/foldState'

/**
 * A component of a note folded to its head (remembered per block). The editor's host gives every foldable block its
 * fold (BlockSpec.fold): a block that folds to its own head (`own` — a run head) takes it — its head stays, the
 * chevron at its start, its body goes; any other is folded by the host to a head line of the same look.
 */
const FOLD: InjectionKey<Ref<boolean>> = Symbol('blockFold')

/** The host's fold of its block (`id` — the block's lasting identity in the note): open or folded. */
export function provideBlockFold(id: () => string): Ref<boolean> {
  const open = useFold(id, true)
  provide(FOLD, open)
  return open
}

/** The fold a block folding to its own head takes from its host: whether it is open, how to set it (none — not in a host). */
export function useBlockFold(): { readonly open: boolean; set(open: boolean): void } | undefined {
  const open = inject(FOLD, undefined)
  if (!open) return undefined
  return {
    get open() {
      return open.value
    },
    set: (on: boolean) => void (open.value = on),
  }
}
