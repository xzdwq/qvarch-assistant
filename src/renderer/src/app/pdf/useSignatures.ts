import { onMounted, ref } from 'vue'

/** The user's drawn signatures (kept by the app): listed, a new one saved from the pad, one deleted. */
export function useSignatures() {
  const sigs = ref<Array<{ id: string; url: string }>>([])
  /** The signature pad is open. */
  const padOpen = ref(false)
  const load = async () => (sigs.value = await window.qa.sigList())
  onMounted(load)
  async function save(url: string): Promise<void> {
    padOpen.value = false
    await window.qa.sigSave(url)
    await load()
  }
  async function remove(id: string): Promise<void> {
    await window.qa.sigDelete(id)
    await load()
  }
  return { sigs, padOpen, save, remove }
}
export type Signatures = ReturnType<typeof useSignatures>
