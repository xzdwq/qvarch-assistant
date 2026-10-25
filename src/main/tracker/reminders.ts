import { Notification } from 'electron'
import { remindAt, type Remind } from '../../shared/repeat'
import { dayKey } from '../../shared/timeline'
import { contentsOf, type AppContext } from '../app/appContext'
import { emit } from '../ipc/router'

/**
 * Reminders: a notification when a block's or a note's time comes (once — marked fired; one older than half a day,
 * the app having been off, is only marked). The days of the last two days and later are looked at.
 */
export function checkReminders(app: AppContext): void {
  const { store } = app
  const now = Date.now()
  const from = dayKey(now - 2 * 86_400_000)
  for (const dk of store.listDays()) {
    if (dk < from) continue
    const d = store.day(dk)
    let changed = false
    const fire = (x: { remind?: Remind }, start: number, title: string, open: { entryId?: string }) => {
      const at = remindAt(x.remind, start)
      if (at === undefined || x.remind?.fired || at > now) return
      x.remind = { ...x.remind, fired: true }
      changed = true
      if (now - at > 12 * 3_600_000) return
      const head = `Напоминание · ${new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      // the island shows it too (until seen), whatever the system's notifications
      emit(contentsOf(app.windows.island?.win), 'onIslandNotice', { id: `${dk}:${open.entryId ?? title}:${at}`, title: head, text: title || 'Событие', at: now, day: dk, ...open })
      if (!Notification.isSupported()) return
      const n = new Notification({ title: head, body: title || 'Событие' })
      n.on('click', () => app.windows.showMain({ day: dk, ...open }))
      n.show()
    }
    for (const e of d.entries) fire(e, e.start, e.label, { entryId: e.id })
    for (const n of d.notes) fire(n, n.at, (n.text || n.transcript || 'Заметка').split('\n')[0].slice(0, 120), {})
    if (changed) store.markDirty(dk)
  }
}
