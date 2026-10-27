<script setup lang="ts">
/**
 * «ИИ в документе» in a note's status line: its panel slides up over the note, held to the line — the document's
 * memory (what every AI turn reads: its aim, what was agreed, how to work in it — kept short; the agents keep it, and
 * so may everyone who edits the note) and the AI's work in it: the journal of turns, or the graph of what they touched.
 * Its head dragged up or down — its height (kept, as the view chosen).
 */
import { computed, ref, watch } from 'vue'
import { DOC_AI_VIEWS, DOC_MEMORY_MAX, type DocAiView } from '@shared/agent/docAi'
import type { leafTarget } from '@shared/agent/turnGraph'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { openUrl } from '@renderer/lib/links'
import type { Placement } from '@renderer/lib/usePopover'
import { useTransport } from '@renderer/lib/transport'
import { docAiNow, mayEditDocAi, MemoryChanged, setDocMemory } from '@nb/workspace/docAiStore'
import { openNoteAt } from '@nb/workspace/noteGoto'
import { noteName } from '@nb/domain/notePaths'
import DocAiGraph from './DocAiGraph.vue'
import DocAiJournal from './DocAiJournal.vue'
import { isDocAiOpen, setDocAiOpen } from './docAiOpen'

/** `bar` — the status line the panel is held to (its width, its top). */
const props = defineProps<{ path: string; bar: HTMLElement | undefined }>()
/** Open for this note (each note its own; only its button opens and closes it). */
const open = computed({ get: () => isDocAiOpen(props.path), set: (on: boolean) => setDocAiOpen(props.path, on) })
const ai = computed(() => docAiNow(props.path))
const editable = computed(() => mayEditDocAi(props.path))
const transport = useTransport()

/** Over the note, as wide as it, its bottom on the status line; the room up to the window's top. */
const onBar: Placement = ({ rect }) => {
  const room = Math.max(180, rect.top - 50)
  return { style: { left: `${rect.left}px`, width: `${rect.width}px`, bottom: `${window.innerHeight - rect.top}px` }, up: true, room }
}

// ---------- kept for the next time: its height, its view ----------
const KEEP = 'qa.docai.panel'
const HEIGHT = { min: 200, start: 460 }
function kept(): { h: number; view: DocAiView } {
  try {
    const v = JSON.parse(localStorage.getItem(KEEP) ?? '{}') as { h?: unknown; view?: unknown }
    return { h: typeof v.h === 'number' ? v.h : HEIGHT.start, view: (DOC_AI_VIEWS as readonly unknown[]).includes(v.view) ? (v.view as DocAiView) : 'journal' }
  } catch {
    return { h: HEIGHT.start, view: 'journal' }
  }
}
const height = ref(kept().h)
const view = ref<DocAiView>(kept().view)
watch([height, view], () => {
  try {
    localStorage.setItem(KEEP, JSON.stringify({ h: Math.round(height.value), view: view.value }))
  } catch {
    // kept for this run only
  }
})
const VIEW_LABEL: Record<DocAiView, string> = { journal: 'Журнал', graph: 'Граф' }

/** The head dragged: the panel taller (up) or lower (down), within the room there is. */
let drag: { y: number; h: number; room: number } | undefined
function startDrag(e: PointerEvent, room: number): void {
  if ((e.target as HTMLElement).closest('button, select, input, textarea')) return
  drag = { y: e.clientY, h: Math.min(height.value, room), room }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
const onDrag = (e: PointerEvent) => drag && (height.value = Math.max(HEIGHT.min, Math.min(drag.room, drag.h + drag.y - e.clientY)))
const endDrag = () => (drag = undefined)

// ---------- the memory: a draft while it is edited, the kept one else ----------
const draft = ref('')
const editing = ref(false)
const saving = ref(false)
const error = ref('')
const memoryNow = computed(() => ai.value.memory?.text ?? '')
watch([memoryNow, open], () => !editing.value && (draft.value = memoryNow.value), { immediate: true })
const changed = computed(() => draft.value.trim() !== memoryNow.value.trim())
async function save(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await setDocMemory(props.path, draft.value, transport.value.name || 'Вы', false, editBase)
    editing.value = false
  } catch (e) {
    // (someone changed it meanwhile: the draft stays, said why — «Отменить» takes the fresh one)
    error.value = e instanceof MemoryChanged ? `Память уже изменил ${e.now?.by ?? 'кто-то'} — ваш текст не сохранён: «Отменить» покажет текущую` : remoteError(e)
  } finally {
    saving.value = false
  }
}
/** The version the edit started from: changed meanwhile (someone's AI wrote it) — the save is refused, nothing lost. */
let editBase = 0
function startEditing(): void {
  if (!editing.value) editBase = ai.value.memory?.at ?? 0
  editing.value = true
}
function undo(): void {
  draft.value = memoryNow.value
  editing.value = false
  error.value = ''
}
const whenSaved = (at: number) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** A thing of the graph opened: a note at its part, a task / an event / a page by its link. */
function go(t: NonNullable<ReturnType<typeof leafTarget>>): void {
  if ('url' in t) return openUrl(t.url)
  void openNoteAt(t.note, t.part)
}
</script>

<template>
  <button
    class="tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:hover:bg-white/8 tw:hover:text-text tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg"
    :class="{ on: open }"
    :title="open ? 'Скрыть работу ИИ' : 'Работа ИИ в документе: его память, журнал и граф'"
    @click="open = !open"
  >
    <Icon name="sparkles" :size="12" />Работа ИИ<b v-if="ai.turns.length" class="tw:font-data tw:font-normal">{{ ai.turns.length }}</b>
  </button>
  <Popover v-slot="{ room }" v-model:open="open" :anchor="bar" :place="onBar" max-height="none" stay class="tw:fixed tw:z-4000 tw:border tw:border-border-2 tw:border-b-0 tw:rounded-t-[14px] tw:bg-pop tw:[box-shadow:var(--shadow-pop-edge)] tw:text-[12.5px] tw:overflow-hidden">
    <div class="tw:flex tw:flex-col tw:gap-10 tw:pb-12 tw:px-14" :style="{ height: `${Math.min(height, room ?? height)}px` }">
      <!-- the head: drag it up / down — the height -->
      <div class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:-mx-14 tw:pt-4 tw:pb-2 tw:px-14 tw:cursor-ns-resize tw:select-none" title="Потяните вверх или вниз — высота панели" @pointerdown="startDrag($event, room ?? height)" @pointermove="onDrag" @pointerup="endDrag" @pointercancel="endDrag">
        <span class="tw:absolute tw:left-1/2 tw:top-4 tw:w-36 tw:h-3 tw:-ml-18 tw:rounded-full tw:bg-white/14"></span>
        <Icon name="sparkles" :size="14" class="tw:mt-8 tw:text-accent-fg" />
        <b class="tw:mt-8 tw:text-text-hi tw:text-[13px]">ИИ в документе</b>
        <span class="tw:flex-1"></span>
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:mt-8 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Скрыть (так же — «Работа ИИ» внизу)" @click="open = false"><Icon name="x" :size="13" /></button>
      </div>

      <!-- the memory -->
      <div class="tw:flex tw:flex-none tw:flex-col tw:gap-4">
        <div class="tw:flex tw:items-center tw:gap-8 tw:text-[11.5px] tw:whitespace-nowrap tw:overflow-hidden">
          <b class="tw:text-text">Память</b>
          <span class="tw:min-w-0 tw:truncate tw:text-muted" title="Её читает каждый ход ИИ в этом документе; ИИ ведёт её сам — кратко, только важное надолго">читает каждый ход ИИ · ИИ ведёт её сам</span>
          <span class="tw:flex-1"></span>
          <span v-if="ai.memory" class="tw:text-muted">{{ ai.memory.by }} · {{ whenSaved(ai.memory.at) }}</span>
        </div>
        <textarea
          v-model="draft"
          class="tw:w-full tw:min-h-60 tw:max-h-160 tw:py-8 tw:px-10 tw:rounded-[10px] tw:resize-none tw:text-[12.5px] tw:leading-[1.45] tw:field-sizing-content"
          :readonly="!editable"
          :maxlength="DOC_MEMORY_MAX"
          :placeholder="editable ? 'Цель документа, договорённости, решения, как с ним работать — кратко, пунктами. ИИ будет дописывать сюда сам.' : 'Пусто'"
          spellcheck="false"
          @input="startEditing"
          @keydown.ctrl.enter.prevent="changed && save()"
        ></textarea>
        <div v-if="!editable || error || (editable && changed) || draft.length > DOC_MEMORY_MAX * 0.8" class="tw:flex tw:items-center tw:gap-8 tw:text-[11px]">
          <span class="tw:font-data" :class="draft.length > DOC_MEMORY_MAX * 0.9 ? 'tw:text-warn-fg' : 'tw:text-muted'">{{ draft.length }} / {{ DOC_MEMORY_MAX }}</span>
          <span v-if="!editable" class="tw:text-muted">только чтение — ваша роль в заметке</span>
          <span v-if="error" class="tw:min-w-0 tw:truncate tw:text-down-fg">{{ error }}</span>
          <span class="tw:flex-1"></span>
          <template v-if="editable && changed">
            <button class="tw:h-24 tw:py-0 tw:px-10 tw:rounded-full tw:text-[11.5px]" @click="undo">Отменить</button>
            <button class="primary tw:h-24 tw:py-0 tw:px-10 tw:rounded-full tw:text-[11.5px]" :disabled="saving" title="Сохранить (Ctrl+Enter)" @click="save">Сохранить</button>
          </template>
        </div>
      </div>

      <div class="tw:flex-none tw:h-1 tw:-mx-14 tw:bg-border"></div>
      <!-- the AI's work: the journal, or the graph -->
      <div class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:text-[11.5px]">
        <b class="tw:text-text">Работа ИИ</b>
        <span class="tw:inline-flex tw:border tw:border-border-2 tw:rounded-full tw:overflow-hidden">
          <button v-for="v in DOC_AI_VIEWS" :key="v" class="tw:h-22 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-text" :class="{ on: view === v }" @click="view = v">{{ VIEW_LABEL[v] }}</button>
        </span>
        <span class="tw:text-muted">последние {{ ai.turns.length }} ходов</span>
      </div>
      <DocAiJournal v-if="view === 'journal'" class="tw:flex-1" :turns="ai.turns" />
      <DocAiGraph v-else class="tw:flex-1" :turns="ai.turns" :title="noteName(path)" @open="go" />
    </div>
  </Popover>
</template>
