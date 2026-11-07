<script setup lang="ts">
/**
 * «Разрешить запуск скрипта?»: a notebook shell block's script not approved yet (changed by someone else — the AI, a
 * shared folder) or one that asks before every run. The script in full, where it runs, why it is asked; approve for
 * good, once, or refuse (Esc). Several waiting — one after another.
 */
import { computed } from 'vue'
import { answerApproval, pendingApprovals } from '../lib/shellApprovals'
import { useSshSessions } from '../lib/ssh'

const sessions = useSshSessions()
const cur = computed(() => pendingApprovals.value[0]?.ask)
const where = computed(() => {
  const id = cur.value?.ssh
  if (!id) return 'на этом ПК'
  const s = sessions.value.find((x) => x.id === id)
  return s ? `на сервере ${s.user}@${s.host} (${s.name})` : 'на сервере удалённой сессии SSH'
})
/** Why it is asked, in words. */
const WHY = { new: 'Скрипт изменён не вами (ИИ, общая папка или синхронизация) или ещё не одобрен.', always: 'Блок просит спрашивать перед каждым запуском.' } as const
</script>

<template>
  <div v-if="cur" class="tw:fixed tw:inset-0 tw:z-1600 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55">
    <form class="tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(720px,calc(100vw-32px))]" @submit.prevent="answerApproval('once')" @keydown.esc.prevent="answerApproval('no')">
      <div class="cap tw:truncate">Разрешить запуск скрипта?</div>
      <p class="tw:m-0 tw:text-text-2 tw:text-[12.5px]">
        <b class="tw:text-text-hi">{{ cur.lang }}</b> · блок «{{ cur.block }}» · {{ cur.notePath.replace(/\.md$/i, '') }} · {{ where }}
      </p>
      <p class="tw:m-0 tw:text-warn-fg tw:text-[12px]">{{ WHY[cur.why] }}</p>
      <pre class="tw:m-0 tw:max-h-[45vh] tw:overflow-auto tw:py-8 tw:px-10 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ cur.script }}</pre>
      <p v-if="pendingApprovals.length > 1" class="tw:m-0 tw:text-muted tw:text-[11.5px]">Ещё ждут ответа: {{ pendingApprovals.length - 1 }}</p>
      <div class="tw:flex tw:gap-8">
        <button type="button" class="primary" @click="answerApproval('always')">Разрешить и запомнить</button>
        <button type="submit" autofocus>Только сейчас</button>
        <button type="button" @click="answerApproval('no')">Отказать</button>
      </div>
    </form>
  </div>
</template>
