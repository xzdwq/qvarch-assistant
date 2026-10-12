import { shallowRef } from 'vue'

/**
 * "Only this one or the whole series?" — asked when a repeated block is changed or deleted.
 * One dialog per window (SeriesAsk.vue is mounted once); the caller awaits the answer.
 */
export type SeriesScope = 'one' | 'all'
export const seriesQuestion = shallowRef<{ action: 'save' | 'delete'; resolve: (s: SeriesScope | null) => void }>()

export function askSeries(action: 'save' | 'delete'): Promise<SeriesScope | null> {
  seriesQuestion.value?.resolve(null)
  return new Promise((resolve) => {
    seriesQuestion.value = {
      action,
      resolve: (s) => {
        seriesQuestion.value = undefined
        resolve(s)
      },
    }
  })
}
