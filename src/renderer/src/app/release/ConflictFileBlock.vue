<script setup lang="ts">
import { computed } from 'vue'
import type { ConflictSource, PlanItem } from '@shared/release'
import { formatDateTime, shortSha } from '@shared/releaseView'
import { rs } from '../../lib/releaseStore'
import { shaToBranch } from './planView'
import { openLink } from './releaseActions'

/** One conflicting file of an item: who last changed the lines; unfolded — both sides of each hunk and the task divergence. */
const props = defineProps<{ item: PlanItem; s: ConflictSource }>()

const key = computed(() => props.item.sha + '|' + props.s.file)
const open = computed(() => rs.expandedConflicts.has(key.value))
/** The picked branch the blamed commit belongs to (none — it is in main already). */
const whoBranch = computed(() => (props.s.sha ? shaToBranch.value.get(props.s.sha) : undefined))
function flip(): void {
  const set = new Set(rs.expandedConflicts)
  if (set.has(key.value)) set.delete(key.value)
  else set.add(key.value)
  rs.expandedConflicts = set
}
</script>

<template>
  <div class="cfb tw:[.cfb+&]:mt-6 tw:[.cfb+&]:pt-6 tw:[.cfb+&]:border-t tw:[.cfb+&]:border-t-border">
    <div class="cf tw:py-2 tw:px-0 tw:text-[11px]">
      <span class="cft tw:cursor-pointer tw:select-none tw:hover:underline" @click="flip"><span class="ca tw:inline-block tw:w-12">{{ open ? '▾' : '▸' }}</span> <b>{{ s.file }}</b></span>
      —
      <template v-if="s.analysisPending">причина ещё считается фоном…</template>
      <template v-else-if="!s.sha">файла нет в истории основной ветки (вероятно, его создаёт сам этот коммит)</template>
      <template v-else>
        конфликтующие строки последним менял: <template v-if="whoBranch">ветка <b>{{ whoBranch }}</b></template><template v-else>уже в основной ветке</template>,
        <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(s.commitUrl)">{{ shortSha(s.sha) }}</a><template v-if="s.subject"> «{{ s.subject }}»</template><template v-if="s.authorName"> · {{ s.authorName }}</template><template v-if="s.authorDate"> · {{ formatDateTime(s.authorDate) }}</template>
      </template>
    </div>
    <div v-if="open" class="cfbody tw:@container">
      <div v-if="s.analysisPending" class="mut tw:text-muted tw:text-[12px]"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Загружаем причину конфликта…</div>
      <template v-else>
        <template v-for="(h, hi) in s.hunks" :key="hi">
          <div class="hunk tw:flex tw:flex-wrap tw:gap-8 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-8 tw:@max-[420px]:[.hunk+&]:mt-6 tw:@max-[420px]:[.hunk+&]:pt-6 tw:@max-[420px]:[.hunk+&]:border-t tw:@max-[420px]:[.hunk+&]:[border-top-style:dashed] tw:@max-[420px]:[.hunk+&]:border-t-border">
            <div class="hside tw:flex-[1_1_240px] tw:min-w-200">
              <span class="mut hl tw:text-muted tw:text-[10px]">{{ rs.mainBranch }} (текущая){{ h.oursStartLine !== null ? ', строка ' + h.oursStartLine : '' }}:</span>
              <div class="code tw:max-h-160 tw:mt-2 tw:mr-0 tw:mb-0 tw:ml-0 tw:overflow-y-auto tw:py-4 tw:px-0 tw:rounded-r2 tw:bg-bg tw:font-data tw:text-[11px]">
                <div v-for="(l, li) in h.oursText" :key="li" class="line tw:relative tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-34 tw:whitespace-pre-wrap tw:[word-break:break-word] tw:before:content-[attr(data-line)] tw:before:absolute tw:before:left-6 tw:before:w-24 tw:before:text-border-3 tw:before:text-right tw:before:select-none" :data-line="h.oursStartLine !== null ? h.oursStartLine + li : ''">{{ l }}</div>
                <div v-if="!h.oursText.length" class="line mut tw:text-muted tw:text-[12px] tw:relative tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-34 tw:whitespace-pre-wrap tw:[word-break:break-word] tw:[&&]:pl-6 tw:italic tw:before:absolute tw:before:left-6 tw:before:w-24 tw:before:text-border-3 tw:before:text-right tw:before:select-none tw:before:content-[none]">(пусто — {{ rs.mainBranch }} тут ничего не меняет)</div>
              </div>
            </div>
            <div class="hside tw:flex-[1_1_240px] tw:min-w-200">
              <span class="mut hl tw:text-muted tw:text-[10px]">входящий коммит{{ h.theirsStartLine !== null ? ', строка ' + h.theirsStartLine : '' }}:</span>
              <div class="code tw:max-h-160 tw:mt-2 tw:mr-0 tw:mb-0 tw:ml-0 tw:overflow-y-auto tw:py-4 tw:px-0 tw:rounded-r2 tw:bg-bg tw:font-data tw:text-[11px]">
                <div v-for="(l, li) in h.theirsText" :key="li" class="line tw:relative tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-34 tw:whitespace-pre-wrap tw:[word-break:break-word] tw:before:content-[attr(data-line)] tw:before:absolute tw:before:left-6 tw:before:w-24 tw:before:text-border-3 tw:before:text-right tw:before:select-none" :data-line="h.theirsStartLine !== null ? h.theirsStartLine + li : ''">{{ l }}</div>
                <div v-if="!h.theirsText.length" class="line mut tw:text-muted tw:text-[12px] tw:relative tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-34 tw:whitespace-pre-wrap tw:[word-break:break-word] tw:[&&]:pl-6 tw:italic tw:before:absolute tw:before:left-6 tw:before:w-24 tw:before:text-border-3 tw:before:text-right tw:before:select-none tw:before:content-[none]">(пусто — входящий коммит удаляет это место)</div>
              </div>
            </div>
          </div>
          <div v-if="h.sameContent" class="div ok tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-8 tw:text-[11px] tw:text-(--c-green)">✓ Различий по сути нет (пробелы/пустые строки не в счёт) — конфликт из-за контекста слияния. Можно принять любую сторону.</div>
        </template>
        <div v-if="s.sha && s.taskDivergence" class="div tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-8 tw:text-[11px] tw:[&.ok]:not-[&.warn]:text-(--c-green) tw:[&.warn]:text-(--c-orange)" :class="s.taskDivergence.contentMatch === 'different' ? 'warn' : 'ok'">
          <template v-if="s.taskDivergence.contentMatch === 'different'">⚠ Задача {{ s.taskDivergence.taskKey }} также реализована на dev отдельным коммитом (</template>
          <template v-else>✓ Похоже, задача {{ s.taskDivergence.taskKey }} уже реализована на dev отдельным коммитом (</template>
          <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(s.taskDivergence.otherCommitUrl)">{{ shortSha(s.taskDivergence.otherSha) }}</a> «{{ s.taskDivergence.otherSubject }}» · {{ s.taskDivergence.otherAuthorName }} · {{ formatDateTime(s.taskDivergence.otherAuthorDate) }})
          <template v-if="s.taskDivergence.contentMatch === 'different'">, но содержимое отличается — разрешайте вручную.</template>
          <template v-else> — {{ s.taskDivergence.contentMatch === 'identical' ? 'содержимое совпадает' : 'отличается только пробелами/пустыми строками' }}. Можно принять любую сторону.</template>
        </div>
      </template>
    </div>
  </div>
</template>
