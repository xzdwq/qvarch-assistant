import { ref } from 'vue'
import { EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { durText, periodText, statusOf, statusText, type NoteLink } from '@shared/noteEvents'
import { eventOf, events, eventsTick, issueOf, jiraSite, kindOf } from '@renderer/lib/noteEvents'
import { openUrl } from '@renderer/lib/links'
import type { JiraStatusCategory } from '@shared/jira'
import { iconSvg } from '@renderer/components/Icon.vue'
import { refreshDecorations } from './editorHost'

/**
 * An event of the timeline or a Jira task mentioned in a note: a live chip (its status, its period) instead of the
 * link's text. The chips follow the clock (every 30 s) and the events' list.
 */

/** The clock the chips (and the «@» menu's events) go by. */
export const chipClock = ref(Date.now())
/** What the chips show changed: the events' list reloaded, or half a minute passed. */
export const chipStamp = () => `${eventsTick.value}:${Math.floor(chipClock.value / 30000)}`
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
  toDOM(): HTMLElement {
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
    switch (l.kind) {
      case 'event':
        this.drawEvent(box, ic, l, now, part)
        break
      default:
        this.drawIssue(box, ic, l.key, part)
    }
    box.onmousedown = (ev) => ev.preventDefault()
    return box
  }
  /** An event of the timeline: its kind, label, period, status — a click opens its card. */
  private drawEvent(box: HTMLElement, ic: HTMLElement, l: Extract<NoteLink, { kind: 'event' }>, now: number, part: (cls: string, text: string, title?: string) => HTMLElement): void {
    const e = eventOf(l.day, l.id)
    if (!e) {
      ic.innerHTML = iconSvg('calendar', 13)
      box.classList.add(events.value.length ? 'gone' : 'wait')
      box.append(part('cm-ev-t', this.text))
      if (events.value.length) box.append(part('cm-ev-st gone', 'событие удалено'))
      box.title = events.value.length ? 'Этого события больше нет на таймлайне' : ''
      return
    }
    const k = kindOf(e.kind)
    ic.innerHTML = iconSvg(k?.icon ?? 'tag', 13)
    if (k?.color) box.style.setProperty('--ev', k.color)
    const st = statusOf(e, now)
    box.append(part('cm-ev-t', e.label || this.text), part('cm-ev-p', `${periodText(e, now)} · ${durText(e.end - e.start)}`), part(`cm-ev-st ${st}`, statusText(e, now)))
    if (e.created) box.append(part('cm-ev-c', `созд. ${shortDate(e.created)}`, `Создано ${new Date(e.created).toLocaleString('ru-RU')}`))
    box.title = `${k?.label ?? e.kind}${e.outlook ? ' · встреча Outlook' : ''}${e.task ? ` · ${e.task}` : ''} — клик: карточка события (прочитать, изменить, открыть в Моей работе)`
    box.onclick = () => {
      const r = box.getBoundingClientRect()
      window.dispatchEvent(new CustomEvent('qa:event-card', { detail: { day: e.day, id: e.id, x: r.left, y: r.bottom } }))
    }
  }
  /** A Jira task: its key, summary, status — a click opens it in the browser. */
  private drawIssue(box: HTMLElement, ic: HTMLElement, key: string, part: (cls: string, text: string) => HTMLElement): void {
    const is = issueOf(key)
    ic.innerHTML = iconSvg('jira', 13)
    box.style.setProperty('--ev', 'var(--editor-jira-chip)')
    box.append(part('cm-ev-t', is ? `${is.key} ${is.summary}` : this.text))
    if (is) box.append(part(`cm-ev-st ${issueStatusClass(is.category)}`, is.status))
    box.title = 'Задача Jira — клик: открыть в браузере'
    box.dataset.link = ''
    box.onclick = () => jiraSite.value && openUrl(`${jiraSite.value.replace(/\/$/, '')}/browse/${key}`)
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
