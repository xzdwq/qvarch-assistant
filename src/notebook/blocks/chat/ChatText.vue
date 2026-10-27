<script setup lang="ts">
/**
 * A message's words as Markdown (lists, bold, code, tables — as agents answer): its mentions lit, its links followed by
 * the app on a click; the HTML cleaned (DOMPurify) — a message is someone else's text.
 */
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { chatMarkdown } from '@shared/transport/chatText'
import type { NoteLinkRef } from '@shared/notebook/links'

const props = defineProps<{ text: string; members: Array<{ id: string; name: string }>; me: string }>()
const emit = defineEmits<{ follow: [link: NoteLinkRef] }>()
const made = computed(() => chatMarkdown(props.text, props.members, props.me))
const html = computed(() => DOMPurify.sanitize(marked.parse(made.value.md, { gfm: true, breaks: true, async: false }) as string, { ADD_ATTR: ['data-chat-link'] }))

/** A link clicked: one of the message's, or an address written bare — the app follows it (never the window itself). */
function onClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a')
  if (!a) return
  e.preventDefault()
  const own = a.dataset.chatLink === undefined ? undefined : made.value.links[Number(a.dataset.chatLink)]
  const href = a.getAttribute('href') ?? ''
  if (own) emit('follow', own)
  else if (/^https?:\/\//i.test(href)) emit('follow', { kind: 'web', raw: href, target: href })
}
</script>

<template>
  <!-- cleaned above -->
  <div class="ctext tw:text-text tw:text-[13px] tw:leading-[1.45] tw:wrap-anywhere" @click="onClick" v-html="html"></div>
</template>

<style scoped src="./ChatText.css"></style>
