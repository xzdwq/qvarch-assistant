<script setup lang="ts">
/**
 * Settings · the events' attributes: each a list of values («Проект»: Альфа, Бета…), its letters (up to three) and
 * colour, on / off (off — not offered for new events, the old ones keep it). Deleting an attribute or a value takes
 * it off every event (asked first). Applies at once.
 */
import { ref, watch } from 'vue'
import { ATTR_SHORT_MAX, autoShort, cleanShort, type AttrDef } from '@shared/tracker/attributes'
import Icon from '../../components/Icon.vue'
import { attrDefs } from '../../lib/attributes'
import { cssHex } from '../../lib/cssColor'
import { useSettingsContext } from './settingsContext'

const { apply } = useSettingsContext()
/** The list being edited (a copy: saved on every change). */
const list = ref<AttrDef[]>(clone(attrDefs.value))
watch(attrDefs, (v) => (list.value = clone(v)))
function clone(v: AttrDef[]): AttrDef[] {
  return JSON.parse(JSON.stringify(v)) as AttrDef[]
}
const commit = () => void apply({ attributes: clone(list.value.filter((a) => a.name.trim())) })
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
/** The colours new attributes take in turn (the kinds' palette, in theme CSS). */
const NEW_COLOR_VARS = Array.from({ length: 10 }, (_, i) => `--new-kind-${i + 1}` as const)

function addAttr(): void {
  list.value.push({ id: newId('a'), name: '', short: '', color: cssHex(NEW_COLOR_VARS[list.value.length % NEW_COLOR_VARS.length]) ?? '#888888', active: true, options: [] })
}
function setName(a: AttrDef, name: string): void {
  // the letters follow the name while they are the name's own
  if (!a.short || a.short === autoShort(a.name)) a.short = autoShort(name)
  a.name = name
  commit()
}
function setShort(a: AttrDef, short: string): void {
  a.short = cleanShort(short, a.name)
  commit()
}
function removeAttr(a: AttrDef): void {
  if (a.name.trim() && !confirm(`Удалить атрибут «${a.name}»? Его значения уберутся у всех событий.`)) return
  list.value = list.value.filter((x) => x.id !== a.id)
  commit()
}
/** A value typed into an attribute's «+» field. */
const drafts = ref<Record<string, string>>({})
function addOption(a: AttrDef): void {
  const label = (drafts.value[a.id] ?? '').trim()
  if (!label || a.options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return
  a.options.push({ id: newId('o'), label })
  drafts.value[a.id] = ''
  commit()
}
function removeOption(a: AttrDef, id: string): void {
  const o = a.options.find((x) => x.id === id)
  if (!o || !confirm(`Убрать «${o.label}» из «${a.name}»? Это значение уберётся у всех событий.`)) return
  a.options = a.options.filter((x) => x.id !== id)
  commit()
}
</script>

<template>
  <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
    <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Атрибуты событий</h3>
    <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Свои списки для событий — например «Проект»: Альфа, Бета. Значение ставится в карточке события и учитывается в аналитике (фильтры, разбивка, графики). Выключенный атрибут не предлагается новым событиям, у старых остаётся.</p>
    <div class="tw:flex tw:flex-col tw:gap-10">
      <div v-for="a in list" :key="a.id" class="tw:flex tw:flex-col tw:gap-8 tw:p-10 tw:border tw:border-border tw:rounded-r2 tw:[&.off]:opacity-60" :class="{ off: !a.active }">
        <div class="tw:flex tw:items-center tw:flex-wrap tw:gap-8">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:min-w-34 tw:h-24 tw:px-5 tw:rounded-r2 tw:text-text-hi tw:font-data tw:text-[11px] tw:font-bold" :style="{ background: a.color }">{{ a.short || autoShort(a.name) }}</span>
          <input class="tw:flex-[1_1_160px] tw:min-w-0" :value="a.name" placeholder="Название, например «Проект»" @change="setName(a, ($event.target as HTMLInputElement).value)" />
          <input class="tw:w-56 tw:font-data tw:uppercase" :value="a.short" :maxlength="ATTR_SHORT_MAX" title="Буквы на событии (до трёх)" placeholder="ABC" @change="setShort(a, ($event.target as HTMLInputElement).value)" />
          <input type="color" class="tw:w-36 tw:h-30 tw:p-2" :value="a.color" title="Цвет" @change="((a.color = ($event.target as HTMLInputElement).value), commit())" />
          <label class="tw:inline-flex tw:items-center tw:gap-6 tw:text-[12px]" title="Предлагать новым событиям"><input v-model="a.active" type="checkbox" @change="commit" />активен</label>
          <button class="mini danger tw:inline-flex tw:items-center tw:justify-center tw:py-5 tw:px-7" title="Удалить атрибут (его значения уберутся у всех событий)" @click="removeAttr(a)"><Icon name="trash" :size="13" /></button>
        </div>
        <div class="tw:flex tw:items-center tw:flex-wrap tw:gap-6">
          <span v-for="o in a.options" :key="o.id" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-24 tw:pl-8 tw:pr-2 tw:rounded-r2 tw:bg-panel-2 tw:text-[12px]">
            {{ o.label }}<button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg" title="Убрать значение" @click="removeOption(a, o.id)"><Icon name="x" :size="10" /></button>
          </span>
          <input v-model="drafts[a.id]" class="tw:w-150 tw:h-24 tw:text-[12px]" placeholder="+ значение, Enter" @keydown.enter.prevent="addOption(a)" />
        </div>
      </div>
    </div>
    <button class="add tw:inline-flex tw:items-center tw:gap-6 tw:mt-10" @click="addAttr"><Icon name="plus" :size="14" />Добавить атрибут</button>
  </section>
</template>
