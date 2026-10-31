import { computed, ref, shallowRef } from 'vue'
import { DEFAULT_HARNESS, HARNESS_ENDED, REVIEWER_SELF, type HarnessSettings } from '@shared/agent/harness/constants'
import { advance, type HarnessEvent } from '@shared/agent/harness/machine'
import { milestoneOf } from '@shared/agent/harness/milestones'
import { newRun, type CheckResult, type HarnessNext, type HarnessRun, type TurnMode } from '@shared/agent/harness/model'
import { HARNESS_ASK, harnessSystem } from '@shared/agent/harness/prompt'
import type { HarnessGuide, PlanGuides } from '@shared/agent/harness/guides'
import type { PlanDraft } from '@shared/agent/harness/planDraft'
import { mentionable, mentionsIn, type ChatMessage, type ChatRoom } from '@shared/transport/chat'
import { agentIdOfProfile, agentProfiles, loadAgents, profileOfAgentId } from '../agents'
import { noteOfRoom } from '../agentContext'
import { harnessTurn, routeToHarness, stopAgentIn } from '../agentTurns'
import { chatMe, postMessage, roomOf, sendMessage } from '../chat'
import { noteTextOf } from '../noteRunAccess'
import { runHarnessChecks, stopHarnessChecks } from './harnessChecks'
import { docRulesOf } from './harnessRules'

/**
 * The harness in the window: each room's run led here — its turns asked of the agent (in line with its other turns),
 * its checks run here, the person's words taken in; every move kept on the disk, the plan and the end told in the chat.
 */
const runs = shallowRef(new Map<string, HarnessRun>())
export const harnessSettings = ref<HarnessSettings>(DEFAULT_HARNESS)
export const harnessRunOf = (room: string): HarnessRun | undefined => runs.value.get(room)
/** Every room's run (the app's signals read them). */
export const harnessRuns = computed(() => [...runs.value.values()])
export const isRunning = (run: HarnessRun | undefined): boolean => !!run && !HARNESS_ENDED.includes(run.phase) && run.phase !== 'confirm'
/** The rooms whose turn or checks are going on now. */
const busy = shallowRef(new Set<string>())
export const isBusy = (room: string) => busy.value.has(room)

function keep(run: HarnessRun): void {
  runs.value = new Map(runs.value).set(run.room, run)
  void window.qa.harnessSaveRun(JSON.parse(JSON.stringify(run)) as HarnessRun).catch(() => undefined)
}
/** Something happened to a room's run: it moves on, the chat is told what it deserves, what comes next is started. */
function apply(room: string, ev: HarnessEvent): void {
  const before = runs.value.get(room)
  if (!before) return
  const { run, next } = advance(before, ev, Date.now())
  keep(run)
  const say = ev.kind === 'interrupted' ? undefined : milestoneOf(before, run, (id) => harnessGuides.value.find((g) => g.id === id)?.title ?? id)
  if (say) void postMessage(room, { text: say, agent: { id: run.agent, name: run.agentName } }).catch(() => undefined)
  act(room, next)
}
function act(room: string, next: HarnessNext | { kind: 'none' }): void {
  if ((next.kind !== 'turn' && next.kind !== 'checks') || busy.value.has(room)) return
  busy.value = new Set(busy.value).add(room)
  const job: Promise<HarnessEvent> = next.kind === 'turn' ? turn(room, next.mode) : checks(room, next)
  void job.then((ev) => {
    const b = new Set(busy.value)
    b.delete(room)
    busy.value = b
    apply(room, ev)
  })
}

/** A turn of the run's agent (the review — of the reviewer, reading only): what it gave the harness. */
async function turn(roomId: string, mode: TurnMode): Promise<HarnessEvent> {
  try {
    const run = runs.value.get(roomId)!
    const room = roomOf(roomId)
    if (!room) return { kind: 'turn', error: 'Чата больше нет' }
    await loadAgents()
    const reviewer = mode === 'review' && run.reviewer !== REVIEWER_SELF ? agentProfiles.value.find((p) => p.id === run.reviewer) : undefined
    const agent = reviewer ? agentIdOfProfile(reviewer) : run.agent
    const path = await noteOfRoom(room)
    // (the note the work is in: the app's signals open it)
    if (path && run.doc !== path) keep({ ...runs.value.get(roomId)!, doc: path })
    const docText = path ? await noteTextOf(path).catch(() => undefined) : undefined
    // (the instructions as they are now: the person may have changed them since the plan)
    const guides = await loadGuides()
    const system = harnessSystem({ run, mode, now: Date.now(), guides, docRules: docRulesOf(docText) })
    const heard = run.hints.length
    const message: ChatMessage = { room: roomId, seq: room.lastSeq + 0.5, id: `harness:${crypto.randomUUID()}`, author: { id: chatMe.value, name: 'Harness' }, text: HARNESS_ASK[mode], at: Date.now() }
    // (the criteria's check blocks: the harness runs them, not the agent mid-turn — the review may, to look)
    const checks = mode === 'review' ? [] : run.criteria.flatMap((c) => (c.check ? [c.check] : []))
    const a = await harnessTurn(agent, room, message, mode === 'review' ? 'other' : 'owner', system, checks)
    return { kind: 'turn', heard, ...(a.harness ? { harness: a.harness } : {}), ...(a.stopped ? { stopped: true } : a.error ? { error: a.error } : {}) }
  } catch (e) {
    return { kind: 'turn', error: e instanceof Error ? e.message : String(e) }
  }
}
/** The run's criteria asked checked (anything failing on the way — every one of them failed with it). */
async function checks(roomId: string, ask: Extract<HarnessNext, { kind: 'checks' }>): Promise<HarnessEvent> {
  const run = runs.value.get(roomId)!
  try {
    return { kind: 'checked', ...(await runHarnessChecks(roomId, run.criteria, ask)) }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const results = new Map<number, CheckResult>(run.criteria.filter((c) => c.check && ask.ids.includes(c.id)).map((c) => [c.id, { ok: false, at: Date.now(), error }]))
    return { kind: 'checked', results, bodies: new Map() }
  }
}

/**
 * A run started in a room by the person's message (its goal): the agent — the one it mentions, else one's only agent
 * there. The goal goes into the chat as the person's message. Can't — why (in words).
 */
export function startHarness(roomId: string, text: string): string | undefined {
  const room = roomOf(roomId)
  if (!room) return 'Чата нет'
  const goal = text.trim()
  if (!goal) return 'Напишите цель работы'
  const mine = (room.agents ?? []).filter((a) => a.owner === chatMe.value)
  if (!mine.length) return 'Добавьте в чат своего ИИ — harness работает через него'
  const named = mine.filter((a) => mentionsIn(goal, mentionable(room)).includes(a.id))
  const agent = named.length === 1 ? named[0] : mine.length === 1 && !named.length ? mine[0] : undefined
  if (!agent) return 'Укажите, какой ИИ ведёт работу: @Имя'
  const profile = profileOfAgentId(agent.id)
  if (!profile) return `Профиля «${agent.name}» нет в настройках`
  if (isRunning(harnessRunOf(roomId)) || harnessRunOf(roomId)?.phase === 'confirm') return 'Harness уже работает в этом чате — остановите его или напишите подсказку'
  // (the chat's own settings, when set in it: two chats of one note may do different work)
  const s = roomSettings.value[roomId] ?? harnessSettings.value
  keep(newRun({ id: crypto.randomUUID(), room: roomId, agent: agent.id, agentName: agent.name, profile: profile.id, reviewer: s.reviewer, goal, limits: s.limits, confirmPlan: s.confirmPlan }, Date.now()))
  // (the goal said in the chat: the run takes it — the agent is not called by it as by a message)
  sendMessage(roomId, goal)
  act(roomId, { kind: 'turn', mode: 'plan' })
  return undefined
}
/** The plan taken (as the person edited it). */
export const confirmHarness = (room: string, draft?: PlanDraft) => apply(room, { kind: 'confirm', ...(draft ? { draft } : {}) })
/** The plan taken with what the agent is to take in first (the instructions chosen, the remarks; the edits kept). */
export const replanHarness = (room: string, edits: { guides?: PlanGuides; draft?: PlanDraft; remarks: string; go?: boolean }) => apply(room, { kind: 'replan', ...edits })

// ---------- the instructions (their catalog: the plan's window shows it, a turn is told it) ----------
export const harnessGuides = shallowRef<HarnessGuide[]>([])
export async function loadGuides(): Promise<HarnessGuide[]> {
  harnessGuides.value = await window.qa.harnessGuides()
  return harnessGuides.value
}
export async function saveGuide(g: HarnessGuide): Promise<void> {
  harnessGuides.value = await window.qa.harnessGuideSave(JSON.parse(JSON.stringify(g)) as HarnessGuide)
}
export async function removeGuide(id: string): Promise<void> {
  harnessGuides.value = await window.qa.harnessGuideRemove(id)
}
export async function resetGuide(id: string): Promise<void> {
  harnessGuides.value = await window.qa.harnessGuideReset(id)
}
export const resumeHarness = (room: string) => apply(room, { kind: 'resume' })
export function stopHarness(room: string): void {
  apply(room, { kind: 'stop' })
  stopHarnessChecks(room)
  if (busy.value.has(room)) stopAgentIn(room)
}
/** A finished run taken off the chat. */
export function closeHarness(room: string): void {
  const r = new Map(runs.value)
  r.delete(room)
  runs.value = r
  void window.qa.harnessDropRun(room).catch(() => undefined)
}
export async function saveHarnessSettings(s: HarnessSettings): Promise<void> {
  harnessSettings.value = await window.qa.harnessSaveSettings(JSON.parse(JSON.stringify(s)) as HarnessSettings)
}
/** Each room's own settings (set in its chat): its next runs take them; none — the settings screen's. */
const roomSettings = shallowRef<Record<string, HarnessSettings>>({})
/** A room's settings: its run's (they may have been set during it), else its own, else the settings screen's. */
export function harnessSettingsOf(room: string): HarnessSettings {
  const run = runs.value.get(room)
  return run ? { reviewer: run.reviewer, limits: run.limits, confirmPlan: run.confirmPlan } : (roomSettings.value[room] ?? harnessSettings.value)
}
/** A room's settings set in its chat: kept for its next runs, and its run (if any) holds to them from now on. */
export async function saveRoomHarnessSettings(room: string, s: HarnessSettings): Promise<void> {
  const saved = await window.qa.harnessSaveRoomSettings(room, JSON.parse(JSON.stringify(s)) as HarnessSettings)
  roomSettings.value = { ...roomSettings.value, [room]: saved }
  if (runs.value.has(room)) apply(room, { kind: 'settings', settings: saved })
}

/**
 * The person's message in a room with a run going: its goal said (taken as it is), else a hint, a remark on the plan,
 * an answer to the agent's question — the run's agent is not called by it besides.
 */
function takes(m: ChatMessage, room: ChatRoom): string | undefined {
  const run = runs.value.get(room.id)
  if (!run || m.agent || m.author.id !== chatMe.value || run.phase === 'done' || run.phase === 'stopped') return undefined
  const goalSaid = run.phase === 'plan' && !run.steps.length && run.iteration === 0 && m.text.trim() === run.goal
  if (!goalSaid) apply(room.id, { kind: 'hint', text: m.text.trim() })
  return run.agent
}

let started = false
/** The harness's settings and runs read (a run going when the app closed — stopped, «Продолжить» goes on). */
export function startHarnessDriver(): void {
  if (started) return
  started = true
  routeToHarness(takes)
  void window.qa.harnessState().then((st) => {
    harnessSettings.value = st.settings
    roomSettings.value = st.rooms ?? {}
    runs.value = new Map(st.runs.map((r) => [r.room, r]))
    for (const r of st.runs) if (isRunning(r)) apply(r.room, { kind: 'interrupted' })
  })
  void loadGuides().catch(() => undefined)
}
