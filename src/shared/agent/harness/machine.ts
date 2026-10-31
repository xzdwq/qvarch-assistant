import { HARNESS_ENDED, REVIEWER_OFF, type HarnessSettings, type StopReason } from './constants'
import { stopText } from './acceptance'
import { failedCriteria, failureSignature, failureText } from './failures'
import { checkedCriteria, currentStep, LOG_MAX, type CheckResult, type HarnessLogLine, type HarnessNext, type HarnessRun, type HarnessStep } from './model'
import type { PlanGuides } from './guides'
import { appliedDraft, draftWords, droppedBy, withoutDropped, type PlanDraft } from './planDraft'
import type { CheckBinding, HarnessPlan, HarnessReport, TurnHarness } from './report'

/**
 * The harness's course: each thing that happens (a turn ended, the checks run, the person's word) moves the run on and
 * says what the app does next. Pure: the app keeps the run and does what it is told.
 */
export type HarnessEvent =
  /** A turn ended: what it gave the harness, or its error; `heard` — how many of the person's messages it was told. */
  | { kind: 'turn'; harness?: TurnHarness; error?: string; stopped?: boolean; heard?: number }
  /** The criteria's checks run: each one's result, its check block's text now (none — the block is gone). */
  | { kind: 'checked'; results: ReadonlyMap<number, CheckResult>; bodies: ReadonlyMap<number, string | undefined> }
  /** The person took the plan — as they edited it (`draft`: its steps and criteria — taken as they are). */
  | { kind: 'confirm'; draft?: PlanDraft }
  /**
   * The person took the plan with what the agent is to take in (its window: other instructions, remarks): the agent
   * plans by them — keeps its plan or makes it anew — and the work goes on at once (`go`; else the plan waits again).
   * Their edits of the plan kept in it: what they took away does not come back.
   */
  | { kind: 'replan'; guides?: PlanGuides; draft?: PlanDraft; remarks: string; go?: boolean }
  /**
   * The person set this work's settings in its chat (who reviews at the end, the limits, the plan shown first): they
   * hold from now on — a turn going on ends as it was asked.
   */
  | { kind: 'settings'; settings: HarnessSettings }
  /** The person wrote meanwhile (a remark on the plan, an answer to the agent's question, a hint). */
  | { kind: 'hint'; text: string }
  | { kind: 'stop' }
  /** Go on after a stop (the limits anew). */
  | { kind: 'resume' }
  /** The app was closed while it went on. */
  | { kind: 'interrupted' }

/** What happened and what comes next. `none` — nothing new to start (a turn or the checks are going on). */
export type HarnessMove = { run: HarnessRun; next: HarnessNext | { kind: 'none' } }

const logged = (run: HarnessRun, text: string, tone: HarnessLogLine['tone'], now: number): HarnessRun => ({ ...run, log: [...run.log, { at: now, text, tone }].slice(-LOG_MAX) })
const withStep = (steps: HarnessStep[], i: number, s: Partial<HarnessStep>): HarnessStep[] => steps.map((x, k) => (k === i ? { ...x, ...s } : x))

function ended(run: HarnessRun, reason: StopReason, now: number, why = ''): HarnessMove {
  const phase = reason === 'done' ? 'done' : reason === 'help' ? 'help' : 'stopped'
  const head = stopText(run, reason)
  const r = logged({ ...run, phase, stop: reason, checking: undefined }, why ? `${head}: ${why}` : head, reason === 'done' ? 'ok' : 'fail', now)
  return { run: r, next: { kind: phase === 'help' ? 'wait' : 'end' } }
}
/** The next work turn — within the limits (fixing what failed, when something did). */
function work(run: HarnessRun, now: number): HarnessMove {
  if (run.iteration - run.iterBase >= run.limits.iterations) return ended(run, 'iterations', now)
  if (now - run.startedAt >= run.limits.minutes * 60_000) return ended(run, 'time', now)
  return { run: { ...run, phase: 'work' }, next: { kind: 'turn', mode: run.fix ? 'fix' : 'work' } }
}
/**
 * The criteria a check asks for: at the end — all; after a step — the ones planned up to it (a criterion of a later
 * step is not due yet; one with no step — at the end only).
 */
function dueCriteria(run: HarnessRun): number[] {
  const all = checkedCriteria(run)
  if (run.finishing) return all.map((c) => c.id)
  const step = (run.checking ?? currentStep(run)) + 1
  return all.filter((c) => c.step !== undefined && c.step <= step).map((c) => c.id)
}
/** The checks due, or (none) what follows them. */
function check(run: HarnessRun, now: number): HarnessMove {
  const ids = dueCriteria(run)
  // (at the end too a check passed and unchanged since stands: the agent changes nothing but the notes — its block's text is what it checks)
  // (the values doubted run anew; the rest of a check's values — as remembered, when their inputs are the same)
  const recheck = run.recheck?.length ? { recheck: run.recheck } : {}
  if (ids.length) return { run: { ...run, phase: 'check' }, next: { kind: 'checks', baseline: false, ids, fresh: false, ...recheck } }
  return passed(run, now)
}
/** All checks green: at the end — the review (when one is set) or done; else the step done and work goes on. */
function passed(run: HarnessRun, now: number): HarnessMove {
  const step = run.checking ?? currentStep(run)
  const r = { ...run, steps: run.checking === undefined ? run.steps : withStep(run.steps, step, { state: 'done' }), checking: undefined, fix: undefined, failure: undefined }
  if (!run.finishing) return work(r, now)
  if (run.reviewer === REVIEWER_OFF) return ended(logged({ ...r, steps: r.steps.map((s) => ({ ...s, state: 'done' })), finishing: false }, 'Проверки пройдены', 'ok', now), 'done', now)
  return { run: logged({ ...r, phase: 'review' }, 'Проверки пройдены — финальная проверка', 'ok', now), next: { kind: 'turn', mode: 'review' } }
}

function onPlan(run: HarnessRun, given: HarnessPlan, now: number): HarnessMove {
  const plan = withoutDropped(given, run.dropped)
  const r = logged(
    {
      ...run,
      steps: plan.steps.map((title) => ({ title, state: 'todo' })),
      criteria: plan.criteria.map((c, i) => ({ ...c, id: i + 1 })),
      // (the person's choice stands over the agent's)
      guides: run.pinned && run.guides ? run.guides : plan.guides,
      turnErrors: 0,
      silent: 0,
      fix: undefined,
    },
    `План: ${plan.steps.length} шаг., ${plan.criteria.length} критер.`,
    'info',
    now,
  )
  // (the person pressed «Начать» already: the plan taken in goes to work — no second asking)
  if (run.confirmPlan && !run.go) return { run: { ...r, phase: 'confirm' }, next: { kind: 'wait' } }
  if (run.go) return start(logged({ ...r, go: undefined }, 'План принят', 'ok', now), now)
  return start(r, now)
}
/** Work starts: the checks first (what is red before the work), when there are any. */
function start(run: HarnessRun, now: number): HarnessMove {
  const ids = checkedCriteria(run).map((c) => c.id)
  if (ids.length) return { run: { ...run, phase: 'baseline' }, next: { kind: 'checks', baseline: true, ids, fresh: true } }
  return work(run, now)
}

/**
 * The checks the agent put on the blocks it wrote: a criterion's check moved to its block (its results gone — of
 * another block); a check given before the work stays where it is (said so).
 */
function bound(run: HarnessRun, checks: readonly CheckBinding[], now: number): HarnessRun {
  let r = run
  for (const b of checks) {
    const c = r.criteria.find((x) => x.id === b.criterion)
    if (!c) continue
    if (c.guard !== undefined) {
      r = logged(r, `Критерий ${c.id}: проверка была до начала работы — не перепривязана`, 'fail', now)
      continue
    }
    // (the same block: its result stands — only what it is to show may change; another block — checked anew)
    const same = c.check?.path === b.path && c.check?.block === b.block
    const expect = b.expect ? { expect: b.expect } : {}
    const criteria = r.criteria.map((x) => (x.id !== c.id ? x : same ? { ...x, ...expect } : { ...x, check: { path: b.path, block: b.block }, ...expect, result: undefined, ranOn: undefined }))
    const what = b.expect === 'complete' ? ' — тест должен пройти до конца, найденные дефекты считаются его результатом' : ''
    r = logged({ ...r, criteria }, `Критерий ${c.id}: проверка — блок «${b.block}»${what}`, 'info', now)
  }
  return r
}
function onReport(run: HarnessRun, rep: HarnessReport, now: number): HarnessMove {
  const i = rep.step !== undefined && rep.step <= run.steps.length ? rep.step - 1 : currentStep(run)
  const r: HarnessRun = { ...bound(run, rep.checks ?? [], now), lastNote: rep.note || run.lastNote, turnErrors: 0, silent: 0, fix: undefined, ...(rep.recheck ? { recheck: rep.recheck } : {}) }
  // (the journal keeps the words whole — the panel wraps them)
  const said = rep.note ? `: ${rep.note.slice(0, 2000)}` : ''
  switch (rep.state) {
    case 'continue':
      return work(logged({ ...r, steps: withStep(r.steps, i, { state: 'doing', note: rep.note || undefined }) }, `Шаг ${i + 1}${said}`, 'info', now), now)
    case 'check':
      return check(logged({ ...r, checking: i, steps: withStep(r.steps, i, { state: 'doing', note: rep.note || undefined }) }, `Шаг ${i + 1} — проверка${said}`, 'info', now), now)
    case 'done':
      return check(logged({ ...r, finishing: true, checking: undefined }, `ИИ: готово${said}`, 'info', now), now)
    case 'help':
      return ended({ ...r, question: rep.question || rep.note }, 'help', now, (rep.question || rep.note).slice(0, 2000))
  }
}
/** A turn with no report: reminded once or twice, then stopped. */
function onSilent(run: HarnessRun, now: number): HarnessMove {
  const silent = run.silent + 1
  if (silent >= run.limits.silentTurns) return ended({ ...run, silent }, 'silent', now)
  const fix = run.phase === 'plan' ? 'Ты не дал план: вызови harness_plan (шаги и критерии приёмки).' : 'Ты не сообщил, как идёт работа: в конце хода обязательно вызови harness_report.'
  const r = logged({ ...run, silent, fix }, 'ИИ не отчитался — напоминание', 'fail', now)
  return run.phase === 'plan' ? { run: r, next: { kind: 'turn', mode: 'plan' } } : run.phase === 'review' ? { run: r, next: { kind: 'turn', mode: 'review' } } : work(r, now)
}

/**
 * The final check's verdict — on the plan's criteria only, as every harness takes it (the criteria agreed are what is
 * judged; anything else is advice). Accepted, or nothing named — done (its remarks kept as advice). Criteria named
 * unmet — the work back once, to mend them; only values doubted (`recheck`) — those run anew, the rest of the checks
 * as remembered, then the review again. Turned back again — the person decides (a reviewer and a worker never argue
 * in a circle: there is always more to measure).
 */
function onReview(run: HarnessRun, rep: HarnessReport | undefined, now: number): HarnessMove {
  if (!rep) return onSilent(run, now)
  const unmet = (rep.unmet ?? []).filter((id) => run.criteria.some((c) => c.id === id))
  const recheck = rep.recheck ?? []
  if (rep.state === 'done' || (!unmet.length && !recheck.length)) {
    const advice = rep.state !== 'done' && rep.note ? logged(run, `Финальная проверка: рекомендации (работу не задерживают): ${rep.note.slice(0, 2000)}`, 'info', now) : run
    return ended({ ...advice, steps: advice.steps.map((s) => ({ ...s, state: 'done' })), finishing: false }, 'done', now)
  }
  const which = unmet.map((id) => `${id}. ${run.criteria.find((c) => c.id === id)!.text}`).join('\n')
  const doubted = recheck.length ? `Перепроверить значения: ${recheck.join(', ')}` : ''
  const why = [unmet.length ? `Не выполнены критерии:\n${which}` : '', doubted, rep.note].filter(Boolean).join('\n').trim()
  if ((run.returned ?? 0) >= REVIEW_RETURNS)
    return ended({ ...run, finishing: false, question: `Финальная проверка снова не принимает работу. ${why}\nРешите: принять как есть (закройте панель) или ответьте, что доделать.` }, 'help', now, why)
  const returned = { ...run, returned: (run.returned ?? 0) + 1, ...(recheck.length ? { recheck } : {}) }
  if (!unmet.length) return check(logged({ ...returned, finishing: true }, `Финальная проверка: ${why.slice(0, 2000)}`, 'info', now), now)
  return work(logged({ ...returned, finishing: false, fix: `Финальная проверка не принята:\n${why}` }, `Проверка не принята: ${why.slice(0, 2000)}`, 'fail', now), now)
}
/** The final check may turn the work back this many times; then the person decides. */
const REVIEW_RETURNS = 1

function onTurn(run: HarnessRun, ev: Extract<HarnessEvent, { kind: 'turn' }>, now: number): HarnessMove {
  const heard = { ...run, hints: run.hints.slice(ev.heard ?? 0) }
  if (ev.stopped) return ended(heard, 'stopped', now)
  if (ev.error) {
    const turnErrors = run.turnErrors + 1
    if (turnErrors >= run.limits.turnErrors) return ended({ ...heard, turnErrors }, 'errors', now, ev.error.slice(0, 1000))
    const r = logged({ ...heard, turnErrors }, `Ошибка хода: ${ev.error.slice(0, 1000)} — повтор`, 'fail', now)
    return { run: r, next: { kind: 'turn', mode: run.phase === 'plan' ? 'plan' : run.phase === 'review' ? 'review' : r.fix ? 'fix' : 'work' } }
  }
  switch (run.phase) {
    case 'plan':
      return ev.harness?.plan ? onPlan(heard, ev.harness.plan, now) : onSilent(heard, now)
    case 'work': {
      const r = { ...heard, iteration: run.iteration + 1 }
      return ev.harness?.report ? onReport(r, ev.harness.report, now) : onSilent(r, now)
    }
    case 'review':
      return onReview(heard, ev.harness?.report, now)
    default:
      // (a turn of a run stopped meanwhile: nothing follows)
      return { run: heard, next: { kind: 'none' } }
  }
}

function onChecked(run: HarnessRun, ev: Extract<HarnessEvent, { kind: 'checked' }>, now: number): HarnessMove {
  const baseline = run.phase === 'baseline'
  if (!baseline && run.phase !== 'check') return { run, next: { kind: 'none' } }
  // (the checks the person took as changed: guarded as they are now)
  const retake = !!run.bent
  const criteria = run.criteria.map((c) => {
    const result = ev.results.get(c.id)
    if (!result) return c
    const body = ev.bodies.get(c.id)
    const guard = baseline ? body : retake && c.guard !== undefined && body !== undefined ? body : c.guard
    return { ...c, result, ranOn: body, guard, ...(baseline ? { baseline: result } : {}) }
  })
  // (the values doubted — run anew by these checks)
  const r = { ...run, criteria, bent: undefined, recheck: undefined }
  // a check given (there before the work) changed by the agent: never bent to pass — the person decides
  const bent = retake ? [] : run.criteria.filter((c) => c.guard !== undefined && ev.bodies.has(c.id) && ev.bodies.get(c.id) !== c.guard)
  if (bent.length) return ended({ ...r, bent: true, question: `Изменены проверки: ${bent.map((c) => c.check!.block).join(', ')}. «Продолжить» — принять изменения.` }, 'help', now, `ИИ изменил проверку ${bent.map((c) => `«${c.check!.block}»`).join(', ')}`)
  if (baseline) {
    const failed = failedCriteria(criteria)
    const absent = failed.filter((c) => c.result?.missing).length
    const red = failed.length - absent
    const said = [red ? `не проходит проверок: ${red}` : '', absent ? `блоков проверок ещё нет: ${absent} (появятся в работе)` : ''].filter(Boolean).join('; ')
    return work(logged(r, said ? `До начала работы ${said}` : 'До начала работы все проверки проходят', 'info', now), now)
  }
  // (the ones checked now: a criterion not due yet may be red still — not this step's failure)
  const failed = failedCriteria(criteria.filter((c) => ev.results.has(c.id)))
  if (!failed.length) return passed(logged(r, 'Проверки пройдены', 'ok', now), now)
  const sig = failureSignature(failed)
  const count = run.failure?.sig === sig ? run.failure.count + 1 : 1
  const step = run.checking ?? currentStep(run)
  const f = logged({ ...r, failure: { sig, count }, fix: failureText(failed), checking: undefined, finishing: false, steps: withStep(r.steps, step, { state: 'failed' }) }, `Не прошло проверок: ${failed.length}`, 'fail', now)
  if (count >= run.limits.sameFailure) return ended(f, 'stuck', now)
  return work(f, now)
}

/** The person's corrections as the next plan is told of them: what they changed (to keep), their remarks. */
function replanWords(run: HarnessRun, ev: Extract<HarnessEvent, { kind: 'replan' }>): string {
  return [ev.draft ? draftWords(run, ev.draft) : '', ev.remarks.trim() ? `Замечания человека к плану: ${ev.remarks.trim()}` : ''].filter(Boolean).join('\n')
}

export function advance(run: HarnessRun, ev: HarnessEvent, now: number): HarnessMove {
  switch (ev.kind) {
    case 'turn':
      return onTurn(run, ev, now)
    case 'checked':
      return onChecked(run, ev, now)
    case 'confirm': {
      if (run.phase !== 'confirm') return { run, next: { kind: 'none' } }
      // (edited by the person: their plan is the plan)
      const r = ev.draft ? logged({ ...run, ...appliedDraft(run, ev.draft) }, 'План поправлен человеком', 'info', now) : run
      return start(logged(r, 'План принят', 'ok', now), now)
    }
    case 'replan': {
      if (run.phase !== 'confirm') return { run, next: { kind: 'none' } }
      const words = replanWords(run, ev)
      // (what they took out — kept out of the plan made anew, whatever the agent gives)
      // (and the plan the agent sees is the one the person edited)
      if (ev.draft) run = { ...run, dropped: droppedBy(run, ev.draft), ...appliedDraft(run, ev.draft) }
      const r = logged(
        { ...run, hints: words ? [...run.hints, words] : run.hints, ...(ev.guides ? { guides: ev.guides, pinned: true } : {}), ...(ev.go ? { go: true } : {}) },
        ev.go ? 'Начать — ИИ учтёт инструкции и замечания человека, потом работа' : 'План — заново, с правками человека',
        'info',
        now,
      )
      return { run: { ...r, phase: 'plan' }, next: { kind: 'turn', mode: 'plan' } }
    }
    case 'settings': {
      const s = ev.settings
      const r = logged({ ...run, reviewer: s.reviewer, limits: s.limits, confirmPlan: s.confirmPlan }, `Настройки работы: финальная проверка — ${s.reviewer === REVIEWER_OFF ? 'нет' : 'да'}, итераций ${s.limits.iterations}, минут ${s.limits.minutes}`, 'info', now)
      return { run: r, next: { kind: 'none' } }
    }
    case 'hint': {
      const r = logged({ ...run, hints: [...run.hints, ev.text] }, `Человек: ${ev.text.slice(0, 2000)}`, 'info', now)
      // a remark on the plan — planned anew; an answer to the agent's question — work goes on
      if (run.phase === 'confirm') return { run: { ...r, phase: 'plan' }, next: { kind: 'turn', mode: 'plan' } }
      if (run.phase === 'help') return advance({ ...r, question: undefined }, { kind: 'resume' }, now)
      return { run: r, next: { kind: 'none' } }
    }
    case 'stop':
      return HARNESS_ENDED.includes(run.phase) ? { run, next: { kind: 'none' } } : ended(run, 'stopped', now)
    case 'interrupted':
      return HARNESS_ENDED.includes(run.phase) ? { run, next: { kind: 'none' } } : ended(run, 'interrupted', now)
    case 'resume': {
      if (run.phase === 'done' || !HARNESS_ENDED.includes(run.phase)) return { run, next: { kind: 'none' } }
      // (`bent` stays: the checks the agent changed are taken by the person — the next checks guard them as they are)
      const r = logged({ ...run, stop: undefined, question: undefined, iterBase: run.iteration, startedAt: now, turnErrors: 0, silent: 0, failure: undefined, returned: undefined }, 'Продолжение', 'info', now)
      if (!r.steps.length) return { run: { ...r, phase: 'plan' }, next: { kind: 'turn', mode: 'plan' } }
      return work(r, now)
    }
  }
}
