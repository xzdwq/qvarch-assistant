<script setup lang="ts">
/**
 * One message as messengers draw it: a bubble (one's own — on the right), its time beside it; the author's name over
 * the first one of a group (one's own — never), a tail under the last one. Mentions lit (one's own strongly), a
 * block's result drawn, the reactions under it (who — on hover; one's own lit, a click takes it back); the button in
 * its corner opens the reactions to put. `branch` — the branch it came from (the main conversation shows them all).
 */
import { computed, ref } from 'vue'
import { mentionParts, type ChatMessage } from '@shared/transport/chat'
import type { DeviceInfo } from '@shared/transport/protocol'
import Icon from '@renderer/components/Icon.vue'
import { toggleReaction } from '@renderer/lib/chat'
import AttachView from './AttachView.vue'
import ReactionPicker from './ReactionPicker.vue'

const props = defineProps<{ m: ChatMessage; me: string; members: DeviceInfo[]; readonly?: boolean; first: boolean; last: boolean; branch?: string }>()
const mine = computed(() => props.m.author.id === props.me)
const parts = computed(() => mentionParts(props.m.text, props.members))
const reactions = computed(() => Object.entries(props.m.reactions ?? {}).filter(([, who]) => who.length))
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const react = (e: string) => void toggleReaction(props.m, e).catch(() => undefined)
const addBtn = ref<HTMLElement>()
const picking = ref(false)
</script>

<template>
  <div class="tw:group/msg tw:flex tw:items-end tw:gap-6" :class="[mine ? 'tw:flex-row-reverse' : 'tw:flex-row', first ? 'tw:mt-8' : 'tw:mt-2']">
    <div
      class="bubble tw:relative tw:min-w-0 tw:max-w-[78%] tw:py-5 tw:px-10 tw:rounded-[12px]"
      :class="{ mine, tail: last, 'tw:rounded-br-[4px]': mine && last, 'tw:rounded-bl-[4px]': !mine && last }"
    >
      <div v-if="first && (!mine || branch)" class="tw:flex tw:items-center tw:gap-6 tw:mb-1 tw:text-[11.5px] tw:font-semibold">
        <span v-if="!mine" class="tw:text-accent-fg">{{ m.author.name }}</span>
        <span v-if="branch" class="tw:px-5 tw:rounded-[4px] tw:bg-white/8 tw:text-muted tw:font-normal" title="Ветка, из которой сообщение">↳ {{ branch }}</span>
      </div>
      <div v-if="m.text" class="tw:text-text tw:text-[13px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:wrap-anywhere">
        <template v-for="(p, i) in parts" :key="i">
          <span v-if="p.who" class="tw:px-2 tw:rounded-[3px] tw:font-medium" :class="p.who.id === me ? 'tw:bg-accent/30 tw:text-text-hi' : 'tw:text-accent-fg'">{{ p.text }}</span>
          <template v-else>{{ p.text }}</template>
        </template>
      </div>
      <AttachView v-if="m.attach" :a="m.attach" :room="m.room" />
      <div v-if="reactions.length" class="tw:flex tw:flex-wrap tw:gap-4 tw:mt-4">
        <button
          v-for="[e, who] in reactions"
          :key="e"
          class="tw:inline-flex tw:items-center tw:gap-3 tw:h-22 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-bg/50 tw:text-[13px] tw:leading-none tw:[&.on]:border-accent tw:[&.on]:bg-accent/15"
          :class="{ on: who.some((d) => d.id === me) }"
          :title="who.map((d) => d.name).join(', ')"
          :disabled="readonly"
          @click="react(e)"
        >
          {{ e }}<span class="tw:text-muted tw:font-data tw:text-[11px]">{{ who.length }}</span>
        </button>
      </div>
      <!-- the corner's button: the reactions to put (shown on hover, and while open); over the next message's bubble -->
      <button
        v-if="!readonly"
        ref="addBtn"
        class="tw:absolute tw:z-2 tw:-bottom-8tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-pop tw:text-muted tw:opacity-0 tw:group-hover/msg:opacity-100 tw:hover:text-text tw:[&.on]:opacity-100"
        :class="[{ on: picking }, mine ? 'tw:-left-8' : 'tw:-right-8']"
        title="Реакция"
        @click="picking = !picking"
      >
        <Icon name="smilePlus" :size="12" />
      </button>
    </div>
    <span class="tw:flex-none tw:pb-2 tw:text-dim tw:text-[10.5px] tw:font-data tw:opacity-0 tw:group-hover/msg:opacity-100" :class="{ 'tw:opacity-100': last }" :title="new Date(m.at).toLocaleString('ru-RU')">{{ hm(m.at) }}</span>
    <ReactionPicker v-if="!readonly" v-model:open="picking" :anchor="addBtn" @pick="react" />
  </div>
</template>

<style scoped src="./ChatMessageItem.css"></style>
