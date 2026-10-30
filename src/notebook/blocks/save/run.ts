import { formatFor, isEmptyValue } from '../../../shared/valueFiles'
import { noteName } from '../../domain/notePaths'
import { resolvePath } from '../../domain/values'
import type { BlockRunner } from '../../engine/blockRunner'
import { tookText } from '../../engine/reportText'
import { errorText, runApi } from '../../engine/runApi'
import { noteRun, saveRunsSoon } from '../../engine/runStore'
import type { BlockRun } from '../../engine/runTypes'
import { refRoot, saveOf } from './model'

const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file

/**
 * «Сохранить в файл»: the variable as it is when the run comes here (put the block after what gathers it) written as a
 * new file — only when it changed since the block's last file; empty — nothing; partial (its run stopped or failed) —
 * with a mark in its name, or nothing (`partial: skip`). In a loop's pass — a file per pass (its number in the name).
 */
export const saveRunner: BlockRunner = {
  async run({ env, item }) {
    const t0 = performance.now()
    const s = saveOf(item.body)
    const last = env.runs[item.key]?.saved
    const done = (saved: NonNullable<BlockRun['saved']>, error?: string) => {
      env.recordRun(item.key, { state: error ? 'error' : 'ok', at: Date.now(), ms: performance.now() - t0, saved, ...(error ? { error } : {}) })
      saveRunsSoon(env.notePath)
      return !error
    }
    // (what was written before stays the block's last file whatever this run does)
    const kept = { ...(last?.file ? { file: last.file } : {}), ...(last?.hash ? { hash: last.hash } : {}) }
    env.recordRun(item.key, { state: 'run', at: Date.now() })
    if (!s.ref) return done(kept, 'Укажите переменную: ref: имя')
    const res = resolvePath(env.values(), s.ref)
    if (!res.ok) return done(kept, `Нет значения {{${s.ref}}} — выполните блок, который его даёт (этот блок ставьте после него)`)
    if (isEmptyValue(res.value)) return done({ ...kept, skipped: 'пусто — файл не записан' })
    const partial = !!noteRun(env.notePath).ctx[refRoot(s.ref)]?.partial
    if (partial && s.partial === 'skip') return done({ ...kept, skipped: 'данные неполные (прогон прерван) — файл не записан' })
    const pass = /#(\d+)$/.exec(env.id)?.[1]
    try {
      const r = await runApi().valueFile('save', {
        note: noteName(env.notePath),
        name: pass ? `${s.ref} №${pass}` : s.ref,
        value: res.value,
        format: formatFor(res.value, s.format),
        ...(s.dir ? { dir: s.dir } : {}),
        ...(s.files ? { files: s.files } : {}),
        partial,
        ...(last?.hash ? { lastHash: last.hash } : {}),
      })
      return done({ file: r.file ?? last?.file, hash: r.hash, ...(r.unchanged ? { unchanged: true } : {}), ...(r.removed ? { removed: r.removed } : {}) })
    } catch (e) {
      return done(kept, errorText(e))
    }
  },
  // (written at once: nothing to stop)
  stop: () => undefined,
  resultOf: (run) => run.saved?.file,
  reportHeadline: (r) =>
    r.state === 'error' ? 'ошибка' : `${r.saved?.skipped ?? (r.saved?.unchanged ? 'без изменений — файл не записан' : r.saved?.file ? `сохранено: ${baseName(r.saved.file)}` : 'выполнен')}${tookText(r.ms)}`,
  reportDetails: (r) => (r.saved?.file && !r.saved.unchanged && !r.saved.skipped ? [`Файл: ${r.saved.file}`] : []),
}
