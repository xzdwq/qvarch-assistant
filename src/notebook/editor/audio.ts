import { createApp, type App } from 'vue'
import { EditorView, WidgetType } from '@codemirror/view'
import { audioUrl, fixDuration } from '@renderer/lib/notebook'
import ThinkingOrb from '@renderer/components/ThinkingOrb.vue'
import { editorHost } from './editorHost'
import { ICON_CAPTIONS, ICON_MIC, ICON_TRASH, widgetButton } from './icons'

/**
 * A voice recording's line drawn as its player: play, transcribe (the text goes on the line below), delete. While
 * it is being transcribed — a thinking orb instead of the button.
 */
export class AudioWidget extends WidgetType {
  constructor(
    readonly rel: string,
    /** The transcription's state: 'run' — going on, 'error' — failed, '' — none. */
    readonly state: string,
  ) {
    super()
  }
  eq(o: AudioWidget): boolean {
    return o.rel === this.rel && o.state === this.state
  }
  toDOM(v: EditorView): HTMLElement {
    const host = v.state.facet(editorHost)
    const box = document.createElement('span')
    box.className = 'cm-audio'
    const icon = document.createElement('span')
    icon.className = 'cm-audio-ic'
    icon.innerHTML = ICON_MIC
    const a = document.createElement('audio')
    a.controls = true
    a.preload = 'metadata'
    fixDuration(a)
    void audioUrl(this.rel)
      .then((u) => (a.src = u))
      .catch(() => {
        box.classList.add('missing')
        box.title = 'Файл записи не найден'
      })
    // transcribing: the orb; else the button (the text goes on the line below the player)
    let tr: HTMLElement
    if (this.state === 'run') {
      tr = document.createElement('span')
      tr.className = 'cm-audio-orb'
      tr.title = 'Расшифровка…'
      const app = createApp(ThinkingOrb, { state: 'weaving', size: 20, px: 22, tint: 'var(--accent-fg)' })
      app.mount(tr)
      ;(box as OrbHost)._orb = app
    } else tr = widgetButton(ICON_CAPTIONS, this.state === 'error' ? 'Расшифровать ещё раз (прошлая попытка не удалась)' : 'Расшифровать (локально) — текст строкой ниже', () => host.transcribe(this.rel), { className: 'cm-audio-tr' })
    const del = widgetButton(
      ICON_TRASH,
      'Удалить запись из заметки и с диска (текст расшифровки останется)',
      () => {
        if (confirm('Удалить аудиозапись из заметки и с диска? Текст расшифровки останется.')) host.dropAudio(this.rel)
      },
      { className: 'cm-audio-del' },
    )
    box.append(icon, a, tr, del)
    return box
  }
  destroy(dom: HTMLElement): void {
    ;(dom as OrbHost)._orb?.unmount()
  }
  ignoreEvent(): boolean {
    return true
  }
}
type OrbHost = HTMLElement & { _orb?: App }
