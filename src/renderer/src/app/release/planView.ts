import { computed } from 'vue'
import type { PlanItem } from '@shared/release'
import { summarizeChronology } from '@shared/releaseView'
import { planTick, rs } from '../../lib/releaseStore'

/**
 * The plan as the section's cards read it — derived once from the store and shared by the chronology,
 * the cherry-pick commands and the build. `planTick` re-reads what changes inside the items.
 */
export const plan = computed(() => rs.plan)
export const planItems = computed<PlanItem[]>(() => plan.value?.items ?? [])
export const shaToBranch = computed(() => new Map(planItems.value.map((i) => [i.sha, i.branch])))
export const includedItems = computed(() => planItems.value.filter((i) => i.included))
export const chronologySummary = computed(() => {
  void planTick.value
  return summarizeChronology(includedItems.value)
})
/** Included and not applied yet — what a manual cherry-pick or the build still has to do. */
export const pendingItems = computed(() => {
  void planTick.value
  return includedItems.value.filter((i) => !i.applied)
})
export const appliedCount = computed(() => {
  void planTick.value
  return includedItems.value.filter((i) => i.applied).length
})
export const hasRelease = computed(() => !!plan.value?.releaseBranch)
export const hasItems = computed(() => hasRelease.value && planItems.value.length > 0)
export const hasPendingBuild = computed(() => hasItems.value && planItems.value.some((i) => i.included && !i.applied))
