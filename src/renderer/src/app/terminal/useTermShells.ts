import { computed, onMounted, watch } from 'vue'
import type TermPane from '../../components/TermPane.vue'
import { addTab, syncLayout, termLayout, termsLoaded, useTermSessions } from '../../lib/terminal'

/** The shells and the panes showing them: making, showing, closing; the split into two panes. */
export function useTermShells() {
  const sessions = useTermSessions()
  const byId = (id?: string) => sessions.value.find((s) => s.id === id)
  /** A shell being made: its tab is placed by hand (the list's update must not adopt it elsewhere). */
  let making = 0
  watch([sessions, termsLoaded], ([list, ok]) => ok && !making && syncLayout(list), { immediate: true })
  /** The panes of the shells (to type into them). */
  const paneRefs = new Map<string, InstanceType<typeof TermPane>>()
  /** The shell in front: the active tab of the current pane. */
  const curId = computed(() => termLayout.panes[termLayout.cur]?.active)

  /** A new shell in the folder of the one in front, its tab in a pane. */
  async function newShell(pi = termLayout.cur): Promise<string | undefined> {
    const cwd = byId(curId.value)?.info.cwd
    making++
    try {
      const s = await window.qa.termCreate(cwd)
      // the list may have come first: the tab goes only here
      for (const p of termLayout.panes) p.tabs = p.tabs.filter((t) => t !== s.id)
      addTab(Math.min(pi, termLayout.panes.length - 1), s.id)
      return s.id
    } finally {
      making--
    }
  }
  onMounted(async () => {
    // the first visit: a shell to start with
    const list = await window.qa.termList()
    if (!list.length) await newShell(0)
  })
  /** Two panes: a new shell on the right; one: the right pane's tabs join the left. */
  async function toggleSplit(): Promise<void> {
    if (termLayout.panes.length > 1) {
      const [a, b] = termLayout.panes
      for (const t of b.tabs) if (!a.tabs.includes(t)) a.tabs.push(t)
      termLayout.panes.splice(1, 1)
      termLayout.cur = 0
      return
    }
    termLayout.panes.push({ id: `p${Date.now()}`, tabs: [] })
    making++
    try {
      await newShell(1)
    } finally {
      making--
    }
    if (!termLayout.panes[1]?.tabs.length) termLayout.panes.splice(1, 1)
  }
  /** A shell's tab shown in its pane, the pane made current. */
  function show(pi: number, id: string): void {
    termLayout.panes[pi].active = id
    termLayout.cur = pi
  }
  /** To a shell's tab wherever it is (a notice clicked). */
  function reveal(sid: string): void {
    const pi = termLayout.panes.findIndex((p) => p.tabs.includes(sid))
    if (pi >= 0) show(pi, sid)
  }
  /** A shell ended (asked first when a command still runs in it). */
  async function closeShell(id: string): Promise<void> {
    const s = byId(id)
    if (s?.busy && !confirm(`В «${s.title}» ещё идёт команда. Закрыть оболочку?`)) return
    await window.qa.termKill(id)
  }
  return { sessions, byId, curId, paneRefs, newShell, toggleSplit, show, reveal, closeShell }
}
export type TermShells = ReturnType<typeof useTermShells>
