<script setup lang="ts">
/**
 * One message as messengers draw it: a bubble (one's own — on the right), its time beside it; the author's name over
 * the first one of a group (one's own — never), a tail under the last one. Mentions lit (one's own strongly), a
 * block's result drawn, the reactions under it (who — on hover; one's own lit, a click takes it back); the button in
 * its corner opens the reactions to put. `branch` — the branch it came from (the main conversation shows them all).
 */
import { computed, ref } from 'vue'
import { authorName, mentionParts, type ChatMessage } from '@shared/transport/chat'
import { linkParts, type NoteLinkRef } from '@shared/notebook/links'
import { resolveWiki } from '@shared/vault'
import { files, loadTree } from '@renderer/lib/notebook'
import { openNoteAt } from '@nb/workspace/noteGoto'
import { openUrl } from '@renderer/lib/links'
import Icon from '@renderer/components/Icon.vue'
import { toggleReaction } from '@renderer/lib/chat'
import AttachView from './AttachView.vue'
import ReactionPicker from './ReactionPicker.vue'

const props = defineProps<{ m: ChatMessage; me: string; members: Array<{ id: string; name: string }>; readonly?: boolean; first: boolean; last: boolean; branch?: string }>()
/** `reply` — answer it; `show` — the message it answers shown (by its number). */
const emit = defineEmits<{ reply: [m: ChatMessage]; show: [seq: number] }>()
// (one's own agent's answer is not one's own message: drawn as another's, with its name)
const mine = computed(() => props.m.author.id === props.me && !props.m.agent)
const parts = computed(() => mentionParts(props.m.text, props.members))
const reactions = computed(() => Object.entries(props.m.reactions ?? {}).filter(([, who]) => who.length))
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const react = (e: string) => void toggleReaction(props.m, e).catch(() => undefined)
/** A link in the message followed: a note opened (found by its name), anything else — as links open. */
async function follow(l: NoteLinkRef): Promise<void> {
  if (l.kind !== 'note') return openUrl(l.target)
  if (!files.value.length) await loadTree()
  const path = resolveWiki(l.target, files.value)
  if (path) await openNoteAt(path, l.section)
}
const addBtn = ref<HTMLElement>()
const picking = ref(false)
</script>

<template>
  <div class="tw:group/msg tw:flex tw:items-end tw:gap-6" :data-msg="`${m.room}:${m.seq}`" :class="[mine ? 'tw:flex-row-reverse' : 'tw:flex-row', first ? 'tw:mt-8' : 'tw:mt-2']" @dblclick="!readonly && emit('reply', m)">
    <div
      class="bubble tw:relative tw:min-w-0 tw:max-w-[78%] tw:py-6 tw:px-12 tw:rounded-[16px]"
      :class="{ mine, tail: last, 'tw:rounded-br-[5px]': mine && last, 'tw:rounded-bl-[5px]': !mine && last }"
    >
      <div v-if="first && (!mine || branch)" class="tw:flex tw:items-center tw:gap-6 tw:mb-1 tw:text-[11.5px] tw:font-semibold">
        <span v-if="!mine" class="tw:inline-flex tw:items-center tw:gap-4 tw:text-accent-fg" :title="m.agent ? `ИИ участника ${m.author.name}` : undefined"><Icon v-if="m.agent" name="sparkles" :size="11" />{{ authorName(m) }}</span>
        <span v-if="branch" class="tw:px-6 tw:rounded-full tw:bg-white/8 tw:text-muted tw:font-normal" title="Ветка, из которой сообщение">↳ {{ branch }}</span>
      </div>
      <!-- the message it answers: a click shows it -->
      <button
        v-if="m.reply"
        class="tw:flex tw:flex-col tw:items-start tw:w-full tw:min-w-0 tw:h-auto tw:mb-3 tw:py-2 tw:pr-8 tw:pl-8 tw:border-0 tw:border-l-2 tw:border-l-accent tw:rounded-[6px] tw:bg-accent/12 tw:text-left tw:hover:bg-accent/20"
        title="Показать сообщение"
        @click="emit('show', m.reply.seq)"
      >
        <b class="tw:max-w-full tw:truncate tw:text-accent-fg tw:text-[12px]">{{ m.reply.author }}</b>
        <span class="tw:max-w-full tw:truncate tw:text-muted tw:text-[12px] tw:font-normal">{{ m.reply.text || 'сообщение' }}</span>
      </button>
      <div v-if="m.text" class="tw:text-text tw:text-[13px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:wrap-anywhere">
        <template v-for="(p, i) in parts" :key="i">
          <span v-if="p.who" class="tw:px-2 tw:rounded-[3px] tw:font-medium" :class="p.who.id === me ? 'tw:bg-accent/30 tw:text-text-hi' : 'tw:text-accent-fg'">{{ p.text }}</span>
          <template v-else>
            <template v-for="(q, j) in linkParts(p.text)" :key="j">
              <a v-if="q.link" data-link class="tw:text-accent-fg tw:underline tw:cursor-pointer" :title="q.link.target" @click="follow(q.link)">{{ q.text }}</a>
              <template v-else>{{ q.text }}</template>
            </template>
          </template>
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
      <!-- the corner's buttons: answer, the reactions to put (shown on hover, and while open); over the next message's bubble -->
      <span v-if="!readonly" class="tw:absolute tw:z-2 tw:-bottom-8 tw:flex tw:gap-2 tw:opacity-0 tw:group-hover/msg:opacity-100 tw:has-[.on]:opacity-100" :class="mine ? 'tw:-left-8 tw:flex-row-reverse' : 'tw:-right-8'">
        <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border tw:border-border-2 tw:rounded-full tw:bg-pop tw:text-muted tw:hover:text-text" title="Ответить (двойной клик по сообщению)" @click="emit('reply', m)">
          <Icon name="reply" :size="12" />
        </button>
        <button ref="addBtn" class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border tw:border-border-2 tw:rounded-full tw:bg-pop tw:text-muted tw:hover:text-text" :class="{ on: picking }" title="Реакция" @click="picking = !picking">
          <Icon name="smilePlus" :size="12" />
        </button>
      </span>
    </div>
    <span class="tw:flex-none tw:pb-2 tw:text-dim tw:text-[10.5px] tw:font-data tw:opacity-0 tw:group-hover/msg:opacity-100" :class="{ 'tw:opacity-100': last }" :title="new Date(m.at).toLocaleString('ru-RU')">{{ hm(m.at) }}</span>
    <ReactionPicker v-if="!readonly" v-model:open="picking" :anchor="addBtn" @pick="react" />
  </div>
</template>

<style scoped src="./ChatMessageItem.css"></style>
