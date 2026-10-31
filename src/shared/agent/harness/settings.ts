import { DEFAULT_HARNESS, DEFAULT_HARNESS_LIMITS, HARNESS_PHASES, type HarnessLimits, type HarnessSettings } from './constants'
import type { HarnessRun } from './model'

const int = (v: unknown, def: number, min: number, max: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
/** The limits as kept (each within reason; a wrong one — the default). */
export function cleanLimits(x: unknown): HarnessLimits {
  const o = (x ?? {}) as Partial<Record<keyof HarnessLimits, unknown>>
  const d = DEFAULT_HARNESS_LIMITS
  return {
    iterations: int(o.iterations, d.iterations, 1, 200),
    minutes: int(o.minutes, d.minutes, 1, 24 * 60),
    sameFailure: int(o.sameFailure, d.sameFailure, 2, 20),
    turnErrors: int(o.turnErrors, d.turnErrors, 1, 10),
    silentTurns: int(o.silentTurns, d.silentTurns, 1, 10),
  }
}
/** The harness's settings as kept. */
export function cleanHarnessSettings(x: unknown): HarnessSettings {
  const o = (x ?? {}) as Partial<Record<keyof HarnessSettings, unknown>>
  return {
    limits: cleanLimits(o.limits),
    confirmPlan: typeof o.confirmPlan === 'boolean' ? o.confirmPlan : DEFAULT_HARNESS.confirmPlan,
    reviewer: typeof o.reviewer === 'string' ? o.reviewer.slice(0, 100) : DEFAULT_HARNESS.reviewer,
  }
}
/** A run as read back from the disk (its shape only — the app wrote it). */
export const isHarnessRun = (x: unknown): x is HarnessRun => {
  const r = x as HarnessRun
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.room === 'string' && typeof r.goal === 'string' && HARNESS_PHASES.includes(r.phase) && Array.isArray(r.steps) && Array.isArray(r.criteria) && Array.isArray(r.log) && Array.isArray(r.hints)
}
