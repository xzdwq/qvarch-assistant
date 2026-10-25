import { ref } from 'vue'
import { EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { durText, noteLinkUrl, periodText, statusOf, statusText, type NoteLink } from '@shared/noteEvents'
import type { RefCard } from '@shared/transport/refCards'
import { eventOf, events, eventsTick, issueOf, jiraSite, kindOf } from '@renderer/lib/noteEvents'
import { openUrl } from '@renderer/lib/links'
import type { JiraStatusCategory } from '@shared/jira'
import { iconSvg } from '@renderer/components/Icon.vue'
import { refCardOf } from '@nb/workspace/sharedRefs'
import { sharedTextOf } from '@nb/workspace/sharedDocs'
import { editorHost, refreshDecorations } from './editorHost'
import { attrChips } from '@shared/tracker/attributes'
import { attrDefs } from '@renderer/lib/attributes'

/**
 * An event of the timeline or a Jira task mentioned in a note: a live chip (its status, its period) instead of the
 * link's text. The chips follow the clock (every 30 s) and the events' list.
 */

/** The clock the chips (and the «@» menu's events) go by. */
export const chipClock = ref(Date.now())
/** What the chips show changed: the events' list reloaded, or half a minute passed. */
export const chipStamp = () => `${eventsTick.value}:${Math.floor(chipClock.value / 30000)}`
/** A chip asks for the card of a task / of someone else's event (the note, the link, where to show it). */
export interface RefCardAsk {
  path: string
  url: string
  x: number
  y: number
  /** The chip clicked (clicked again — the card closes). */
  from?: HTMLElement
}
/** An own event's chip clicked: its card. */
export interface EventCardAsk {
  day: string
  id: string
  x: number
  y: number
  from?: HTMLElement
}
/** A date in a few letters: «12 окт». */
export const shortDate = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\.$/, '')

export class EventChip extends WidgetType {
  constructor(
    readonly link: NoteLink,
    /** The link's own text (shown when the event is not known). */
    readonly text: string,
    /** Changes when what the chip shows may have (the list reloaded, a minute passed). */
    readonly stamp: string,
  ) {
    super()
  }
  eq(o: EventChip): boolean {
    return o.stamp === this.stamp && o.text === this.text && JSON.stringify(o.link) === JSON.stringify(this.link)
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-ev'
    const now = Date.now()
    const part = (cls: string, text: string, title?: string) => {
      const e = document.createElement('span')
      e.className = cls
      e.textContent = text
      if (title) e.title = title
      return e
    }
    const ic = document.createElement('span')
    ic.className = 'cm-ev-ic'
    box.append(ic)
    const l = this.link
    const path = view.state.facet(editorHost).notePath()
    const url = noteLinkUrl(l)
    const card = path ? refCardOf(path, url) : undefined
    // a click on a snapshot's chip: its card (read only)
    const openCard = () => {
      const r = box.getBoundingClientRect()
      window.dispatchEvent(new CustomEvent<RefCardAsk>('qa:ref-card', { detail: { path, url, x: r.left, y: r.bottom, from: box } }))
    }
    switch (l.kind) {
      case 'event':
        this.drawEvent(box, ic, l, now, part, card?.kind === 'event' ? card : undefined, !!(path && sharedTextOf(path)), openCard)
        break
      case 'jira':
        this.drawIssue(box, ic, l.key, part, card?.kind === 'jira' ? card : undefined, openCard)
        break
    }
    box.onmousedown = (ev) => ev.preventDefault()
    return box
  }
  /** An event of the timeline: its kind, label, period, status — a click opens its card. Not on this timeline — its snapshot. */
  private drawEvent(box: HTMLElement, ic: HTMLElement, l: Extract<NoteLink, { kind: 'event' }>, now: number, part: (cls: string, text: string, title?: string) => HTMLElement, card: Extract<RefCard, { kind: 'event' }> | undefined, shared: boolean, openCard: () => void): void {
    const e = eventOf(l.day, l.id)
    if (!e && card) {
      const c = card.event
      ic.innerHTML = iconSvg(c.kind.icon, 13)
      if (c.kind.color) box.style.setProperty('--ev', c.kind.color)
      box.append(part('cm-ev-t', c.label || this.text), part('cm-ev-p', `${periodText(c, now)} · ${durText(c.end - c.start)}`), part(`cm-ev-st ${statusOf(c, now)}`, statusText(c, now)))
      box.title = `${c.kind.label} — событие другого участника; клик: подробнее`
      box.onclick = openCard
      return
    }
    if (!e) {
      // someone else's event in a shared note, its snapshot not come yet: not «deleted» — just not known here
      const gone = events.value.length > 0 && !shared
      ic.innerHTML = iconSvg('calendar', 13)
      box.classList.add(gone ? 'gone' : 'wait')
      box.append(part('cm-ev-t', this.text))
      if (gone) box.append(part('cm-ev-st gone', 'событие удалено'))
      else if (shared && events.value.length) box.append(part('cm-ev-st', 'нет данных'))
      box.title = gone ? 'Этого события больше нет на таймлайне' : shared ? 'Событие другого участника — его данные появятся, когда он откроет заметку' : ''
      return
    }
    const k = kindOf(e.kind)
    ic.innerHTML = iconSvg(k?.icon ?? 'tag', 13)
    if (k?.color) box.style.setProperty('--ev', k.color)
    const st = statusOf(e, now)
    box.append(part('cm-ev-t', e.label || this.text), part('cm-ev-p', `${periodText(e, now)} · ${durText(e.end - e.start)}`), part(`cm-ev-st ${st}`, statusText(e, now)))
    if (e.created) box.append(part('cm-ev-c', `созд. ${shortDate(e.created)}`, `Создано ${new Date(e.created).toLocaleString('ru-RU')}`))
    // its attributes: each value's letters in its attribute's colour
    for (const c of attrChips(attrDefs.value, e.attrs)) {
      const a = part('cm-ev-a', c.short, `${c.name}: ${c.value}`)
      a.style.setProperty('--attr', c.color)
      box.append(a)
    }
    box.title = `${k?.label ?? e.kind}${e.outlook ? ' · встреча Outlook' : ''}${e.task ? ` · ${e.task}` : ''} — клик: карточка события (прочитать, изменить, открыть в Моей работе)`
    box.onclick = () => {
      const r = box.getBoundingClientRect()
      window.dispatchEvent(new CustomEvent<EventCardAsk>('qa:event-card', { detail: { day: e.day, id: e.id, x: r.left, y: r.bottom, from: box } }))
    }
  }
  /** A Jira task: its key, summary, status (this person's Jira, else the note's snapshot) — a click opens its card. */
  private drawIssue(box: HTMLElement, ic: HTMLElement, key: string, part: (cls: string, text: string) => HTMLElement, card: Extract<RefCard, { kind: 'jira' }> | undefined, openCard: () => void): void {
    const is = issueOf(key) ?? card?.issue
    ic.innerHTML = iconSvg('jira', 13)
    box.style.setProperty('--ev', 'var(--editor-jira-chip)')
    box.append(part('cm-ev-t', is ? `${is.key} ${is.summary}` : this.text))
    if (is) box.append(part(`cm-ev-st ${issueStatusClass(is.category)}`, is.status))
    box.title = is ? 'Задача Jira — клик: описание' : 'Задача Jira — клик: открыть в браузере'
    box.dataset.link = ''
    box.onclick = () => (is ? openCard() : jiraSite.value && openUrl(`${jiraSite.value.replace(/\/$/, '')}/browse/${key}`))
  }
  ignoreEvent(): boolean {
    return true
  }
}
/** A Jira status category as a chip's colour class: done / now / ahead. */
const STATUS_CATEGORY_CLASS: Record<JiraStatusCategory, 'done' | 'now' | 'ahead'> = { new: 'ahead', indeterminate: 'now', done: 'done' }
export const issueStatusClass = (category: JiraStatusCategory) => STATUS_CATEGORY_CLASS[category]

/** The chips' clock: every 30 s the time moves on, a note with chips redraws them. */
export const eventChipsClock = ViewPlugin.fromClass(
  class {
    readonly timer: ReturnType<typeof setInterval>
    constructor(view: EditorView) {
      this.timer = setInterval(() => {
        chipClock.value = Date.now()
        if (view.state.doc.toString().includes('qvarch://')) view.dispatch({ effects: refreshDecorations.of(null) })
      }, 30_000)
    }
    destroy(): void {
      clearInterval(this.timer)
    }
  },
)
