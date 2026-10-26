import { PAGE_LOOK_HEADINGS, PAGE_LOOK_MAX, type PageLook, type PageLookItem } from '../../shared/browser/pageLook'
import { nameOf, roleOf, textOf, visible } from './domText'
import { locatorFor } from './locators'

/** What may be acted on (the roles a recording finds elements by). */
const ACTABLE = 'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="combobox"], [role="switch"], [role="option"]'
/** An open dialog (its elements are what may be acted on now). */
const DIALOG = '[role="dialog"], dialog[open], .q-dialog'

/**
 * The page looked at for an agent: its visible actable elements (an open dialog's only — the page under it waits),
 * each with the locator the recorder would write; the same element twice — once.
 */
export function lookAtPage(): PageLook {
  const dialogs = [...document.querySelectorAll(DIALOG)].filter(visible)
  const root: ParentNode = dialogs.at(-1) ?? document
  const items: PageLookItem[] = []
  const seen = new Set<string>()
  let more = 0
  for (const el of root.querySelectorAll(ACTABLE)) {
    if (!visible(el)) continue
    const role = roleOf(el) ?? el.tagName.toLowerCase()
    const name = nameOf(el, role).slice(0, 80) || (el.getAttribute('placeholder') ?? '').trim()
    const loc = locatorFor(el)
    if (seen.has(loc)) continue
    seen.add(loc)
    if (items.length >= PAGE_LOOK_MAX) {
      more++
      continue
    }
    items.push({ role, name, loc, ...((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' ? { disabled: true } : {}) })
  }
  const headings = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')]
    .filter(visible)
    .map((h) => textOf(h, 80))
    .filter(Boolean)
    .slice(0, PAGE_LOOK_HEADINGS)
  const dialog = dialogs.at(-1)
  return { url: location.href, title: document.title, headings, ...(dialog ? { dialog: textOf(dialog.querySelector('h1, h2, h3, [class*="title"]') ?? dialog, 60) } : {}), items, more }
}
