<script setup lang="ts">
/** Settings · the interface: what the pill, the dock, the island and the main window show; the timeline's behaviour. */
import type { UiPrefs } from '@shared/types'
import { uiPresetPrefs, type UiPreset } from '@shared/settingsForm'
import { useSettingsContext } from './settingsContext'

const { f, ui, apply, applyUi } = useSettingsContext()
const UI_PILL: Array<{ k: keyof UiPrefs['pill']; label: string; hint?: string }> = [
  { k: 'app', label: 'Приложение / созвон', hint: 'Имя активного приложения или созвона рядом со статусом' },
  { k: 'date', label: 'Дата' },
  { k: 'combo', label: 'Комбо клавиш' },
  { k: 'wave', label: 'Волна активности' },
  { k: 'chips', label: 'Плашки блоков и заметок', hint: 'Вторая строка' },
  { k: 'stats', label: 'Итоги по видам и задачам', hint: 'Третья строка' },
  { k: 'plan', label: 'Плашки из плана дня', hint: 'Запланированные блоки' },
]
const UI_DOCK: Array<{ k: keyof UiPrefs['dock']; label: string }> = [
  { k: 'orb', label: 'Шар (быстрая заметка)' },
  { k: 'time', label: 'Время за день' },
  { k: 'next', label: 'До встречи Outlook' },
  { k: 'wave', label: 'Волна активности' },
]
const UI_ISLAND: Array<{ k: keyof UiPrefs['island']; label: string }> = [
  { k: 'date', label: 'Дата' },
  { k: 'wave', label: 'Волна активности' },
  { k: 'totals', label: 'Итоги под шкалой' },
  { k: 'plan', label: 'Плашки из плана дня' },
]
const UI_MAIN: Array<{ k: keyof UiPrefs['main']; label: string; hint?: string }> = [
  { k: 'allStats', label: 'Все показатели дня сразу', hint: 'Иначе — основные' },
  { k: 'plan', label: 'Кнопка «План дня»' },
]
/** A preset applied: everything, or only what is needed day to day. */
async function uiPreset(p: UiPreset): Promise<void> {
  const next = uiPresetPrefs(p, ui)
  Object.assign(ui.pill, next.pill)
  if (next.dock) Object.assign(ui.dock, next.dock)
  Object.assign(ui.island, next.island)
  Object.assign(ui.main, next.main)
  await applyUi()
}
/** The pill's opacity is applied as soon as the slider is released — to see it right away. */
async function applyOpacity(): Promise<void> {
  await apply({ island: { opacity: f.pillOpacity / 100 } })
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Интерфейс</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Скрытое не теряется — только не показывается. Применяется сразу во всех окнах.</p>
      <div class="presets tw:flex tw:gap-8 tw:mb-14">
        <button class="tw:py-4 tw:px-12 tw:text-[12px] tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="uiPreset('minimal')">Минимальный</button>
        <button class="tw:py-4 tw:px-12 tw:text-[12px] tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="uiPreset('full')">Всё показывать</button>
      </div>
      <div class="uigroups tw:grid tw:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] tw:gap-12">
        <div class="uigroup tw:flex tw:flex-col tw:gap-2 tw:py-10 tw:px-12 tw:rounded-[4px] tw:bg-panel-2">
          <h4 class="tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Мини-остров</h4>
          <label v-for="o in UI_PILL" :key="o.k" class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex" :title="o.hint"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="ui.pill[o.k]" type="checkbox" @change="applyUi" /><span class="tw:-order-1">{{ o.label }}</span></label>
          <label class="opacity tw:flex tw:flex-col tw:gap-4 tw:mt-8 tw:text-[12px] tw:text-muted" title="Только фон свёрнутого мини-острова">
            Непрозрачность фона
            <span class="orow tw:flex tw:items-center tw:gap-10">
              <input class="tw:flex-1 tw:[accent-color:var(--accent)] tw:[.secret_&]:flex-1" v-model.number="f.pillOpacity" type="range" min="20" max="100" step="5" @change="applyOpacity" />
              <b class="tw:min-w-40 tw:tabular-nums tw:font-data">{{ f.pillOpacity }}%</b>
            </span>
          </label>
        </div>
        <div class="uigroup tw:flex tw:flex-col tw:gap-2 tw:py-10 tw:px-12 tw:rounded-[4px] tw:bg-panel-2">
          <h4 class="tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">У края экрана</h4>
          <label v-for="o in UI_DOCK" :key="o.k" class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="ui.dock[o.k]" type="checkbox" @change="applyUi" /><span class="tw:-order-1">{{ o.label }}</span></label>
        </div>
        <div class="uigroup tw:flex tw:flex-col tw:gap-2 tw:py-10 tw:px-12 tw:rounded-[4px] tw:bg-panel-2">
          <h4 class="tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Остров</h4>
          <label v-for="o in UI_ISLAND" :key="o.k" class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="ui.island[o.k]" type="checkbox" @change="applyUi" /><span class="tw:-order-1">{{ o.label }}</span></label>
        </div>
        <div class="uigroup tw:flex tw:flex-col tw:gap-2 tw:py-10 tw:px-12 tw:rounded-[4px] tw:bg-panel-2">
          <h4 class="tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Основное окно</h4>
          <label v-for="o in UI_MAIN" :key="o.k" class="switch tw:flex-row tw:items-center tw:justify-between tw:gap-10 tw:py-5 tw:px-0 tw:text-text tw:text-[13px] tw:cursor-pointer tw:flex" :title="o.hint"><input class="tw:appearance-none tw:flex-none tw:relative tw:w-32 tw:h-18 tw:m-0 tw:rounded-[4px] tw:bg-white/14 tw:cursor-pointer tw:[transition:background_0.2s] tw:checked:bg-accent tw:[.secret_&]:flex-1 tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-14 tw:after:h-14 tw:after:rounded-[50%] tw:after:bg-text-hi tw:after:[transition:transform_0.2s_cubic-bezier(0.32,0.72,0,1)] tw:checked:after:[transform:translateX(14px)]" v-model="ui.main[o.k]" type="checkbox" @change="applyUi" /><span class="tw:-order-1">{{ o.label }}</span></label>
        </div>
        <div class="uigroup tw:flex tw:flex-col tw:gap-2 tw:py-10 tw:px-12 tw:rounded-[4px] tw:bg-panel-2">
          <h4 class="tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Таймлайн</h4>
          <div class="tlgrid tw:grid tw:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] tw:gap-y-10 tw:gap-x-14">
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Сдвигать каждые
              <select v-model.number="ui.timeline.stepSec" @change="applyUi">
                <option v-for="s in [15, 30, 60, 120, 300]" :key="s" :value="s">{{ s < 60 ? `${s} сек` : `${s / 60} мин` }}</option>
              </select>
            </label>
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">«Сейчас» от левого края, px
              <input class="tw:[.secret_&]:flex-1" v-model.number="ui.timeline.leftPx" type="number" min="0" max="2000" step="10" @change="applyUi" />
            </label>
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Вернуться после ручного сдвига, сек
              <input class="tw:[.secret_&]:flex-1" v-model.number="ui.timeline.idleSec" type="number" min="1" max="600" @change="applyUi" />
            </label>
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Масштаб
              <select v-model="ui.timeline.zoom" @change="applyUi">
                <option value="keep">Как сейчас (мой)</option>
                <option value="fixed">Заданный</option>
              </select>
            </label>
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">Отсчёт «через …» на дашборде
              <select v-model="ui.timeline.countdown" @change="applyUi">
                <option value="any">До любого события</option>
                <option value="outlook">Только до встреч Outlook</option>
              </select>
            </label>
            <label class="tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted" v-if="ui.timeline.zoom === 'fixed'">Показывать
              <select v-model.number="ui.timeline.spanMin" @change="applyUi">
                <option v-for="m in [30, 60, 120, 240, 480, 720]" :key="m" :value="m">{{ m < 60 ? `${m} мин` : `${m / 60} ч` }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      <p class="muted small hint tw:mt-14 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-[12px]">Остров: Ctrl+Alt+Space — вызвать с клавиатуры; перемещается за иконку слева, позиция запоминается; булавка — не сворачивать; клик по шапке — сбросить выделение. Вернуть на место — меню «Ещё» или трей.</p>
    </section>
</template>
