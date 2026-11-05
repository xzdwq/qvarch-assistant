/**
 * UI kits a site's page may be built with, as adapters: each says, by meaning, how its parts look in the DOM (a
 * field, its label, a menu, a dialog, a field's error…). The recorder (in the page) and the `qa` checks (sent into
 * the page) find parts by role only — never by a kit's class. Pure data and functions: runs in a page as well.
 */

/** What a part of a page is (the roles parts are found by). */
export const UI_ROLES = [
  /** A field's wrapper (its label, its input, its messages inside). */
  'field',
  /** A field's own label inside its wrapper. */
  'fieldLabel',
  /** What opens a list of options when clicked. */
  'listField',
  /** A select's wrapper showing the value picked apart from its input (the input — a search box, if any). */
  'selectWrap',
  /** Where a select's wrapper shows the value picked. */
  'selectValue',
  /** A popup list (a menu, a listbox). */
  'menu',
  /** An option of a popup list. */
  'option',
  /** An open dialog. */
  'dialog',
  /** A dialog's title. */
  'dialogTitle',
  /** A button. */
  'button',
  /** An icon (a font ligature / a class — not a name). */
  'icon',
  /** A tab. */
  'tab',
  /** A flag: a checkbox, a radio, a switch. */
  'check',
  /** What holds a flag with its words. */
  'checkLabel',
  /** A chip (a removable tag). */
  'chip',
  /** A field's validation message. */
  'fieldError',
  /** A message the page pops up (a notification, an error toast, an alert). */
  'notice',
  /** A field marked required by its wrapper. */
  'required',
] as const
export type UiRole = (typeof UI_ROLES)[number]

/** One kit: its parts by role (a CSS selector list each) and its classes / ids that are not steady. */
export interface UiKit {
  name: string
  description: string
  roles: Partial<Record<UiRole, string>>
  /** Class prefixes telling a state or generated (never part of a CSS path). */
  stateClasses?: readonly string[]
  /** Id prefixes the kit generates (such an id is not steady). */
  generatedIds?: readonly string[]
  /** Class prefixes naming an icon (`mdi-pencil` — «pencil»). */
  iconClasses?: readonly string[]
}

const QUASAR_CHECK = '.q-checkbox, .q-radio, .q-toggle'

/** The kits known; the first — plain HTML and ARIA, what every page may have. */
export const UI_KITS: readonly UiKit[] = [
  {
    name: 'html',
    description: 'HTML and ARIA roles',
    roles: {
      listField: '[role="combobox"]',
      menu: '[role="menu"], [role="listbox"]',
      option: '[role="option"], [role="menuitem"]',
      dialog: '[role="dialog"], [role="alertdialog"], dialog[open]',
      dialogTitle: 'h1, h2, h3, [class*="title"]',
      button: 'button, [role="button"], input[type="button"], input[type="submit"]',
      tab: '[role="tab"]',
      check: 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]',
      checkLabel: 'label',
      fieldError: '.error-message',
      notice: '[role="alert"], .toast-error',
      required: '.required',
    },
    stateClasses: ['active', 'focus', 'hover', 'selected'],
    generatedIds: ['uid'],
  },
  {
    name: 'quasar',
    description: 'Quasar (Vue)',
    roles: {
      field: '.q-field',
      fieldLabel: '.q-field__label',
      listField: '.q-select',
      selectWrap: '.q-select',
      selectValue: '.q-field__native',
      menu: '.q-menu',
      option: '.q-item',
      dialog: '.q-dialog',
      dialogTitle: '.q-card__section .text-h6',
      button: '.q-btn',
      icon: 'i.q-icon',
      tab: '.q-tab',
      check: QUASAR_CHECK,
      checkLabel: QUASAR_CHECK,
      chip: '.q-chip',
      fieldError: '.q-field--error .q-field__messages, .q-field__bottom .text-negative',
      notice: '.q-notification',
    },
    stateClasses: ['q-focus', 'q-hover', 'q-ripple', 'q-transition'],
    generatedIds: ['f_', 'q-'],
  },
  {
    name: 'vuetify',
    description: 'Vuetify (Vue) with Material Design Icons',
    roles: { dialogTitle: '.v-card-title', icon: '.v-icon' },
    iconClasses: ['mdi-'],
  },
  {
    name: 'material-icons',
    description: 'Google Material Icons / Symbols font',
    roles: { icon: '.material-icons, .material-icons-outlined, .material-symbols-outlined' },
  },
  {
    name: 'element',
    description: 'Element Plus / Element UI (Vue)',
    roles: { dialog: '.el-message-box', fieldError: '.el-form-item__error', notice: '.el-message--error', required: '.is-required' },
  },
  {
    name: 'bootstrap',
    description: 'Bootstrap',
    roles: { dialog: '.modal.show', fieldError: '.invalid-feedback' },
  },
  {
    name: 'ant',
    description: 'Ant Design',
    roles: { dialog: '.ant-modal', fieldError: '.ant-form-item-explain-error' },
  },
  {
    name: 'vue-toastification',
    description: 'Vue Toastification',
    roles: { notice: '.Vue-Toastification__toast--error' },
  },
  {
    name: 'vue',
    description: 'Vue itself: transitions, router links, generated ids',
    roles: {},
    stateClasses: ['v-', 'router-link'],
    generatedIds: ['v-'],
  },
  {
    name: 'angular',
    description: 'Angular itself: state classes',
    roles: {},
    stateClasses: ['ng-'],
  },
]

/** A selector list's parts (commas inside brackets / parentheses kept). */
export function selectorParts(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}
/** Every kit's parts for a role, each once, in the kits' order. */
const partsOfRole = (role: UiRole): string[] => [...new Set(UI_KITS.flatMap((k) => selectorParts(k.roles[role] ?? '')))]
const listOf = (pick: (k: UiKit) => readonly string[] | undefined): readonly string[] => [...new Set(UI_KITS.flatMap((k) => pick(k) ?? []))]

/** The selectors by role: all kits together (the form a page's `evaluate` takes as its argument). */
export type UiSelectors = Readonly<Record<UiRole, string>>
export const UI: UiSelectors = Object.fromEntries(UI_ROLES.map((r) => [r, partsOfRole(r).join(', ')])) as Record<UiRole, string>
/** Class prefixes that are a state or generated, by every kit. */
export const UNSTEADY_CLASS_PREFIXES = listOf((k) => k.stateClasses)
/** Id prefixes kits generate. */
export const GENERATED_ID_PREFIXES = listOf((k) => k.generatedIds)
/** Class prefixes naming an icon. */
export const ICON_CLASS_PREFIXES = listOf((k) => k.iconClasses)

/**
 * The selector of a role an element itself answers to (the parts it matches) — for a locator written into a
 * scenario: the kit actually there, not every kit's classes; none matched — the whole role.
 */
export function selectorOf(el: { matches(sel: string): boolean }, role: UiRole): string {
  const mine = partsOfRole(role).filter((p) => el.matches(p))
  return mine.length ? mine.join(', ') : UI[role]
}

const XPATH_STEP = /^([a-z][a-z0-9]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i
const XPATH_PART = /\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g
/**
 * A selector list as an XPath predicate (inside `*[…]`): simple selectors only — a tag, classes, attributes; a
 * selector with combinators or pseudo-classes has none (an error: the role must be written plainer).
 */
export function xpathTest(sel: string): string {
  const one = (part: string) => {
    const m = XPATH_STEP.exec(part)
    if (!m || (!m[1] && !m[2])) throw new Error(`xpathTest: not a simple selector: ${part}`)
    const tests = m[1] ? [`local-name()='${m[1].toLowerCase()}'`] : []
    for (const x of m[2].matchAll(XPATH_PART)) {
      if (x[1]) tests.push(`contains(concat(' ', normalize-space(@class), ' '), ' ${x[1]} ')`)
      else tests.push(x[3] === undefined ? `@${x[2]}` : `@${x[2]}='${x[3]}'`)
    }
    return tests.join(' and ')
  }
  const parts = selectorParts(sel).map(one)
  return parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(' or ')
}
