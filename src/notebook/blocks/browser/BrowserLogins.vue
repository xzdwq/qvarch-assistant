<script setup lang="ts">
/**
 * The saved logins of a note's browser tab's site (kept by the Браузер section — the same profile): asked when the
 * key is pressed, one picked — typed into the page's sign-in form. A page with a password field gets its site's latest
 * login typed in by itself; this is for another login, or a form that showed up late.
 */
import { ref } from 'vue'
import type { PasswordInfo } from '@shared/browser'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'

/** `tab` — the webview's id (none — the page not ready yet); `url` — its page now. */
const props = defineProps<{ tab?: number; url: string }>()

const open = ref(false)
const btn = ref<HTMLElement>()
const logins = ref<PasswordInfo[]>([])
const error = ref('')
const host = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}
async function toggle(): Promise<void> {
  if (open.value) return void (open.value = false)
  error.value = ''
  logins.value = []
  open.value = true
  if (props.tab === undefined) return
  try {
    logins.value = await window.qa.nbPwLogins(props.tab)
  } catch (e) {
    error.value = remoteError(e)
  }
}
async function fill(l: PasswordInfo): Promise<void> {
  open.value = false
  if (props.tab !== undefined) await window.qa.nbPwFill(props.tab, l.id).catch(() => undefined)
}
</script>

<template>
  <button ref="btn" class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:min-w-28 tw:h-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:disabled:opacity-35 tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :class="{ on: open }" :disabled="!/^https?:/.test(url)" title="Сохранённые пароли этого сайта — подставить в форму входа" @mousedown.prevent @click="toggle"><Icon name="lock" :size="13" /></button>
  <Popover v-model:open="open" :anchor="btn" :width="280" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
    <p class="tw:m-0 tw:pt-2 tw:px-8 tw:pb-4 tw:text-muted tw:text-[11.5px] tw:truncate">Пароли для {{ host(url) }}</p>
    <button v-for="l in logins" :key="l.id" class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-left tw:whitespace-nowrap tw:hover:bg-hover" :title="`Подставить вход «${l.username || 'без имени'}» в форму страницы`" @click="fill(l)">
      <Icon name="lock" :size="12" class="tw:flex-none tw:text-muted" /><span class="tw:min-w-0 tw:truncate">{{ l.username || '(без имени)' }}</span>
    </button>
    <p v-if="error" class="tw:m-0 tw:py-4 tw:px-8 tw:text-down-fg tw:text-[11.5px]">{{ error }}</p>
    <p v-else-if="!logins.length" class="tw:m-0 tw:py-4 tw:px-8 tw:text-muted tw:text-[11.5px] tw:whitespace-normal">Сохранённых паролей для этого сайта нет. Их сохраняет раздел «Браузер», когда вы входите на сайт там.</p>
  </Popover>
</template>
