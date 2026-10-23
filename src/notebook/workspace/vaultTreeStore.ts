import { shallowRef } from 'vue'
import { filesOf, type VaultNode } from '@shared/vault'

/** The vault's tree as the page has it (and every note path in it), read again after each change. */
export const tree = shallowRef<VaultNode[]>([])
export const files = shallowRef<string[]>([])
export async function loadTree(): Promise<void> {
  tree.value = await window.qa.vaultTree()
  files.value = filesOf(tree.value)
}
