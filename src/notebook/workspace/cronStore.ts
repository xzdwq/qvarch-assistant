import { shallowRef } from 'vue'
import type { CronJob } from '@shared/cronJobs'

/** The notes run on a schedule, as main keeps them (read once, then kept up by its news). */
const jobs = shallowRef<CronJob[]>([])
let started = false
export function useCronJobs(): typeof jobs {
  if (!started) {
    started = true
    void window.qa.cronList().then((j) => (jobs.value = j))
    window.qa.onCrons((j) => (jobs.value = j))
  }
  return jobs
}
