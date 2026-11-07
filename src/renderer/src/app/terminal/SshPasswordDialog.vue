<script setup lang="ts">
/** A session's password asked for (none kept, or the kept one did not fit): typed, kept or not. */
import { ref, watch } from 'vue'
import { passwordAsk } from '../../lib/ssh'

const password = ref('')
const save = ref(true)
const input = ref<HTMLInputElement>()
watch(passwordAsk, (a) => {
  if (!a) return
  password.value = ''
  save.value = true
  setTimeout(() => input.value?.focus())
})
function answer(ok: boolean): void {
  passwordAsk.value?.answer(ok ? { password: password.value, save: save.value } : undefined)
}
</script>

<template>
  <div v-if="passwordAsk" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[14vh] tw:bg-black/55" @mousedown.self="answer(false)">
    <form class="tq tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(420px,calc(100vw-32px))]" @submit.prevent="answer(true)" @keydown.esc="answer(false)">
      <div class="cap tw:truncate">Пароль · {{ passwordAsk.session.user }}@{{ passwordAsk.session.host }}</div>
      <p class="tw:m-0 tw:text-warn-fg tw:text-[12px]">{{ passwordAsk.reason }}</p>
      <label class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Пароль<input ref="input" v-model="password" type="password" autocomplete="off" spellcheck="false" /></label>
      <label class="tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="save" type="checkbox" />Сохранить (зашифрован Windows для вашей учётной записи)</label>
      <div class="tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!password">Подключиться</button><button type="button" @click="answer(false)">Отмена</button></div>
    </form>
  </div>
</template>
