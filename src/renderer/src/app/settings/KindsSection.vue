<script setup lang="ts">
/** Settings · the kinds of activity: name, colour, icon, productive / hidden; reordered by dragging (kept at once). */
import { computed, ref } from 'vue'
import Icon, { KIND_ICONS } from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { cssHex } from '../../lib/cssColor'
import { startListDrag } from '../../lib/listDrag'
// (a default kind's colour is a theme variable — the colour field shows its value)
import { kindColorHex } from '../../lib/palette'
import { useSettingsContext } from './settingsContext'

const { f, save } = useSettingsContext()

// ---------- kinds: the same dragging ----------
const klist = ref<HTMLElement>()
const kDrag = ref<string>()
function startKindDrag(e: PointerEvent, id: string): void {
  if (!klist.value) return
  kDrag.value = id
  startListDrag(e, {
    list: klist.value,
    index: f.kinds.findIndex((k) => k.id === id),
    move: (from, to) => {
      const list = [...f.kinds]
      const [x] = list.splice(from, 1)
      list.splice(to, 0, x)
      f.kinds = list
    },
    // the new order is kept at once (like the menu)
    done: () => {
      kDrag.value = undefined
      void save()
    },
  })
}

/** The colours a new kind takes in turn (CSS variables, in integrations.css); kept in the kind as concrete ones. */
const NEW_KIND_COLOR_VARS = Array.from({ length: 10 }, (_, i) => `--new-kind-${i + 1}` as const)

/** The icon picker: one popover, opened from the icon button of a kind's row. */
const iconPicker = ref<string>()
const iconButton = ref<HTMLElement>()
const pickerOpen = computed({
  get: () => !!iconPicker.value,
  set: (on) => !on && (iconPicker.value = undefined),
})
const pickedKind = computed(() => f.kinds.find((k) => k.id === iconPicker.value))
function toggleIconPicker(e: MouseEvent, id: string): void {
  iconButton.value = e.currentTarget as HTMLElement
  iconPicker.value = iconPicker.value === id ? undefined : id
}
function pickIcon(icon: string): void {
  if (pickedKind.value) pickedKind.value.icon = icon
  iconPicker.value = undefined
}

function addKind(): void {
  const id = `k${Date.now().toString(36)}`
  const color = cssHex(NEW_KIND_COLOR_VARS[f.kinds.length % NEW_KIND_COLOR_VARS.length]) ?? ''
  f.kinds.push({ id, label: '', color, icon: 'tag', productive: true })
}

function removeKind(id: string): void {
  if (f.kinds.length <= 1) return
  f.kinds = f.kinds.filter((k) => k.id !== id)
}
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Виды занятости</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Показываются кнопками в island и в меню по правому клику на шкале. Пустая подпись при нарезке заменяется названием вида.</p>
      <div ref="klist" class="kinds tw:flex tw:flex-col tw:gap-6">
        <div v-for="k in f.kinds" :key="k.id" class="krow tw:flex tw:items-center tw:flex-wrap tw:gap-y-6 tw:gap-x-8 tw:py-4 tw:px-0 tw:[&.drag]:[outline:1px_solid_var(--accent)] tw:[&.drag]:rounded-r2 tw:[&.drag]:bg-panel-2" :class="{ drag: kDrag === k.id }">
          <span class="mgrip tw:inline-flex tw:py-6 tw:px-4 tw:text-dim tw:cursor-grab tw:touch-none" title="Перетащить" @pointerdown="startKindDrag($event, k.id)"><Icon name="grip" :size="14" /></span>
          <span class="kpreview tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-[4px] tw:text-text-hi tw:flex-none" :style="{ background: k.color }"><Icon :name="k.icon" :size="14" :stroke="2.2" /></span>
          <input v-model="k.label" class="klabel tw:[.secret_&]:flex-1 tw:flex-[1_1_180px] tw:min-w-0" placeholder="Название, например «Ревью кода»" />
          <input :value="kindColorHex(k.color)" type="color" class="kcolor tw:[.secret_&]:flex-1 tw:w-36 tw:h-30 tw:p-2" title="Цвет" @input="k.color = ($event.target as HTMLInputElement).value" />
          <div class="iconpick tw:relative">
            <button class="mini tw:[.order_&]:py-0 tw:[.order_&]:px-4 tw:[.order_&]:leading-[1] tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7 tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" :class="{ on: iconPicker === k.id }" title="Иконка" @click="toggleIconPicker($event, k.id)"><Icon :name="k.icon" :size="14" /></button>
          </div>
          <label class="check small-check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[12px]!" title="Учитывается как рабочее время"><input class="tw:[.secret_&]:flex-1" v-model="k.productive" type="checkbox" /> продуктивное</label>
          <label class="check small-check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[12px]!" title="Не показывать в кнопках и меню"><input class="tw:[.secret_&]:flex-1" v-model="k.hidden" type="checkbox" /> скрыт</label>
          <button class="mini danger tw:[.order_&]:py-0 tw:[.order_&]:px-4 tw:[.order_&]:leading-[1] tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7 tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" title="Удалить вид" :disabled="f.kinds.length <= 1" @click="removeKind(k.id)"><Icon name="trash" :size="13" /></button>
        </div>
      </div>
      <Popover v-model:open="pickerOpen" :anchor="iconButton" :width="226" align-left class="icongrid tw:grid tw:grid-cols-[repeat(6,32px)] tw:gap-4 tw:p-6 tw:bg-panel-2 tw:border tw:border-border tw:rounded-[4px] tw:[box-shadow:0_12px_30px_rgba(0,0,0,0.5)]">
        <button v-for="ic in KIND_ICONS" :key="ic" class="mini tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7 tw:[&.on]:bg-accent" :class="{ on: ic === pickedKind?.icon }" @click="pickIcon(ic)">
          <Icon :name="ic" :size="15" />
        </button>
      </Popover>
      <button class="add tw:inline-flex tw:items-center tw:gap-6 tw:mt-10 tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2" @click="addKind"><Icon name="plus" :size="14" />Добавить вид</button>
    </section>
</template>
