<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { parseRegress, regressMd, runSum, unstable, type RegressCfg, type RegressRun } from '@shared/regress'
import type { VaultNode } from '@shared/vault'
import { noteRun } from '@nb/engine'
import { historyOf, regressLive, runRegression, stopRegression, testsOf } from '@renderer/lib/regress'
import { openNote } from '@renderer/lib/mentions'
import Icon from '@renderer/components/Icon.vue'

/**
 * «Регрессия»: the Playwright tests of a folder run one after another (on another stand, if one is set): a table of
 * the run, the runs by date above it (a click — that run), a test that passed and failed in turns — unstable.
 */
const props = defineProps<{ src: string; path: string; onChange?: (src: string) => void }>()
const cfg = ref<RegressCfg>(parseRegress(props.src))
watch(
  () => props.src,
  (s) => (cfg.value = parseRegress(s)),
)
function save(p: Partial<RegressCfg>): void {
  cfg.value = { ...cfg.value, ...p }
  props.onChange?.(regressMd(cfg.value))
}
// an old block without its id: one given (its runs are kept under it)
onMounted(() => !cfg.value.id && save({ id: Math.random().toString(36).slice(2, 10) }))
const key = computed(() => `regress-${cfg.value.id ?? 'x'}`)

// ---------- the folder: its tests counted before running ----------
const dirs = ref<string[]>([])
const count = ref<number>()
async function loadDirs(): Promise<void> {
  const walk = (ns: VaultNode[]): string[] => ns.flatMap((n) => (n.dir ? [n.path, ...walk(n.children ?? [])] : []))
  dirs.value = walk(await window.qa.vaultTree()).sort((a, b) => a.localeCompare(b, 'ru'))
}
onMounted(loadDirs)
watch(
  () => [cfg.value.folder, cfg.value.deep] as const,
  async () => (count.value = (await testsOf(cfg.value)).length),
  { immediate: true },
)

// ---------- running ----------
const live = computed(() => regressLive(props.path, key.value))
const running = computed(() => !!live.value)
const run = () => void runRegression(props.path, key.value, cfg.value)
const stop = () => stopRegression(props.path, key.value)

// ---------- the runs ----------
const history = computed<RegressRun[]>(() => (noteRun(props.path).runs[key.value] ? historyOf(props.path, key.value) : []))
const pickedAt = ref<number>()
const shown = computed(() => history.value.find((r) => r.at === pickedAt.value) ?? history.value[history.value.length - 1])
watch(
  () => history.value.length,
  () => (pickedAt.value = undefined),
)
const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dur = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} мс` : ms < 60000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.floor(ms / 60000)} мин ${Math.round((ms % 60000) / 1000)} с`)
const noteName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
</script>

<template>
  <div class="rg tw:flex tw:flex-col tw:gap-8 tw:py-10 tw:px-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:text-[12.5px]">
    <div class="rg-head tw:flex tw:items-center tw:gap-8">
      <Icon name="repeat" :size="14" /><b>Регрессия</b>
      <span class="muted tw:text-muted">{{ count === undefined ? '' : `тестов: ${count}` }}</span>
      <span class="grow tw:flex-1"></span>
      <button v-if="!running" class="primary tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-12" :disabled="!count" @mousedown.prevent @click="run"><Icon name="play" :size="11" />Прогнать</button>
      <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-12" v-else @mousedown.prevent @click="stop"><Icon name="stop" :size="11" />Стоп</button>
    </div>
    <div class="rg-cfg tw:flex tw:flex-wrap tw:items-center tw:gap-y-8 tw:gap-x-14">
      <label class="tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2">Папка
        <select class="tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" :value="cfg.folder" @change="save({ folder: ($event.target as HTMLSelectElement).value })" @focus="loadDirs">
          <option value="">Весь блокнот</option>
          <option v-for="d in dirs" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
      <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2"><input class="tw:[&:not([type='checkbox'])]:h-26 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit]" type="checkbox" :checked="cfg.deep" @change="save({ deep: ($event.target as HTMLInputElement).checked })" />с подпапками</label>
      <label class="stand tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2" title="Тот же набор на другом адресе (сервере, окружении): адрес в тестах заменяется на время прогона, заметки не меняются">Адрес
        <input class="tw:[&:not([type='checkbox'])]:h-26 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:w-230" :value="cfg.from ?? ''" placeholder="адрес в тестах — https://test.example.com" spellcheck="false" @change="save({ from: ($event.target as HTMLInputElement).value.trim() || undefined })" />
        <Icon name="chevronRight" :size="12" />
        <input class="tw:[&:not([type='checkbox'])]:h-26 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:w-230" :value="cfg.to ?? ''" placeholder="адрес прогона — https://stage.example.com" spellcheck="false" @change="save({ to: ($event.target as HTMLInputElement).value.trim() || undefined })" />
      </label>
    </div>

    <div v-if="live" class="rg-prog tw:flex tw:items-center tw:gap-10">
      <div class="bar tw:flex-[0_0_200px] tw:h-6 tw:rounded-[3px] tw:bg-panel-3 tw:overflow-hidden"><i class="tw:block tw:h-full tw:bg-accent tw:[transition:width_0.3s] tw:not-italic" :style="{ width: `${live.total ? (live.done / live.total) * 100 : 0}%` }"></i></div>
      <span>{{ live.done }} / {{ live.total }}<template v-if="live.current"> · {{ live.current }}</template></span>
    </div>

    <!-- the runs by date: a click — that run -->
    <div v-if="history.length" class="rg-runs tw:flex tw:gap-4 tw:overflow-x-auto tw:pb-2">
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-up tw:rounded-[4px] tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[11px] tw:[&.bad]:not-[&.stopped]:border-l-down tw:[&&]:[&.stopped]:border-l-muted tw:[&.on]:bg-accent/16 tw:[&.on]:text-text"
        v-for="r in [...history].reverse()"
        :key="r.at"
        :class="{ on: shown?.at === r.at, bad: runSum(r).fail, stopped: r.stopped }"
        :title="`${fmt(r.at)} · ${dur(r.ms)}${r.stand ? ` · адрес ${r.stand}` : ''}${r.stopped ? ' · остановлен' : ''}`"
        @mousedown.prevent
        @click="pickedAt = r.at"
      >
        {{ fmt(r.at) }}<i class="ok tw:not-italic tw:text-up-fg">✓{{ runSum(r).ok }}</i><i v-if="runSum(r).fail" class="fail tw:not-italic tw:text-down-fg">✗{{ runSum(r).fail }}</i>
      </button>
    </div>
    <p v-else-if="!running" class="muted none tw:text-muted tw:m-0">
      {{ count ? 'Нажмите «Прогнать» — тесты папки выполнятся по очереди, здесь появится таблица и история прогонов.' : 'В папке нет тестов Playwright. Запишите их в заметках папки («@Playwright» → «Записать»).' }}
    </p>

    <template v-if="shown">
      <p class="rg-sum tw:flex tw:gap-10 tw:m-0">
        <b class="tw:[&.ok]:not-[&.fail]:text-up-fg tw:[&.fail]:text-down-fg" :class="runSum(shown).fail ? 'fail' : 'ok'">{{ runSum(shown).fail ? `Упало: ${runSum(shown).fail} из ${runSum(shown).all}` : `Все прошли: ${runSum(shown).ok} из ${runSum(shown).all}` }}</b>
        <span class="muted tw:text-muted">{{ fmt(shown.at) }} · {{ dur(shown.ms) }}<template v-if="shown.stand"> · адрес {{ shown.stand }}</template><template v-if="shown.stopped"> · остановлен</template></span>
      </p>
      <table class="rg-t tw:border-collapse tw:w-full">
        <thead><tr><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Заметка</th><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Тест</th><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Статус</th><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Проверки</th><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Время</th><th class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:text-text-2 tw:font-semibold tw:text-[11.5px]">Ошибка</th></tr></thead>
        <tbody>
          <tr v-for="i in shown.items" :key="`${i.note}#${i.key}`" :class="i.state">
            <td class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6"><a href="#" @click.prevent="openNote(i.note)">{{ noteName(i.note) }}</a></td>
            <td class="tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6">{{ i.name }}</td>
            <td class="st tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6 tw:whitespace-nowrap">
              <span :class="i.state">{{ i.state === 'ok' ? '✓ прошёл' : i.soft ? '✗ упал (не останавливать)' : '✗ упал' }}</span>
              <em v-if="unstable(history, i.note, i.key)" class="flaky tw:ml-6 tw:py-0 tw:px-6 tw:rounded-[8px] tw:bg-caution/20 tw:text-warn-fg tw:not-italic tw:text-[11px]" title="В последних прогонах то проходил, то падал">нестабилен</em>
            </td>
            <td class="ck tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6"><template v-if="i.checks"><i v-if="i.checks.ok" class="ok tw:not-italic tw:text-up-fg tw:mr-6 tw:font-data">✓{{ i.checks.ok }}</i><i v-if="i.checks.fail" class="fail tw:not-italic tw:text-down-fg tw:mr-6 tw:font-data">✗{{ i.checks.fail }}</i><i v-if="i.checks.warn" class="warn tw:not-italic tw:text-warn-fg tw:mr-6 tw:font-data">!{{ i.checks.warn }}</i></template></td>
            <td class="num tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6 tw:font-data tw:whitespace-nowrap">{{ dur(i.ms) }}</td>
            <td class="er tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:text-left tw:align-top tw:[.rg-t_tr.fail_&]:bg-stop/6 tw:text-down-fg tw:text-[12px]">{{ i.error ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
