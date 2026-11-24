<script setup lang="ts">
import { computed } from 'vue'
import { ANIM_COST_WORDS, type AnimCost } from '@shared/browser/inspect/constants'
import { ms } from '@shared/browser/inspect/inspectReport'
import type { AnimStat } from '@shared/browser/inspect/types'
import InspectSection from './InspectSection.vue'

/**
 * The page's animations and transitions summed, the dearest first: what they change and so what they cost (the
 * compositor — cheap, painting, laying out — dear), how many times, how long, those running now (an endless one —
 * a spinner left on). The pointer over a row frames its element on the page.
 */
const props = defineProps<{ tabId: string; anims: AnimStat[] }>()
const COST_COLOR: Record<AnimCost, string> = { composite: 'var(--up)', paint: 'var(--warn)', layout: 'var(--down)' }
const note = computed(() => {
  const layout = props.anims.filter((a) => a.cost === 'layout').length
  const running = props.anims.reduce((s, a) => s + a.running, 0)
  return [`${props.anims.length}`, layout ? `с раскладкой ${layout}` : '', running ? `идут сейчас ${running}` : ''].filter(Boolean).join(' · ')
})
const mark = (sel: string) => void window.qa.browser('inspectShow', props.tabId, sel, false)
const unmark = () => void window.qa.browser('inspectShow', props.tabId)
</script>

<template>
  <InspectSection id="anims" title="Анимации" :note="note">
    <p v-if="!anims.length" class="tw:m-0 tw:px-10 tw:py-8 tw:text-[12px] tw:text-muted">Анимаций и переходов на странице пока не было.</p>
    <div v-for="a in anims" :key="a.key" class="tw:flex tw:flex-col tw:gap-1 tw:px-10 tw:py-4 tw:border-b tw:border-b-border tw:min-w-0 tw:hover:bg-hover" @mouseenter="mark(a.target)" @mouseleave="unmark">
      <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[12px]">
        <i class="tw:flex-none tw:w-7 tw:h-7 tw:rounded-[50%]" :style="{ background: COST_COLOR[a.cost] }"></i>
        <span class="tw:min-w-0 tw:truncate tw:text-text">{{ a.kind === 'transition' ? 'переход' : 'анимация' }} <b class="tw:font-data">{{ a.name }}</b></span>
        <span v-if="a.running" class="tw:flex-none tw:text-[11px] tw:text-accent-fg" :title="a.infinite ? 'Бесконечная — идёт, пока элемент на странице' : 'Идёт сейчас'">● {{ a.infinite ? '∞' : a.running }}</span>
        <span class="tw:ml-auto tw:flex-none tw:font-data tw:text-[11px] tw:text-text-2">×{{ a.count }}{{ a.total ? ` · ${ms(a.total)}` : '' }}{{ a.max ? ` · макс ${ms(a.max)}` : '' }}</span>
      </span>
      <span class="tw:pl-13 tw:min-w-0 tw:truncate tw:font-data tw:text-[11px] tw:text-muted" :title="a.target">{{ a.target }}</span>
      <span class="tw:pl-13 tw:text-[11px] tw:text-muted">{{ ANIM_COST_WORDS[a.cost] }}{{ a.props.length ? ` · ${a.props.slice(0, 6).join(', ')}` : '' }}</span>
    </div>
  </InspectSection>
</template>
