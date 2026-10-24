<script setup lang="ts">
/**
 * Settings · the menu: the bar's sections and «Инструменты» — two lists, each in its order by dragging; a section moved
 * between them by its arrow; the bar's ones hidden / shown with the eye. «Моя работа» and «Инструменты» stay on the bar.
 */
import { computed, ref } from 'vue'
import { DEFAULT_IN_TOOLS, MOVABLE_SECTIONS, moveSection, reorderTools, toolsIds, type MovableSection } from '@shared/places'
import Icon from '../../components/Icon.vue'
import { orderedViews, VIEWS } from '../../lib/views'
import { startListDrag } from '../../lib/listDrag'
import { toolItem } from '../toolsRegistry'
import { useSettingsContext } from './settingsContext'

const { ui, applyUi } = useSettingsContext()
const isMovable = (id: string): id is MovableSection => (MOVABLE_SECTIONS as readonly string[]).includes(id)

// ---------- the bar ----------
const barViews = computed(() => orderedViews(ui.menu))
const isHidden = (id: string) => ui.menu.hidden.includes(id)
function toggleHidden(id: string): void {
  const h = new Set(ui.menu.hidden)
  if (h.has(id)) h.delete(id)
  else if (barViews.value.length - h.size > 1) h.add(id) // at least one section stays
  ui.menu.hidden = [...h]
  void applyUi()
}
// ---------- «Инструменты» ----------
const toolRows = computed(() => toolsIds(ui.menu).flatMap((id) => (toolItem(id) ? [{ id, ...toolItem(id)! }] : [])))

/** A section moved to the bar / into «Инструменты». */
function move(id: MovableSection, to: 'header' | 'tools'): void {
  Object.assign(ui.menu, moveSection(ui.menu, id, to, barViews.value.map((v) => v.id)))
  void applyUi()
}

// ---------- dragging a row in its list ----------
const barList = ref<HTMLElement>()
const toolList = ref<HTMLElement>()
const dragId = ref<string>()
/** The lists: the rows' ids now and how a new order is kept. */
const LISTS = {
  bar: { el: barList, ids: () => barViews.value.map((v) => v.id as string), set: (ids: string[]) => (ui.menu.order = ids) },
  tools: { el: toolList, ids: () => toolRows.value.map((t) => t.id as string), set: (ids: string[]) => Object.assign(ui.menu, reorderTools(ui.menu, ids)) },
}
function startDrag(e: PointerEvent, list: keyof typeof LISTS, id: string): void {
  const l = LISTS[list]
  const el = l.el.value?.firstElementChild as HTMLElement | null
  if (!el) return
  dragId.value = id
  startListDrag(e, {
    list: el,
    index: l.ids().indexOf(id),
    move: (from, to) => {
      const ids = l.ids()
      const [x] = ids.splice(from, 1)
      ids.splice(to, 0, x)
      l.set(ids)
    },
    done: () => {
      dragId.value = undefined
      void applyUi()
    },
  })
}
/** The menu as it comes: the default order, nothing hidden, the default sections in «Инструменты». */
function resetMenu(): void {
  Object.assign(ui.menu, { order: [], hidden: [], tools: [...DEFAULT_IN_TOOLS] })
  void applyUi()
}
const label = (id: string) => VIEWS.find((v) => v.id === id)?.label ?? id
</script>

<template>
  <h3 class="mt tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2 tw:[&&]:mt-26">Меню</h3>
  <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Что стоит на панели в шапке, а что — в «Инструментах». Перетащите за ручку — порядок; стрелка — перенести; глаз — скрыть с панели.</p>
  <div class="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(260px,1fr))] tw:gap-16 tw:max-w-720 tw:mb-10">
    <div>
      <div class="tw:mb-6 tw:text-text-2 tw:text-[12px]">На панели</div>
      <div ref="barList">
        <TransitionGroup tag="div" class="mlist tw:flex tw:flex-col tw:gap-4" name="mrow">
          <div v-for="v in barViews" :key="v.id" class="mrow tw:group/mrow tw:flex tw:items-center tw:gap-10 tw:h-36 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-4 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:select-none tw:[&.drag]:border-accent tw:[&.drag]:bg-panel-2 tw:[&.off]:opacity-55" :class="{ drag: dragId === v.id, off: isHidden(v.id) }">
            <span class="mgrip tw:inline-flex tw:py-6 tw:px-4 tw:text-dim tw:cursor-grab tw:touch-none tw:group-[.drag]/mrow:cursor-grabbing tw:group-[.drag]/mrow:text-accent-fg" title="Перетащить" @pointerdown="startDrag($event, 'bar', v.id)"><Icon name="grip" :size="14" /></span>
            <Icon :name="v.icon" :size="15" />
            <span class="mlabel tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ v.label }}</span>
            <button class="mini tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7" :title="isHidden(v.id) ? 'Показать на панели' : 'Скрыть с панели'" @click="toggleHidden(v.id)"><Icon :name="isHidden(v.id) ? 'eyeOff' : 'eye'" :size="14" /></button>
            <button v-if="isMovable(v.id)" class="mini tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7" title="Перенести в «Инструменты»" @click="move(v.id, 'tools')"><Icon name="chevronRight" :size="14" /></button>
          </div>
        </TransitionGroup>
      </div>
    </div>
    <div>
      <div class="tw:mb-6 tw:text-text-2 tw:text-[12px]">В «Инструментах»</div>
      <div ref="toolList">
        <TransitionGroup tag="div" class="mlist tw:flex tw:flex-col tw:gap-4" name="mrow">
          <div v-for="t in toolRows" :key="t.id" class="mrow tw:group/mrow tw:flex tw:items-center tw:gap-10 tw:h-36 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-4 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:select-none tw:[&.drag]:border-accent tw:[&.drag]:bg-panel-2" :class="{ drag: dragId === t.id }">
            <span class="mgrip tw:inline-flex tw:py-6 tw:px-4 tw:text-dim tw:cursor-grab tw:touch-none tw:group-[.drag]/mrow:cursor-grabbing tw:group-[.drag]/mrow:text-accent-fg" title="Перетащить" @pointerdown="startDrag($event, 'tools', t.id)"><Icon name="grip" :size="14" /></span>
            <button v-if="isMovable(t.id)" class="mini tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7" :title="`Вернуть «${label(t.id)}» на панель`" @click="move(t.id, 'header')"><Icon name="chevronLeft" :size="14" /></button>
            <Icon :name="t.icon" :size="15" />
            <span class="mlabel tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :title="t.hint">{{ t.label }}</span>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </div>
  <div><button @click="resetMenu">Как по умолчанию</button></div>
</template>

<style scoped src="./MenuPlaces.css"></style>
