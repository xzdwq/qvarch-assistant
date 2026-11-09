<script setup lang="ts">
import { computed } from 'vue'
import { resolveWiki } from '@shared/vault'
import { openUrl } from '../lib/links'
import { markdownHtml } from '../lib/markdownRender'
import { files } from '../lib/notebook'

/**
 * Markdown (GitHub flavour: tables, lists, code, links; the notes' wiki links) for AI summaries and the notes'
 * components. The text comes from outside, so the HTML is sanitised (lib/markdownRender); links open in the browser,
 * never inside the app; a wiki link opens its note here. `inline` — one line's markup (a table's cell, a heading's
 * words), drawn in the text around it.
 */
const props = defineProps<{ text: string; compact?: boolean; inline?: boolean }>()

const html = computed(() => markdownHtml(props.text, props.inline))

function onClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  // (a link is a link: the cell / the text under it is not edited for it)
  e.stopPropagation()
  const wiki = a.dataset.wiki
  if (wiki !== undefined) {
    const path = resolveWiki(wiki, files.value)
    if (path) void import('@nb/workspace/noteGoto').then(({ openNoteAt }) => openNoteAt(path, wiki.split('#')[1]?.trim() || undefined))
    return
  }
  if (/^https?:\/\//i.test(a.href)) openUrl(a.href)
}
</script>

<template>
  <!-- sanitised above -->
  <span v-if="inline" class="md md-inline" @click="onClick" v-html="html"></span>
  <div v-else class="md tw:text-[13px] tw:leading-[1.55] tw:[word-break:break-word] tw:[&.compact]:text-[12px] tw:[&.compact]:leading-[1.45]" :class="{ compact }" @click="onClick" v-html="html"></div>
</template>

<style scoped src="./Markdown.css"></style>
