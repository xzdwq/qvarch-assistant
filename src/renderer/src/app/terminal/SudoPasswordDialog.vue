<script setup lang="ts">
/** sudo's password asked for (an action as root on a server): typed, or the session's kept SSH password used. Kept in memory only. */
import { computed, ref, watch } from 'vue'
import { sudoAsk } from '../../lib/ssh'

const password = ref('')
const useSsh = ref(false)
const input = ref<HTMLInputElement>()
const hasSsh = computed(() => !!sudoAsk.value?.session?.hasPassword)
/** The first ask: just «needs a password»; after a miss — the server's reason. */
const missed = computed(() => !!sudoAsk.value?.reason.includes('не подошёл'))
watch(sudoAsk, (a) => {
  if (!a) return
  password.value = ''
  // the SSH password offered first only once (it did not fit — typed then)
  useSsh.value = hasSsh.value && !missed.value
  setTimeout(() => input.value?.focus())
})
const ready = computed(() => useSsh.value || !!password.value)
function answer(ok: boolean): void {
  sudoAsk.value?.answer(ok && ready.value ? { password: useSsh.value ? '' : password.value, useSsh: useSsh.value } : undefined)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="sudoAsk" class="tq-back tw:fixed tw:inset-0 tw:z-1600 tw:flex tw:justify-center tw:items-start tw:pt-[14vh] tw:bg-black/55" @mousedown.self="answer(false)">
      <form class="tq tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(440px,calc(100vw-32px))]" @submit.prevent="answer(true)" @keydown.esc.stop="answer(false)">
        <div class="cap tw:truncate">sudo<template v-if="sudoAsk.session"> · {{ sudoAsk.session.user }}@{{ sudoAsk.session.host }}</template></div>
        <p class="tw:m-0 tw:text-text-2 tw:text-[12px] tw:wrap-anywhere">{{ sudoAsk.what }} — от имени root.</p>
        <p v-if="missed" class="tw:m-0 tw:text-warn-fg tw:text-[12px]">Пароль не подошёл. Несколько неверных попыток подряд могут заблокировать учётную запись.</p>
        <label v-if="hasSsh" class="tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="useSsh" type="checkbox" />Тот же, что сохранённый пароль SSH</label>
        <label v-if="!useSsh" class="tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Пароль sudo<input ref="input" v-model="password" type="password" autocomplete="off" spellcheck="false" /></label>
        <p class="tw:m-0 tw:text-muted tw:text-[11.5px]">Хранится только в памяти до закрытия приложения или обрыва связи.</p>
        <div class="tw:flex tw:gap-8"><button type="submit" class="primary" :disabled="!ready">Выполнить</button><button type="button" @click="answer(false)">Отмена</button></div>
      </form>
    </div>
  </Teleport>
</template>
