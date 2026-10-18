<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CALLOUTS, calloutMd, parseCallout, type CalloutModel } from '@shared/noteBlocks'
import Icon from '../Icon.vue'

/** A callout: a coloured box (заметка, информация, совет, готово, внимание, опасно) with a title and text. */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string]; exit: [dir: 1 | -1] }>()
const c = ref<CalloutModel>(parseCallout(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    c.value = parseCallout(s)
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(timer)
  const go = () => {
    const md = calloutMd(c.value)
    if (md === mine) return
    mine = md
    emit('change', md)
  }
  if (now) go()
  else timer = setTimeout(go, 250)
}
const def = computed(() => CALLOUTS.find((x) => x.id === c.value.type) ?? CALLOUTS[0])
const open = ref(false)
const bodyEl = ref<HTMLTextAreaElement>()
const titleEl = ref<HTMLInputElement>()
onMounted(() => props.autofocus && titleEl.value?.focus())
function onTitleKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault()
    bodyEl.value?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    emit('exit', -1)
  }
}
function onBodyKey(e: KeyboardEvent): void {
  const el = e.target as HTMLTextAreaElement
  if (e.key === 'ArrowDown' && !el.value.slice(el.selectionEnd).includes('\n')) {
    e.preventDefault()
    emit('exit', 1)
  } else if (e.key === 'ArrowUp' && !el.value.slice(0, el.selectionStart).includes('\n')) {
    e.preventDefault()
    titleEl.value?.focus()
  } else if (e.key === 'Escape') emit('exit', 1)
}
</script>

<template>
  <div class="co" :style="{ '--c': def.color }">
    <div class="co-h">
      <button class="co-ic" :title="`${def.title} — сменить вид`" @mousedown.prevent @click="open = !open"><Icon :name="def.icon" :size="15" /></button>
      <input ref="titleEl" v-model="c.title" class="co-t" :placeholder="def.title" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onTitleKey" />
    </div>
    <div v-if="open" class="co-pick">
      <button v-for="x in CALLOUTS" :key="x.id" :class="{ on: x.id === c.type }" :style="{ '--c': x.color }" @mousedown.prevent @click="((c.type = x.id), (open = false), save(true))"><Icon :name="x.icon" :size="13" />{{ x.title }}</button>
    </div>
    <textarea ref="bodyEl" v-model="c.body" class="co-b" rows="1" placeholder="Текст" spellcheck="false" @input="save()" @blur="save(true)" @keydown="onBodyKey"></textarea>
  </div>
</template>

<style scoped>
.co {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px 10px;
  border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
  border-left: 4px solid var(--c);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c) 8%, transparent);
}
.co-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.co-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--c) 18%, transparent);
  color: var(--c);
}
.co-t {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--c);
  font: inherit;
  font-weight: 600;
  outline: none;
}
.co-t::placeholder {
  color: color-mix(in srgb, var(--c) 70%, transparent);
}
.co-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0 6px 34px;
}
.co-pick button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--c);
  font-size: 12px;
}
.co-pick button.on {
  background: color-mix(in srgb, var(--c) 18%, transparent);
}
.co-b {
  min-height: 0;
  padding: 2px 2px 2px 34px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  line-height: 1.6;
  resize: none;
  field-sizing: content;
  outline: none;
}
</style>
