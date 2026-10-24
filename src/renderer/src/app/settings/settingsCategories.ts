/** The settings' sections (like System Settings): a sidebar, or tabs on top in a narrow window. */
export type SettingsCategoryId = 'general' | 'kinds' | 'attributes' | 'look' | 'ui' | 'voice' | 'tablet' | 'outlook' | 'jira' | 'server' | 'browser' | 'ai'

export interface SettingsCategory {
  id: SettingsCategoryId
  icon: string
  label: string
  /** Its changes apply at once — no «Сохранить» under it. */
  appliesAtOnce?: boolean
}

/** Every section once, in the sidebar's order (the compiler checks none is missing). */
const CATEGORY: Record<SettingsCategoryId, Omit<SettingsCategory, 'id'>> = {
  general: { icon: 'clock', label: 'Основное' },
  kinds: { icon: 'tag', label: 'Виды занятости' },
  attributes: { icon: 'layers', label: 'Атрибуты', appliesAtOnce: true },
  look: { icon: 'palette', label: 'Оформление' },
  ui: { icon: 'layers', label: 'Интерфейс', appliesAtOnce: true },
  voice: { icon: 'mic', label: 'Голос', appliesAtOnce: true },
  tablet: { icon: 'penTool', label: 'Планшет' },
  outlook: { icon: 'calendar', label: 'Outlook и Teams', appliesAtOnce: true },
  jira: { icon: 'jira', label: 'Jira' },
  server: { icon: 'chat', label: 'Сервер и чат', appliesAtOnce: true },
  browser: { icon: 'browser', label: 'Браузер' },
  ai: { icon: 'sparkles', label: 'AI-ассистенты' },
}
export const SETTINGS_CATEGORIES: SettingsCategory[] = Object.entries(CATEGORY).map(([id, c]) => ({ id: id as SettingsCategoryId, ...c }))

/** Whether a section's changes apply at once (no «Сохранить» needed). */
export const appliesAtOnce = (id: SettingsCategoryId): boolean => !!CATEGORY[id].appliesAtOnce

const CATEGORY_KEY = 'qa.settingsCat'
/** The section open last time (the first one when unknown). */
export function readSettingsCategory(): SettingsCategoryId {
  try {
    const v = localStorage.getItem(CATEGORY_KEY)
    return v && Object.hasOwn(CATEGORY, v) ?(v as SettingsCategoryId) : 'general'
  } catch {
    return 'general'
  }
}
/** Remembers the open section for the next time. */
export function rememberSettingsCategory(id: SettingsCategoryId): void {
  try {
    localStorage.setItem(CATEGORY_KEY, id)
  } catch {
    // not remembered — fine
  }
}
