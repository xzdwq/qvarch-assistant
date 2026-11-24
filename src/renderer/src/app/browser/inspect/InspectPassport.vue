<script setup lang="ts">
import { computed, ref } from 'vue'
import { VITALS } from '@shared/browser/inspect/constants'
import { vitalText } from '@shared/browser/inspect/siteFacts'
import type { SitePassport } from '@shared/browser/inspect/types'
import Icon from '../../../components/Icon.vue'
import NavTimingBar from './NavTimingBar.vue'

/**
 * The site's passport: why the page is said to be made so, its Web Vitals, its opening by phases, its technologies by
 * category, its problems (the worst first), its facts by group — each part folds.
 */
const props = defineProps<{ passport: SitePassport }>()
/** The parts toggled: technologies and problems — folded when in it; a facts group (`facts:<group>`) — open when in it. */
const folded = ref(new Set<string>())
const fold = (k: string) => {
  const s = new Set(folded.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  folded.value = s
}
const byCat = computed(() => {
  const m = new Map<string, SitePassport['tech']>()
  for (const t of props.passport.tech) for (const c of t.cats.length ? t.cats : ['Прочее']) m.set(c, [...(m.get(c) ?? []), t])
  return [...m]
})
const factGroups = computed(() => {
  const m = new Map<string, SitePassport['facts']>()
  for (const f of props.passport.facts) m.set(f.group, [...(m.get(f.group) ?? []), f])
  return [...m]
})
const openProblem = ref<number>()
const HEAD = 'tw:flex tw:items-center tw:gap-6 tw:w-full tw:h-26 tw:px-10 tw:border-0 tw:bg-transparent tw:text-text-2 tw:text-[11px] tw:font-data tw:uppercase tw:tracking-[0.05em] tw:text-left tw:hover:text-text'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:pb-6">
    <ul v-if="passport.render?.why.length" class="tw:m-0 tw:px-10 tw:pl-24 tw:pt-2 tw:text-[11.5px] tw:text-muted tw:flex tw:flex-col tw:gap-2">
      <li v-for="w in passport.render.why" :key="w">{{ w }}</li>
    </ul>

    <div v-if="passport.vitals.length" class="tw:flex tw:flex-wrap tw:gap-4 tw:px-10 tw:pt-8">
      <span v-for="v in passport.vitals" :key="v.name" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:px-6 tw:rounded-r2 tw:text-[11.5px] tw:font-data tw:bg-panel-3 tw:[&.good]:text-up-fg tw:[&.mid]:text-warn-fg tw:[&.poor]:text-down-fg" :class="v.rating" :title="`${VITALS[v.name].title}${v.target ? `\nЭлемент: ${v.target}` : ''}`">{{ v.name }} {{ vitalText(v) }}</span>
    </div>

    <NavTimingBar v-if="passport.timing" :t="passport.timing" />

    <button :class="HEAD" class="tw:mt-6" @click="fold('Технологии')"><Icon :name="folded.has('Технологии') ? 'chevronRight' : 'chevronDown'" :size="11" />Технологии · {{ passport.tech.length }}</button>
    <div v-if="!folded.has('Технологии')" class="tw:flex tw:flex-col tw:gap-4 tw:px-10">
      <span v-if="!passport.tech.length" class="tw:text-[12px] tw:text-muted">{{ passport.pending ? 'определяются…' : 'не определены' }}</span>
      <div v-for="[cat, list] in byCat" :key="cat" class="tw:flex tw:items-baseline tw:gap-6 tw:min-w-0">
        <span class="tw:flex-none tw:w-120 tw:truncate tw:text-[11.5px] tw:text-muted" :title="cat">{{ cat }}</span>
        <span class="tw:flex tw:flex-wrap tw:gap-4 tw:min-w-0">
          <span v-for="t in list" :key="t.name" class="tw:px-6 tw:rounded-r2 tw:bg-tag-chip tw:text-tag-chip-fg tw:text-[11.5px]" :title="[t.description, `найдено по: ${t.by.join(', ')}`, `уверенность ${t.confidence}%`, t.website].filter(Boolean).join('\n')">{{ t.name }}<b v-if="t.version" class="tw:font-normal tw:opacity-70"> {{ t.version }}</b></span>
        </span>
      </div>
    </div>

    <button :class="HEAD" class="tw:mt-6" @click="fold('Проблемы')"><Icon :name="folded.has('Проблемы') ? 'chevronRight' : 'chevronDown'" :size="11" />Проблемы · {{ passport.problems.length }}</button>
    <div v-if="!folded.has('Проблемы')" class="tw:flex tw:flex-col tw:px-6">
      <span v-if="!passport.problems.length" class="tw:px-4 tw:text-[12px] tw:text-muted">{{ passport.pending ? 'проверяется…' : 'не найдены' }}</span>
      <button v-for="(p, i) in passport.problems" :key="i" class="tw:flex tw:flex-col tw:gap-2 tw:w-full tw:px-4 tw:py-3 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" @click="openProblem = openProblem === i ? undefined : i">
        <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[12px] tw:text-text">
          <i class="tw:flex-none tw:w-6 tw:h-6 tw:rounded-[50%] tw:[&.high]:bg-down tw:[&.mid]:bg-warn tw:[&.info]:bg-info" :class="p.level"></i>
          <span class="tw:min-w-0 tw:truncate">{{ p.title }}</span>
        </span>
        <span v-if="openProblem === i && p.detail" class="tw:pl-12 tw:text-[11.5px] tw:text-muted tw:whitespace-pre-wrap tw:break-all">{{ p.detail }}</span>
      </button>
    </div>

    <!-- the facts by group: folded until opened -->
    <template v-for="[group, list] in factGroups" :key="group">
      <button :class="HEAD" class="tw:mt-6" @click="fold(`facts:${group}`)">
        <Icon :name="folded.has(`facts:${group}`) ? 'chevronDown' : 'chevronRight'" :size="11" />{{ group }} · {{ list.length }}
      </button>
      <div v-if="folded.has(`facts:${group}`)" class="tw:flex tw:flex-col tw:px-10">
        <div v-for="f in list" :key="f.label" class="tw:flex tw:gap-8 tw:min-w-0 tw:py-1 tw:text-[11.5px]">
          <span class="tw:flex-none tw:w-140 tw:truncate tw:text-muted" :title="f.label">{{ f.label }}</span>
          <span class="tw:min-w-0 tw:break-all tw:text-text-2 tw:font-data tw:[&.high]:text-down-fg tw:[&.mid]:text-warn-fg" :class="f.level">{{ f.value }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
