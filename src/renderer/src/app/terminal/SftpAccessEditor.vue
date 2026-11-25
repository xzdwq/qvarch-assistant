<script setup lang="ts">
/**
 * An entry's rights, owner and group changed from «Свойства»: the rights as a grid (and in octal, kept in step), the
 * owner and group by name; a folder — everything inside too. Applied as oneself or as root (sudo).
 */
import { computed, ref, watch } from 'vue'
import { ACCESS_WHAT, ACCESS_WHO, accessDiff, flipBit, hasBit, modeOf, octalText } from '@shared/ssh/remoteAccess'
import type { RemoteProps } from '@shared/ssh/remoteProps'
import { remoteError } from '@shared/remoteError'
import { withSudo } from '../../lib/ssh'
import MenuButton, { type MenuItem } from '../../components/MenuButton.vue'

const props = defineProps<{ sessionId: string; info: RemoteProps }>()
const emit = defineEmits<{ changed: [] }>()

/** What the entry has now, as the fields show it (a name where the server told it, else the number). */
const now = computed(() => ({ octal: props.info.octal, owner: props.info.owner ?? String(props.info.uid), group: props.info.group ?? String(props.info.gid) }))
const octal = ref('')
const owner = ref('')
const group = ref('')
const recursive = ref(false)
const busy = ref(false)
const error = ref('')
const done = ref('')
watch(
  now,
  (n) => {
    octal.value = n.octal
    owner.value = n.owner
    group.value = n.group
    recursive.value = false
  },
  { immediate: true },
)
const isDir = computed(() => props.info.kind === 'dir')
const mode = computed(() => modeOf(octal.value))
function flip(shift: number, bit: number): void {
  octal.value = octalText(flipBit(mode.value ?? 0, shift, bit))
}
/** Owner and group offered in one click: the folder's, one's own (as the server names them — domain names too). */
const presets = computed(() => {
  const i = props.info
  const list: Array<{ label: string; owner: string; group: string }> = []
  if (i.parentOwner && i.parentGroup) list.push({ label: `как у папки · ${i.parentOwner}`, owner: i.parentOwner, group: i.parentGroup })
  if (i.me && i.myGroup && (i.me !== i.parentOwner || i.myGroup !== i.parentGroup)) list.push({ label: `мои · ${i.me}`, owner: i.me, group: i.myGroup })
  return list
})
function take(p: { owner: string; group: string }): void {
  owner.value = p.owner
  group.value = p.group
}
const change = computed(() => accessDiff(now.value, { octal: octal.value, owner: owner.value, group: group.value }, isDir.value && recursive.value))
const ready = computed(() => mode.value !== undefined && !!(change.value.mode || change.value.owner || change.value.group))

async function apply(sudo: boolean): Promise<void> {
  busy.value = true
  error.value = ''
  done.value = ''
  const c = change.value
  const path = props.info.path
  try {
    const call = () => window.qa.ssh('setAccess', props.sessionId, path, c, sudo)
    const r = sudo ? await withSudo(props.sessionId, `Изменить права и владельца ${path}`, () => call().then(() => true)) : await call().then(() => true)
    if (!r) return
    done.value = sudo ? 'Изменено (sudo)' : 'Изменено'
    emit('changed')
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
  }
}
const items = computed<MenuItem[]>(() => [
  { label: 'От своего имени', icon: 'check', title: 'Права меняет владелец файла; сменить владельца так обычно нельзя', run: () => apply(false) },
  { label: 'Через sudo (root)', icon: 'lock', title: 'От имени root: спросит пароль sudo', run: () => apply(true) },
])
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-8 tw:pt-10 tw:border-t tw:border-border">
    <div class="tw:grid tw:grid-cols-[max-content_repeat(3,max-content)] tw:items-center tw:gap-x-14 tw:gap-y-4">
      <span></span>
      <span v-for="w in ACCESS_WHAT" :key="w.key" class="tw:text-muted tw:text-[11.5px]">{{ w.label }}</span>
      <template v-for="who in ACCESS_WHO" :key="who.key">
        <span class="tw:text-text-2">{{ who.label }}</span>
        <label v-for="w in ACCESS_WHAT" :key="w.key" class="tw:flex tw:justify-center"><input type="checkbox" :checked="mode !== undefined && hasBit(mode, who.shift, w.bit)" :disabled="busy" @change="flip(who.shift, w.bit)" /></label>
      </template>
    </div>
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-8">
      <label class="tw:flex tw:items-center tw:gap-6 tw:text-muted">Права<input v-model="octal" class="tw:w-64 tw:font-data" :class="{ 'tw:border-down': mode === undefined }" spellcheck="false" title="Восьмеричные цифры: 0644, 0755, 4755" /></label>
      <label class="tw:flex tw:flex-1 tw:items-center tw:gap-6 tw:min-w-[180px] tw:text-muted">Владелец<input v-model="owner" class="tw:flex-1 tw:w-0 tw:min-w-0" spellcheck="false" :title="owner" /></label>
      <label class="tw:flex tw:flex-1 tw:items-center tw:gap-6 tw:min-w-[180px] tw:text-muted">Группа<input v-model="group" class="tw:flex-1 tw:w-0 tw:min-w-0" spellcheck="false" :title="group" /></label>
    </div>
    <div v-if="presets.length" class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:whitespace-nowrap">
      <span class="tw:flex-none tw:text-muted tw:text-[11.5px]">Подставить:</span>
      <button v-for="p in presets" :key="p.label" class="tw:min-w-0 tw:h-22 tw:py-0 tw:px-8 tw:rounded-full tw:text-[11.5px] tw:truncate" :disabled="busy" :title="`${p.owner} : ${p.group}`" @click="take(p)">{{ p.label }}</button>
    </div>
    <label v-if="isDir" class="tw:flex tw:items-center tw:gap-8 tw:text-text-2" title="chown / chmod -R: владелец и группа — всем внутри, права — только если изменены"><input v-model="recursive" type="checkbox" :disabled="busy" />И всё внутри папки</label>
    <div class="tw:flex tw:items-center tw:gap-8 tw:min-w-0">
      <MenuButton label="Применить" :items="items" :disabled="busy || !ready" :width="200" />
      <span v-if="error" class="tw:min-w-0 tw:text-down-fg tw:wrap-anywhere">{{ error }}</span>
      <span v-else-if="done" class="tw:text-up-fg">{{ done }}</span>
    </div>
  </div>
</template>
