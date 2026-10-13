<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { placeFloat, useAnchor } from '../lib/floating'

/** A filter button: a list of options with checkboxes (a search when it is long); the button shows how many are on. */
export interface FilterOption {
  id: string
  label: string
  color?: string
  hint?: string
}
const props = defineProps<{ label: string; icon: string; options: FilterOption[]; title?: string }>()
const model = defineModel<string[]>({ default: () => [] })

const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const dd = ref<HTMLElement>()
const btn = ref<HTMLElement>()
/** Teleported to <body> and fixed under the button: a widget's / card's overflow never clips it. */
const fstyle = ref<Record<string, string>>({})
useAnchor(open, btn, () => btn.value && (fstyle.value = placeFloat(btn.value, 260, true, 60).style))
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? props.options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(s)) : props.options
})
function toggle(id: string): void {
  model.value = model.value.includes(id) ? model.value.filter((x) => x !== id) : [...model.value, id]
}
async function flip(): Promise<void> {
  open.value = !open.value
  q.value = ''
  if (open.value && props.options.length > 8) {
    await nextTick()
    search.value?.focus()
  }
}
function onDown(e: MouseEvent): void {
  if (open.value && !root.value?.contains(e.target as Node) && !dd.value?.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="fm">
    <button ref="btn" class="fb" :class="{ on: model.length, open }" :title="title ?? label" @click="flip">
      <Icon :name="icon" :size="13" />
      <span class="fl">{{ label }}</span>
      <b v-if="model.length" class="cnt">{{ model.length }}</b>
      <Icon name="chevronDown" :size="12" class="cv" />
    </button>
    <Teleport to="body">
    <div v-if="open" ref="dd" class="fd" :style="fstyle">
      <input v-if="options.length > 8" ref="search" v-model="q" class="fs" placeholder="Поиск" />
      <div class="fo">
        <label v-for="o in shown" :key="o.id" class="opt">
          <input type="checkbox" :checked="model.includes(o.id)" @change="toggle(o.id)" />
          <i v-if="o.color" :style="{ background: o.color }"></i>
          <span class="ol">{{ o.label }}</span>
          <small v-if="o.hint">{{ o.hint }}</small>
        </label>
        <p v-if="!shown.length" class="none">Ничего</p>
      </div>
      <button v-if="model.length" class="clr" @click="model = []"><Icon name="x" :size="12" />Сбросить</button>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fm {
  position: relative;
}
.fb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: #c3c8d6;
  font-size: 12px;
  white-space: nowrap;
}
.fb:hover,
.fb.open {
  background: rgba(255, 255, 255, 0.05);
}
.fb.on {
  border-color: rgba(124, 108, 246, 0.6);
  background: rgba(124, 108, 246, 0.12);
  color: #fff;
}
.cnt {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #7c6cf6;
  color: #fff;
  font-size: 10.5px;
  text-align: center;
}
.cv {
  color: var(--muted);
}
.fd {
  position: fixed;
  z-index: 1000;
  width: 260px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c2030;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.fs {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 4px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: #141824;
  color: var(--text);
  font-size: 12px;
}
.fo {
  max-height: 300px;
  overflow: auto;
}
.opt {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
}
.opt:hover {
  background: rgba(139, 92, 246, 0.14);
}
.opt input {
  margin: 0;
  accent-color: #7c6cf6;
}
.opt i {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.ol {
  flex: none;
  white-space: nowrap;
}
.opt small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.none {
  margin: 6px;
  color: var(--muted);
  font-size: 12px;
}
.clr {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.clr:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
@media (max-width: 900px) {
  .fl {
    display: none;
  }
}
</style>
