<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * When a chain stops — one control: «error» (no answer, a script failed), whole classes of statuses (4xx, 5xx…)
 * and codes of one's own (401, 409, 400-404). The value is that list as text: "error, 4xx, 401".
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
const CLASSES = ['3xx', '4xx', '5xx']
const parts = computed(() => props.modelValue.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))
const own = computed(() => parts.value.filter((p) => p !== 'error' && !CLASSES.includes(p)).join(', '))
function set(next: { error?: boolean; classes?: string[]; own?: string }): void {
  const error = next.error ?? parts.value.includes('error')
  const classes = next.classes ?? CLASSES.filter((c) => parts.value.includes(c))
  const codes = (next.own ?? own.value).split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^\d{3}(-\d{3})?$/.test(x))
  emit('update:modelValue', [...(error ? ['error'] : []), ...classes, ...codes].join(', '))
}
function toggleClass(c: string): void {
  const now = CLASSES.filter((x) => parts.value.includes(x))
  set({ classes: now.includes(c) ? now.filter((x) => x !== c) : [...now, c] })
}
const label = computed(() => {
  if (!parts.value.length) return 'никогда'
  return parts.value.map((p) => (p === 'error' ? 'ошибка' : p)).join(', ')
})
const open = ref(false)
const root = ref<HTMLElement>()
const ownText = ref(own.value)
/** The popover: over everything (teleported), kept by its button. */
const style = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
useAnchor(open, root, () => {
  if (!root.value) return
  const f = placeFloat(root.value, 300, true, 0)
  style.value = { ...f.style, maxHeight: `${f.maxH}px` }
})
const onDown = (e: PointerEvent) => open.value && !root.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.sop-pop') && (open.value = false)
onMounted(() => document.addEventListener('pointerdown', onDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDown, true))
</script>

<template>
  <span ref="root" class="sop">
    <button class="sb" :class="{ on: open }" title="Когда останавливать цепочку" @click="(open = !open), (ownText = own)">
      Остановить на: <b>{{ label }}</b><Icon name="chevronDown" :size="11" />
    </button>
    <Teleport to="body">
    <div v-if="open" class="sop-pop" :style="style">
      <label class="row"><input type="checkbox" :checked="parts.includes('error')" @change="set({ error: ($event.target as HTMLInputElement).checked })" />Ошибке — нет ответа, ошибка скрипта</label>
      <div class="cls">
        <span>Ответах</span>
        <button v-for="c in CLASSES" :key="c" :class="{ on: parts.includes(c) }" @click="toggleClass(c)">{{ c }}</button>
      </div>
      <label class="own">
        Своих кодах
        <input v-model="ownText" placeholder="401, 409, 400-404" spellcheck="false" @change="set({ own: ownText })" @keydown.enter="set({ own: ownText })" />
      </label>
      <button class="never" @click="(emit('update:modelValue', ''), (ownText = ''))">Не останавливать никогда</button>
    </div>
    </Teleport>
  </span>
</template>

<style scoped>
.sop {
  position: relative;
  display: inline-flex;
}
.sb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  font-size: 12.5px;
}
.sb b {
  color: var(--text-hi);
  font-weight: 600;
}
.sb.on {
  border-color: var(--accent);
}
/* teleported to <body> (placed by placeFloat) */
.sop-pop {
  display: flex;
  overflow-y: auto;
  flex-direction: column;
  gap: 10px;
  width: 300px;
  padding: 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-size: 12.5px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cls span {
  margin-right: 4px;
  color: var(--text-2);
}
.cls button {
  padding: 3px 10px;
  font-family: var(--font-data);
  font-size: 12px;
}
.cls button.on {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.own {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-2);
}
.own input {
  font-family: var(--font-data);
  font-size: 12.5px;
}
.never {
  align-self: flex-start;
  padding: 3px 10px;
  font-size: 12px;
}
</style>
