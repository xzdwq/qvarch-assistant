import { computed, ref, watch, type Ref } from 'vue'
import type { TestFile } from '@shared/testFiles'
import { remoteError } from '@shared/remoteError'
import { noteRun, saveRunsSoon } from '@nb/engine/runStore'
import { sharedOfPath } from '@nb/workspace/sharedDocs'
import { mediaWhy } from '@shared/transport/space'
import { useTransport } from '@renderer/lib/transport'

/** A file of a set someone else has (and this computer has not). */
export interface TheirFile {
  file: Pick<TestFile, 'name' | 'size' | 'expect' | 'note'>
  by: string
}
/** A participant's list of a set's files, as the others get it (with the note's run results). */
interface SetList {
  files: TheirFile['file'][]
}
const relOf = (set: string, name: string) => `.files/${set}/${name}`

/**
 * The test files of a shared note: each participant's list of the set goes to the others (with the run results) and
 * their files to the server; one sees the files the others have and fetches one by «Загрузить себе» (never by itself).
 */
export function useSharedFiles(path: () => string, set: () => string, files: Ref<TestFile[]>, reload: () => Promise<void>) {
  const transport = useTransport()
  const shared = computed(() => (path() ? sharedOfPath(path()) : undefined))
  /** This device's list's key among the note's results (one per participant and set). */
  const prefix = () => `_files:${set()}:`
  const myKey = () => `${prefix()}${transport.value.deviceId}`

  // this device's list published (when it changed) and its files sent to the server
  watch(
    [files, shared],
    () => {
      const sh = shared.value
      if (!sh || !transport.value.deviceId) return
      const n = noteRun(path())
      const value: SetList = { files: files.value.map(({ name, size, expect, note }) => ({ name, size, expect, note })) }
      if (JSON.stringify(n.runs[myKey()]?.value) !== JSON.stringify(value)) {
        n.runs[myKey()] = { state: 'ok', at: Date.now(), value }
        saveRunsSoon(path())
      }
      if (files.value.length)
        void window.qa
          .sharedMedia(
            sh.space,
            files.value.map((f) => relOf(set(), f.name)),
            { fetch: false },
          )
          .catch(() => undefined)
    },
    { immediate: true },
  )

  /** The others' files this computer has not (by name), with who has them. */
  const theirs = computed<TheirFile[]>(() => {
    if (!shared.value) return []
    const mine = new Set(files.value.map((f) => f.name))
    const out = new Map<string, TheirFile>()
    for (const [key, r] of Object.entries(noteRun(path()).runs)) {
      if (!key.startsWith(prefix()) || !r.by) continue
      for (const file of (r.value as SetList | undefined)?.files ?? []) if (!mine.has(file.name) && !out.has(file.name)) out.set(file.name, { file, by: r.by })
    }
    return [...out.values()]
  })
  const fetching = ref('')
  const error = ref('')
  /** One of their files fetched into this set. */
  async function fetchFile(f: TheirFile): Promise<void> {
    const sh = shared.value
    if (!sh) return
    fetching.value = f.file.name
    error.value = ''
    try {
      const rel = relOf(set(), f.file.name)
      const got = await window.qa.sharedMedia(sh.space, [rel], { send: false })
      if (!got.fetched.length) error.value = `«${f.file.name}»: ${mediaWhy(got, rel) ?? `не загружено — у ${f.by} приложение должно быть открыто`}`
      else {
        if (f.file.expect || f.file.note) await window.qa.files('meta', set(), f.file.name, { expect: f.file.expect ?? null, note: f.file.note ?? '' })
        await reload()
      }
    } catch (e) {
      error.value = remoteError(e)
    } finally {
      fetching.value = ''
    }
  }
  return { shared, theirs, fetching, error, fetchFile }
}
