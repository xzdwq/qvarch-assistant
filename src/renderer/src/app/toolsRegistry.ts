import type { Component } from 'vue'
import type { MovableSection, ToolId } from '@shared/places'
import PdfSignView from './PdfSignView.vue'
import DiffTool from '../components/tools/DiffTool.vue'
import CodecTool from '../components/tools/CodecTool.vue'
import ClipTool from '../components/tools/ClipTool.vue'
import CronTool from '../components/tools/CronTool.vue'
import RegexTool from '../components/tools/RegexTool.vue'
import YamlTool from '../components/tools/YamlTool.vue'
import TimestampTool from '../components/tools/TimestampTool.vue'
import NotebookView from './NotebookView.vue'
import ReleaseView from './ReleaseView.vue'
import BrowserView from './BrowserView.vue'
import HttpView from './HttpView.vue'
import TerminalView from './TerminalView.vue'

/** An item of «Инструменты»: what it is called, its screen; `alive` — once opened it stays (hidden when another is shown). */
export interface ToolItem {
  icon: string
  label: string
  hint: string
  view: Component
  alive?: boolean
}
/** «Инструменты»'s own tools. */
export const TOOL_ITEMS: Record<ToolId, ToolItem> = {
  diff: { icon: 'diff', label: 'Сравнение текстов', hint: 'Два текста или JSON: что изменилось', view: DiffTool },
  codec: { icon: 'binary', label: 'Кодировки', hint: 'JWT, UUID, Base64 (и изображения), хэши MD5 / SHA', view: CodecTool },
  yaml: { icon: 'braces', label: 'JSON ↔ YAML', hint: 'Перевод в обе стороны и форматирование', view: YamlTool },
  regex: { icon: 'regex', label: 'Регулярные выражения', hint: 'Проверка, группы, замена, код', view: RegexTool },
  time: { icon: 'timer', label: 'Timestamp', hint: 'Unix-время, ISO, RFC, часовые пояса', view: TimestampTool },
  cron: { icon: 'repeat', label: 'Cron', hint: 'Выражение ↔ расписание словами, ближайшие запуски', view: CronTool },
  clip: { icon: 'clipboard', label: 'Буфер обмена', hint: 'Всё, что вы копировали', view: ClipTool },
  pdf: { icon: 'signature', label: 'Подпись PDF', hint: 'Подписать PDF-документ', view: PdfSignView },}
/** The sections as items of «Инструменты» (when moved there). The terminal and the browser stay once opened. */
export const SECTION_ITEMS: Record<MovableSection, ToolItem> = {
  notebook: { icon: 'notebook', label: 'Блокнот', hint: 'Заметки, исполняемые блоки, доски', view: NotebookView },
  release: { icon: 'branch', label: 'Релиз', hint: 'Сборка релиза из веток', view: ReleaseView },
  browser: { icon: 'globe', label: 'Браузер', hint: 'Встроенный браузер: проверки, запись, карта API', view: BrowserView, alive: true },
  http: { icon: 'api', label: 'HTTP', hint: 'Коллекция запросов', view: HttpView },
  terminal: { icon: 'terminal', label: 'Терминал', hint: 'PowerShell-вкладки', view: TerminalView, alive: true },
}
export const toolItem = (id: string): ToolItem | undefined => (id in TOOL_ITEMS ? TOOL_ITEMS[id as ToolId] : id in SECTION_ITEMS ? SECTION_ITEMS[id as MovableSection] : undefined)
