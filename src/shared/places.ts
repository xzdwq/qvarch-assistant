import type { UiPrefs } from './types'

/**
 * Where the main window's sections stand: on the header's bar, or inside «Инструменты» (next to its own tools). The
 * person decides (Настройки → Оформление → Меню): which section goes where, the order on the bar and in the tools.
 * «Моя работа» and «Инструменты» itself stay on the bar.
 */

/** The sections that may move into «Инструменты» (the terminal does not: it has its bottom panel, whatever is open). */
export const MOVABLE_SECTIONS = ['notebook', 'release', 'browser', 'http'] as const
export type MovableSection = (typeof MOVABLE_SECTIONS)[number]
/** «Инструменты»'s own tools, in their default order. */
export const TOOL_IDS = ['diff', 'codec', 'yaml', 'regex', 'time', 'cron', 'clip', 'pdf'] as const
export type ToolId = (typeof TOOL_IDS)[number]
/** What stands in «Инструменты» until the person says otherwise. */
export const DEFAULT_IN_TOOLS: readonly MovableSection[] = ['release', 'http']

type Menu = UiPrefs['menu']
const isMovable = (id: string): id is MovableSection => (MOVABLE_SECTIONS as readonly string[]).includes(id)
const isTool = (id: string): id is ToolId => (TOOL_IDS as readonly string[]).includes(id)
/** Whether an id may stand in «Инструменты» (a section that may move there, or a tool of its own). */
export const mayStandInTools = (id: string): boolean => isMovable(id) || isTool(id)

/** A place of the menu: on the bar, or in «Инструменты». */
export const placeOf = (menu: Menu, id: string): 'header' | 'tools' => (isTool(id) || (isMovable(id) && menu.tools.includes(id)) ? 'tools' : 'header')

/** The bar's sections in the person's order (the ones in «Инструменты» left out; new / unknown — at their default place). */
export function headerIds<T extends string>(menu: Menu, all: readonly T[]): T[] {
  const rank = (id: string) => {
    const i = menu.order.indexOf(id)
    return i < 0 ? menu.order.length + all.indexOf(id as T) : i
  }
  return all.filter((id) => placeOf(menu, id) === 'header').sort((a, b) => rank(a) - rank(b))
}
/** «Инструменты» in the person's order: the sections put there and the own tools (a tool not placed yet — at the end). */
export function toolsIds(menu: Menu): Array<MovableSection | ToolId> {
  const listed = menu.tools.filter((id): id is MovableSection | ToolId => isMovable(id) || isTool(id))
  return [...listed, ...TOOL_IDS.filter((t) => !listed.includes(t))]
}
/**
 * A section moved to the bar / into «Инструменты» (it goes to the end there; shown — never hidden on the move);
 * `bar` — the bar's sections as they stand now (their order is kept as it is shown).
 */
export function moveSection(menu: Menu, id: MovableSection, to: 'header' | 'tools', bar: readonly string[]): Menu {
  const tools = toolsIds(menu).filter((x) => x !== id)
  return {
    order: [...bar.filter((x) => x !== id), ...(to === 'header' ? [id] : [])],
    hidden: menu.hidden.filter((x) => x !== id),
    tools: to === 'tools' ? [...tools, id] : tools,
  }
}
/** «Инструменты»'s order as the person dragged it. */
export const reorderTools = (menu: Menu, ids: readonly string[]): Menu => ({ ...menu, tools: ids.filter(mayStandInTools) })
