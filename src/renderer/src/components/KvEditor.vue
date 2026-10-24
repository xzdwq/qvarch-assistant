<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type { HttpKV } from '@shared/http'
import Icon from './Icon.vue'

/**
 * Rows «key = value» with an on/off box; exactly one empty row, at the end (typing in it adds a row; a row emptied
 * goes once it is left — never under the cursor).
 * `secrets` — the variables' editor: a lock per row makes the value a secret (hidden, kept encrypted).
 */
const props = defineProps<{ rows: HttpKV[]; keyHint?: string; valueHint?: string; secrets?: boolean }>()
/** Secret values shown for a moment (the eye). */
const shown = reactive(new Set<number>())
const root = ref<HTMLElement>()
const isEmpty = (r: HttpKV) => !r.key && !r.value
/** The empty rows but the last one gone (not the one being typed in), one empty row at the end. */
function tidy(): void {
  const typing = root.value?.querySelector('.kr:focus-within')
  const rowEls = root.value ? [...root.value.querySelectorAll('.kr')] : []
  for (let i = props.rows.length - 2; i >= 0; i--) if (isEmpty(props.rows[i]) && rowEls[i] !== typing) props.rows.splice(i, 1)
  const last = props.rows[props.rows.length - 1]
  if (!last || !isEmpty(last)) props.rows.push({ on: true, key: '', value: '' })
}
watch(() => props.rows.map((r) => `${r.key}\u0000${r.value}`).join('\u0001'), tidy, { immediate: true })
/** A row left: emptied — it goes now. */
const onLeave = () => void nextTick(tidy)
function drop(i: number): void {
  props.rows.splice(i, 1)
}
</script>

<template>
  <div ref="root" class="kv tw:group/kv tw:flex tw:flex-col tw:border tw:border-border tw:rounded-r2 tw:overflow-hidden" :class="{ sec: secrets }" @focusout="onLeave">
    <div v-for="(r, i) in rows" :key="i" class="kr tw:group/kr tw:grid tw:grid-cols-[28px_minmax(0,1fr)_minmax(0,2fr)_28px] tw:items-center tw:border-b tw:border-b-border tw:group-[.sec]/kv:grid-cols-[28px_minmax(0,1fr)_minmax(0,2fr)_28px_28px] tw:last:border-b-0" :class="{ off: !r.on }">
      <input class="tw:justify-self-center tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border-0 tw:[&&]:[&:not([type='checkbox'])]:border-l tw:[&&]:[&:not([type='checkbox'])]:border-l-border tw:[&:not([type='checkbox'])]:rounded-none tw:[&:not([type='checkbox'])]:bg-transparent tw:[&:not([type='checkbox'])]:font-data tw:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:focus:bg-field tw:[&:not([type='checkbox'])]:focus:[box-shadow:var(--shadow-ring-accent)] tw:group-[.off]/kr:[&:not([type='checkbox'])]:opacity-45" v-model="r.on" type="checkbox" title="Отправлять" :disabled="!r.key && !r.value" />
      <input v-model="r.key" class="k tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border-0 tw:[&&]:[&:not([type='checkbox'])]:border-l tw:[&&]:[&:not([type='checkbox'])]:border-l-border tw:[&:not([type='checkbox'])]:rounded-none tw:[&:not([type='checkbox'])]:bg-transparent tw:[&:not([type='checkbox'])]:font-data tw:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:focus:bg-field tw:[&:not([type='checkbox'])]:focus:[box-shadow:var(--shadow-ring-accent)] tw:group-[.off]/kr:[&:not([type='checkbox'])]:opacity-45" :placeholder="keyHint ?? 'ключ'" spellcheck="false" />
      <span v-if="secrets" class="vw tw:relative tw:flex tw:min-w-0">
        <input v-model="r.value" class="v tw:flex-1 tw:min-w-0 tw:[&[type='checkbox']]:[justify-self:center] tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border-0 tw:[&&]:[&:not([type='checkbox'])]:border-l tw:[&&]:[&:not([type='checkbox'])]:border-l-border tw:[&:not([type='checkbox'])]:rounded-none tw:[&:not([type='checkbox'])]:bg-transparent tw:[&:not([type='checkbox'])]:font-data tw:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:focus:bg-field tw:[&:not([type='checkbox'])]:focus:[box-shadow:var(--shadow-ring-accent)] tw:group-[.off]/kr:[&:not([type='checkbox'])]:opacity-45" :type="r.secret && !shown.has(i) ? 'password' : 'text'" :placeholder="valueHint ?? 'значение · {{переменная}}'" spellcheck="false" autocomplete="off" />
        <button v-if="r.secret && r.value" class="eye tw:absolute tw:right-4 tw:top-[50%] tw:[transform:translateY(-50%)] tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="shown.has(i) ? 'Скрыть' : 'Показать'" @click="shown.has(i) ? shown.delete(i) : shown.add(i)"><Icon :name="shown.has(i) ? 'eyeOff' : 'eye'" :size="12" /></button>
      </span>
      <input v-else v-model="r.value" class="v tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border-0 tw:[&&]:[&:not([type='checkbox'])]:border-l tw:[&&]:[&:not([type='checkbox'])]:border-l-border tw:[&:not([type='checkbox'])]:rounded-none tw:[&:not([type='checkbox'])]:bg-transparent tw:[&:not([type='checkbox'])]:font-data tw:[&:not([type='checkbox'])]:text-[12.5px] tw:[&:not([type='checkbox'])]:focus:bg-field tw:[&:not([type='checkbox'])]:focus:[box-shadow:var(--shadow-ring-accent)] tw:group-[.off]/kr:[&:not([type='checkbox'])]:opacity-45" :placeholder="valueHint ?? 'значение · {{переменная}}'" spellcheck="false" />
      <button v-if="secrets" class="lock tw:inline-flex tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-dim tw:[&.on]:text-warn tw:disabled:opacity-30 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :class="{ on: r.secret }" :title="r.secret ? 'Секрет: скрыт и хранится зашифрованным. Клик — сделать обычной' : 'Сделать секретом (скрыть, хранить зашифрованным)'" :disabled="!r.key" @click="r.secret = !r.secret || undefined"><Icon name="lock" :size="12" /></button>
      <button v-if="r.key || r.value" class="x tw:inline-flex tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Удалить" @click="drop(i)"><Icon name="x" :size="12" /></button>
      <span v-else class="x tw:inline-flex tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg"></span>
    </div>
  </div>
</template>
