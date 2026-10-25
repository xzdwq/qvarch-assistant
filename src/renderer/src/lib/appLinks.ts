import { parseNoteLink } from '@shared/noteEvents'
import { openDocLink } from '@nb/workspace/docLinks'
import { onAppLink, openUrl } from './links'
import { openEventInWork } from './mentions'
import { jiraSite } from './noteEvents'

/**
 * The app's own links (`qvarch://…`) wherever they are clicked — a note, a chat: a shared note (joined by its code when
 * not here), a Jira task (in the browser), an event (in Моя работа).
 */
let on = false
export function startAppLinks(): void {
  if (on) return
  on = true
  onAppLink('doc', openDocLink)
  onAppLink('jira', (url) => {
    const l = parseNoteLink(url)
    if (l?.kind === 'jira' && jiraSite.value) openUrl(`${jiraSite.value.replace(/\/$/, '')}/browse/${l.key}`)
  })
  onAppLink('event', (url) => {
    const l = parseNoteLink(url)
    if (l?.kind === 'event') openEventInWork(l.day, l.id)
  })
}
