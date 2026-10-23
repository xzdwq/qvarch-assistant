<script setup lang="ts">
/** «Копировать»: the request in one of several forms (all of it to paste back, cURL, the address…), a dropdown. */
import { ref } from 'vue'
import type { HttpRequest } from '@shared/http'
import { HTTP_COPY_FORMATS as COPIES } from '@shared/httpCollection'
import Icon from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { useHttpView } from './httpViewContext'

const props = defineProps<{ req: HttpRequest }>()
const { doc, varMap } = useHttpView().collection
const copyOpen = ref(false)
const copyBtn = ref<HTMLElement>()
/** What was copied last (a moment's note). */
const copied = ref('')
async function copy(c: (typeof COPIES)[number]): Promise<void> {
  await navigator.clipboard.writeText(c.get(props.req, varMap.value, doc.settings))
  copyOpen.value = false
  copied.value = c.label
  setTimeout(() => (copied.value = ''), 1800)
}
</script>

<template>
        <span v-if="copied" class="copied tw:text-up-fg tw:text-[12px]">Скопировано: {{ copied }}</span>
        <span ref="copyBtn"><button class="ghost tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:text-[12px] tw:[&.on]:border-accent tw:[.seg_button+&]:not-[&.on]:border-l tw:[.seg_button+&]:not-[&.on]:border-l-border-2" :class="{ on: copyOpen }" @click="copyOpen = !copyOpen"><Icon name="copy" :size="13" />Копировать<Icon name="chevronDown" :size="11" /></button></span>
  <Popover v-model:open="copyOpen" :anchor="copyBtn" :width="240" :chrome="0" max-height="none" class="hc-pop tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
        <button class="tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:py-6 tw:px-10 tw:border-0 tw:bg-transparent tw:text-left tw:text-[12.5px] tw:hover:bg-hover" v-for="c in COPIES" :key="c.id" @click="copy(c)">{{ c.label }}</button>
  </Popover>
</template>
