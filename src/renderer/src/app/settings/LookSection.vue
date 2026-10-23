<script setup lang="ts">
/** Settings · the look (contrast, accent, rounding, digits font) and the menu (order by dragging, hide with the eye). */
import { computed, ref } from 'vue'
import { CONTRAST_LABELS, CONTRASTS, DEFAULT_THEME, type Theme } from '@shared/theme'
import Icon from '../../components/Icon.vue'
import { cssHex } from '../../lib/cssColor'
import { orderedViews, VIEWS } from '../../lib/views'
import { startListDrag } from '../../lib/listDrag'
import { useSettingsContext } from './settingsContext'

const { ui, applyUi } = useSettingsContext()

// ---------- the look ----------
/** The offered accents: their colours are in theme.css; a picked one is kept as its concrete colour. */
const ACCENT_CHOICES = [
  { cssVar: '--accent-choice-orange', label: 'Оранжевый' },
  { cssVar: '--accent-choice-turquoise', label: 'Бирюзовый' },
  { cssVar: '--accent-choice-green', label: 'Зелёный' },
  { cssVar: '--accent-choice-blue', label: 'Синий' },
  { cssVar: '--accent-choice-violet', label: 'Фиолетовый' },
  { cssVar: '--accent-choice-amber', label: 'Янтарный' },
  { cssVar: '--accent-choice-pink', label: 'Розовый' },
] as const
const accents = ACCENT_CHOICES.map((a) => ({ ...a, color: cssHex(a.cssVar) ?? '' }))
const ownAccent = computed(() => !accents.some((a) => a.color === ui.theme.accent))
function setTheme(p: Partial<Theme>): void {
  Object.assign(ui.theme, p)
  void applyUi()
}

// ---------- the menu: order by dragging, hide with the eye ----------
const menuViews = computed(() => orderedViews(ui.menu))
const isHidden = (id: string) => ui.menu.hidden.includes(id)
function toggleHidden(id: string): void {
  const h = new Set(ui.menu.hidden)
  if (h.has(id)) h.delete(id)
  else if (VIEWS.length - h.size > 1) h.add(id) // at least one section stays
  ui.menu.hidden = [...h]
  void applyUi()
}
const mlist = ref<HTMLElement>()
const dragId = ref<string>()
function startDrag(e: PointerEvent, id: string): void {
  const list = mlist.value?.firstElementChild as HTMLElement | null
  if (!list) return
  dragId.value = id
  startListDrag(e, {
    list,
    index: menuViews.value.findIndex((v) => v.id === id),
    move: (from, to) => {
      const ids = menuViews.value.map((v) => v.id as string)
      const [x] = ids.splice(from, 1)
      ids.splice(to, 0, x)
      ui.menu.order = ids
    },
    done: () => {
      dragId.value = undefined
      void applyUi()
    },
  })
}
/** The menu's own order and hidden sections dropped. */
function resetMenu(): void {
  ui.menu.order = []
  ui.menu.hidden = []
  void applyUi()
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Оформление</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Применяется сразу во всех окнах.</p>
      <div class="look tw:flex tw:flex-col tw:gap-14 tw:max-w-640">
        <div class="lrow tw:flex tw:items-center tw:gap-14 tw:min-h-30">
          <span class="ll tw:flex-none tw:w-170 tw:text-text-2">Контраст</span>
          <span class="seg3 tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden"><button class="tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:py-5 tw:px-14 tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" v-for="c in CONTRASTS" :key="c" :class="{ on: ui.theme.contrast === c }" @click="setTheme({ contrast: c })">{{ CONTRAST_LABELS[c] }}</button></span>
        </div>
        <div class="lrow tw:flex tw:items-center tw:gap-14 tw:min-h-30">
          <span class="ll tw:flex-none tw:w-170 tw:text-text-2">Акцент</span>
          <span class="sws tw:inline-flex tw:gap-8 tw:items-center">
            <button v-for="a in accents" :key="a.cssVar" class="sw tw:[.seg3_button+&]:not-[&.on]:border-l tw:[.seg3_button+&]:not-[&.on]:border-l-border-2 tw:relative tw:w-24 tw:h-24 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r2 tw:[outline:1px_solid_var(--border-2)] tw:cursor-pointer tw:[&.on]:border-bg tw:[&.on]:[outline:2px_solid_var(--text-hi)] tw:hover:enabled:not-[.seg3_button+&]:not-[&.on]:border-border-3" :class="{ on: ui.theme.accent === a.color }" :style="{ background: `var(${a.cssVar})` }" :title="a.label" @click="setTheme({ accent: a.color })"></button>
            <label class="sw own tw:flex-col tw:gap-4 tw:text-[12px] tw:relative tw:w-24 tw:h-24 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r2 tw:[outline:1px_solid_var(--border-2)] tw:cursor-pointer tw:[&.on]:border-bg tw:[&.on]:[outline:2px_solid_var(--text-hi)] tw:inline-flex tw:items-center tw:justify-center tw:text-on-accent" :class="{ on: ownAccent }" title="Свой цвет" :style="{ background: ui.theme.accent }"><input class="tw:[.secret_&]:flex-1 tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer" type="color" :value="ui.theme.accent" @change="setTheme({ accent: ($event.target as HTMLInputElement).value })" /><Icon name="pencil" :size="11" /></label>
          </span>
        </div>
        <div class="lrow tw:flex tw:items-center tw:gap-14 tw:min-h-30">
          <span class="ll tw:flex-none tw:w-170 tw:text-text-2">Скругление панелей</span>
          <span class="orow tw:flex tw:items-center tw:gap-10"><input class="tw:flex-1 tw:[accent-color:var(--accent)] tw:[.secret_&]:flex-1" v-model.number="ui.theme.radius" type="range" min="0" max="14" step="1" @change="applyUi" /><b class="tw:min-w-40 tw:tabular-nums tw:font-data">{{ ui.theme.radius }} px</b></span>
        </div>
        <div class="lrow tw:flex tw:items-center tw:gap-14 tw:min-h-30">
          <span class="ll tw:flex-none tw:w-170 tw:text-text-2">Цифры и время</span>
          <label class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="ui.theme.mono" type="checkbox" @change="applyUi" /><span class="tw:-order-1">Моноширинным шрифтом</span></label>
        </div>
        <div class="tprev tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:overflow-hidden">
          <div class="tp-head tw:flex tw:items-center tw:justify-between tw:py-7 tw:px-12 tw:border-b tw:border-b-border tw:[box-shadow:inset_0_2px_0_var(--accent)] tw:font-data tw:text-[10.5px] tw:tracking-[0.08em] tw:text-text-2"><span>ПРИМЕР ПАНЕЛИ</span><i class="tp-led tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-up"></i></div>
          <div class="tp-body tw:flex tw:items-center tw:gap-14 tw:p-12">
            <span class="tp-num tw:font-data tw:text-[22px] tw:font-semibold tw:text-text-hi">7ч 42м</span>
            <span class="tp-up tw:font-data tw:text-up-fg">+12%</span>
            <span class="tp-chip tw:py-2 tw:px-8 tw:rounded-r2 tw:bg-accent-soft tw:text-accent-fg tw:font-data tw:text-[12px]">ABC-42</span>
            <button class="primary tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:ml-auto tw:hover:enabled:bg-accent-hi tw:[&&]:hover:enabled:border-accent-hi">Действие</button>
          </div>
        </div>
        <div><button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="setTheme({ ...DEFAULT_THEME })">Сбросить оформление</button></div>
      </div>

      <h3 class="mt tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2 tw:[&&]:mt-26">Меню</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Перетащите раздел за ручку, чтобы поменять порядок. Глаз — показать или скрыть.</p>
      <div ref="mlist">
        <TransitionGroup tag="div" class="mlist tw:flex tw:flex-col tw:gap-4 tw:max-w-420 tw:mb-10" name="mrow">
          <div v-for="v in menuViews" :key="v.id" class="mrow tw:group/mrow tw:flex tw:items-center tw:gap-10 tw:h-36 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-4 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:select-none tw:[&.drag]:border-accent tw:[&.drag]:bg-panel-2" :data-mid="v.id" :class="{ drag: dragId === v.id, off: isHidden(v.id) }">
            <span class="mgrip tw:inline-flex tw:py-6 tw:px-4 tw:text-dim tw:cursor-grab tw:touch-none tw:group-[.drag]/mrow:cursor-grabbing tw:group-[.drag]/mrow:text-accent-fg" title="Перетащить" @pointerdown="startDrag($event, v.id)"><Icon name="grip" :size="14" /></span>
            <Icon :name="v.icon" :size="15" />
            <span class="mlabel tw:flex-1">{{ v.label }}</span>
            <button class="mini tw:[.order_&]:py-0 tw:[.order_&]:px-4 tw:[.order_&]:leading-[1] tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7 tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :title="isHidden(v.id) ? 'Показать в меню' : 'Скрыть из меню'" @click="toggleHidden(v.id)"><Icon :name="isHidden(v.id) ? 'eyeOff' : 'eye'" :size="14" /></button>
          </div>
        </TransitionGroup>
      </div>
      <div><button class="tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="resetMenu">Порядок по умолчанию</button></div>
    </section>
</template>

<style scoped src="./LookSection.css"></style>
