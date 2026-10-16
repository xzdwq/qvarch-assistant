<script setup lang="ts">
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
  if (/^https?:\/\//i.test(a.href)) window.qa.openExternal(a.href)
}
</script>

<template>
  <!-- sanitised above -->
  <div class="md" :class="{ compact }" @click="onClick" v-html="html"></div>
</template>

<style scoped>
.md {
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}
.md.compact {
  font-size: 12px;
  line-height: 1.45;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 14px 0 6px;
  font-size: 14px;
  color: var(--accent-fg);
}
.md.compact :deep(h1),
.md.compact :deep(h2),
.md.compact :deep(h3) {
  margin: 6px 0 3px;
  font-size: 13px;
}
.md :deep(:first-child) {
  margin-top: 0;
}
.md :deep(:last-child) {
  margin-bottom: 0;
}
.md :deep(p) {
  margin: 6px 0;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}
.md :deep(li) {
  margin: 2px 0;
}
.md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}
.md :deep(th),
.md :deep(td) {
  padding: 4px 10px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.md :deep(th) {
  background: rgba(255, 255, 255, 0.05);
}
.md :deep(code) {
  padding: 0 4px;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.07);
  font-size: 12px;
}
.md :deep(pre) {
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  overflow: auto;
}
.md :deep(pre code) {
  padding: 0;
  background: none;
}
.md :deep(blockquote) {
  margin: 6px 0;
  padding-left: 10px;
  border-left: 3px solid rgb(var(--accent-rgb) / 0.5);
  color: var(--text-2);
}
.md :deep(a) {
  color: var(--info-fg);
}
.md :deep(input[type='checkbox']) {
  margin: 0 4px 0 0;
  vertical-align: middle;
}
</style>
