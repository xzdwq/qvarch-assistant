<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { useIsland } from '../islandState'

/**
 * What waits in the island: the chats' unread messages (always — notifications on or off) and the reminders not seen;
 * a click opens their area.
 */
const { chat, notices } = useIsland()
const { unread } = chat
const { list } = notices
const many = (n: number) => (n > 99 ? '99+' : String(n))
</script>

<template>
  <span v-if="unread || list.length" class="tw:inline-flex tw:items-center tw:gap-2 tw:[writing-mode:horizontal-tb]">
    <button
      v-if="unread"
      class="tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:min-w-17 tw:h-17 tw:px-4 tw:border-0 tw:rounded-full tw:bg-accent tw:text-on-accent tw:text-[10px] tw:font-bold tw:leading-none tw:font-data tw:[box-shadow:0_0_0_2px_var(--bg)] tw:cursor-pointer"
      :title="`Непрочитанных сообщений: ${unread} — открыть чат`"
      @click.stop="chat.openChat()"
    >
      {{ many(unread) }}
    </button>
    <button
      v-if="list.length"
      class="tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:min-w-17 tw:h-17 tw:px-4 tw:border-0 tw:rounded-full tw:bg-warn tw:text-bg tw:text-[10px] tw:font-bold tw:leading-none tw:font-data tw:[box-shadow:0_0_0_2px_var(--bg)] tw:cursor-pointer"
      :title="`Напоминаний: ${list.length} — показать`"
      @click.stop="notices.show()"
    >
      <Icon name="bell" :size="10" />{{ list.length > 1 ? many(list.length) : '' }}
    </button>
  </span>
</template>
