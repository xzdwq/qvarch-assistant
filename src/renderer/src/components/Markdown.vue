<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * Markdown (GitHub flavour: tables, lists, code, links) for AI summaries and notes. The text comes from
 * outside, so the HTML is sanitised (DOMPurify); links open in the browser, never inside the app.
 */
const props = defineProps<{ text: string; compact?: boolean }>()

const html = computed(() => DOMPurify.sanitize(marked.parse(props.text, { gfm: true, breaks: true, async: false }) as string))

function onClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  if (/^https?:\/\//i.test(a.href)) openUrl(a.href)
}
</script>

<template>
  <!-- sanitised above -->
  <div class="md tw:text-[13px] tw:leading-[1.55] tw:[word-break:break-word] tw:[&.compact]:text-[12px] tw:[&.compact]:leading-[1.45]" :class="{ compact }" @click="onClick" v-html="html"></div>
</template>

<style scoped src="./Markdown.css"></style>
