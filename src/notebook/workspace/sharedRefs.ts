import { watch } from 'vue'
import { parseNoteLink } from '@shared/noteEvents'
import { eventBody, jiraBody, refChanges, refUrlsIn, type RefBody, type RefCard } from '@shared/transport/refCards'
import type { SharedText } from '@shared/transport/sharedText'
import { attrChips } from '@shared/tracker/attributes'
import type { Entry } from '@shared/types'
import { eventOf, eventsNow, eventsTick, issueOf, jiraSite, kindOf } from '@renderer/lib/noteEvents'
import { attrDefs } from '@renderer/lib/attributes'
import { serverNow, useTransport } from '@renderer/lib/transport'
import { editableTexts, heldTexts, sharedTextOf, sharedTick, spaceOfPath } from './sharedDocs'

/**
 * The snapshots of the tasks and events a shared note links to (refCards): this person's app puts in what it knows
 * (its Jira, its timeline) for every shared note it may change; the chips of everyone read them when the thing is not
 * their own. Written a moment after the notes or the known tasks and events change.
 */

const PUBLISH_MS = 1500
let timer: ReturnType<typeof setTimeout> | undefined
/** The events' full records (their descriptions), read for the events list as it is now. */
let entries: { tick: number; days: Set<string>; byKey: Map<string, Entry> } = { tick: -1, days: new Set(), byKey: new Map() }

async function entriesOf(days: Set<string>): Promise<Map<string, Entry>> {
  if (entries.tick !== eventsTick.value) entries = { tick: eventsTick.value, days: new Set(), byKey: new Map() }
  const e = entries
  for (const day of days) {
    if (e.days.has(day)) continue
    const d = await window.qa.getDay(day).catch(() => undefined)
    if (!d) continue
    e.days.add(day)
    for (const x of d.entries) e.byKey.set(`${day}/${x.id}`, x)
  }
  return e.byKey
}

/** What this person knows of a link now (nothing — none: the snapshot someone else wrote stays). */
function freshBody(url: string, byKey: Map<string, Entry>): RefBody | undefined {
  const link = parseNoteLink(url)
  if (!link) return undefined
  switch (link.kind) {
    case 'jira': {
      const issue = issueOf(link.key)
      return issue && jiraBody(issue, jiraSite.value)
    }
    case 'event': {
      const e = eventOf(link.day, link.id)
      if (!e) return undefined
      const k = kindOf(e.kind)
      const full = byKey.get(`${link.day}/${link.id}`)
      const attrs = attrChips(attrDefs.value, e.attrs)
      return eventBody({
        day: e.day,
        label: e.label,
        start: e.start,
        end: e.end,
        kind: { label: k?.label ?? e.kind, color: k?.color ?? '', icon: k?.icon ?? 'tag' },
        outlook: e.outlook,
        ...(full?.description ? { description: full.description } : {}),
        ...(full?.task ? { task: full.task } : {}),
        ...(attrs.length ? { attrs } : {}),
      })
    }
  }
}

async function publish(): Promise<void> {
  const texts = editableTexts().map((st) => ({ st, urls: refUrlsIn(st.value) }))
  const links = texts.flatMap((t) => t.urls.map(parseNoteLink))
  const days = new Set<string>()
  if (links.some((l) => l?.kind === 'event')) {
    await eventsNow()
    for (const l of links) if (l?.kind === 'event' && eventOf(l.day, l.id)) days.add(l.day)
  }
  const byKey = await entriesOf(days)
  const by = useTransport().value.deviceId
  if (!by) return
  const at = serverNow()
  for (const { st, urls } of texts) {
    const { put, drop } = refChanges(urls, st.refsNow(), (u) => freshBody(u, byKey))
    st.putRefs(
      put.map(([u, b]) => [u, { ...b, by, at } as RefCard]),
      drop,
    )
  }
}
const schedule = () => {
  clearTimeout(timer)
  timer = setTimeout(() => void publish().catch(() => undefined), PUBLISH_MS)
}

/** The notes whose snapshots the chips follow (someone else's change of them — the chips redraw). */
const followed = new WeakSet<SharedText>()
function follow(): void {
  for (const st of heldTexts()) {
    if (followed.has(st)) continue
    followed.add(st)
    st.onRefs(() => eventsTick.value++)
  }
}
watch(
  () => [sharedTick.n, eventsTick.value],
  () => {
    follow()
    schedule()
  },
  { immediate: true },
)

/** A link's snapshot in a shared note (not a shared note, none written yet — none). */
export const refCardOf = (path: string, url: string): RefCard | undefined => sharedTextOf(path)?.refsNow().get(url)
/** Who wrote a snapshot, by name (a member of the note's space; not known — none). */
export const refWriter = (path: string, card: RefCard): string | undefined => spaceOfPath(path)?.members.find((m) => m.id === card.by)?.name
