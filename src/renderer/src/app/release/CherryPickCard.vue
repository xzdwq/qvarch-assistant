<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PlanItem } from '@shared/release'
import { cherryPickSegments, segmentKey, shortSha } from '@shared/releaseView'
import { colors, rs } from '../../lib/releaseStore'
import ReleaseCardHead from './ReleaseCardHead.vue'
import { pendingItems } from './planView'
import { openLink } from './releaseActions'

/** 3. Cherry-pick by hand: the pending commits as `git cherry-pick` commands, each ending at a conflict; copied ones fade. */
const collapsed = ref(false)
const colorFor = colors.colorFor
const segments = computed(() => cherryPickSegments(pendingItems.value))
async function copySegment(seg: PlanItem[]): Promise<void> {
  await navigator.clipboard.writeText('git cherry-pick ' + seg.map((i) => i.sha).join(' '))
  rs.copied = new Set([...rs.copied, segmentKey(seg)])
}
</script>

<template>
  <section class="card tw:mb-14 tw:py-12 tw:px-14 tw:rounded-(--rad) tw:border tw:border-border tw:bg-panel">
    <ReleaseCardHead :num="3" title="Команда для ручного cherry-pick" :collapsed="collapsed" @toggle="collapsed = !collapsed">
      <button class="b sec sm tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:hover:enabled:border-border-3" @click.stop="rs.copied = new Set()">Сбросить состояние копирования</button>
    </ReleaseCardHead>
    <div v-show="!collapsed">
      <div v-for="(seg, si) in segments" :key="segmentKey(seg)" class="cmd tw:mb-10 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-(--rad-sm) tw:[&.copied]:opacity-45" :class="{ copied: rs.copied.has(segmentKey(seg)) }">
        <div class="cmdh tw:flex tw:items-center tw:justify-between tw:gap-8 tw:mb-4">
          <span class="mut tw:text-muted tw:text-[11px]">{{ segments.length > 1 ? `Команда ${si + 1} из ${segments.length}` : 'Команда' }}<template v-if="seg[seg.length - 1].dryRunStatus === 'conflict'"> — заканчивается конфликтом</template><template v-else-if="seg[seg.length - 1].dryRunStatus === 'conditional'"> — заканчивается непроверенным коммитом (возможен конфликт)</template></span>
          <button class="b sec tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:hover:enabled:border-border-3" @click="copySegment(seg)">Копировать</button>
        </div>
        <div class="cmdb tw:font-data tw:text-[12px] tw:leading-[2] tw:[word-break:break-word]">
          <span class="pre tw:mr-6 tw:opacity-80">git cherry-pick</span>
          <template v-for="it in seg" :key="it.sha"><a class="csha tw:inline-block tw:mt-1 tw:mr-3 tw:mb-1 tw:ml-0 tw:py-1 tw:px-6 tw:border-2 tw:border-transparent tw:rounded-(--rad-sm) tw:text-black tw:text-[11px] tw:no-underline tw:cursor-pointer tw:hover:filter-[brightness(1.12)] tw:hover:underline tw:[&.conflict]:not-[&.conditional]:border-(--c-red) tw:[&.conditional]:border-(--c-yellow)" :class="it.dryRunStatus" :style="{ background: colorFor(it.branch) }" :title="`${it.branch} · ${it.subject}`" @click="openLink(it.commitUrl)">{{ shortSha(it.sha) }}</a>{{ ' ' }}</template>
        </div>
      </div>
    </div>
  </section>
</template>
