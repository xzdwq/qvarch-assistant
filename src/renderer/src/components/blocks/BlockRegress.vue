<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { parseRegress, regressMd, runSum, unstable, type RegressCfg, type RegressRun } from '@shared/regress'
import type { VaultNode } from '@shared/vault'
import { noteRun } from '../../lib/runbook'
import { historyOf, regressLive, runRegression, stopRegression, testsOf } from '../../lib/regress'
import { openNote } from '../../lib/mentions'
import Icon from '../Icon.vue'

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
  <div class="rg">
    <div class="rg-head">
      <Icon name="repeat" :size="14" /><b>Регрессия</b>
      <span class="muted">{{ count === undefined ? '' : `тестов: ${count}` }}</span>
      <span class="grow"></span>
      <button v-if="!running" class="primary" :disabled="!count" @mousedown.prevent @click="run"><Icon name="play" :size="11" />Прогнать</button>
      <button v-else @mousedown.prevent @click="stop"><Icon name="stop" :size="11" />Стоп</button>
    </div>
    <div class="rg-cfg">
      <label>Папка
        <select :value="cfg.folder" @change="save({ folder: ($event.target as HTMLSelectElement).value })" @focus="loadDirs">
          <option value="">Весь блокнот</option>
          <option v-for="d in dirs" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>
      <label class="chk"><input type="checkbox" :checked="cfg.deep" @change="save({ deep: ($event.target as HTMLInputElement).checked })" />с подпапками</label>
      <label class="stand" title="Тот же набор на другом адресе (сервере, окружении): адрес в тестах заменяется на время прогона, заметки не меняются">Адрес
        <input :value="cfg.from ?? ''" placeholder="адрес в тестах — https://test.example.com" spellcheck="false" @change="save({ from: ($event.target as HTMLInputElement).value.trim() || undefined })" />
        <Icon name="chevronRight" :size="12" />
        <input :value="cfg.to ?? ''" placeholder="адрес прогона — https://stage.example.com" spellcheck="false" @change="save({ to: ($event.target as HTMLInputElement).value.trim() || undefined })" />
      </label>
    </div>

    <div v-if="live" class="rg-prog">
      <div class="bar"><i :style="{ width: `${live.total ? (live.done / live.total) * 100 : 0}%` }"></i></div>
      <span>{{ live.done }} / {{ live.total }}<template v-if="live.current"> · {{ live.current }}</template></span>
    </div>

    <!-- the runs by date: a click — that run -->
    <div v-if="history.length" class="rg-runs">
      <button
        v-for="r in [...history].reverse()"
        :key="r.at"
        :class="{ on: shown?.at === r.at, bad: runSum(r).fail, stopped: r.stopped }"
        :title="`${fmt(r.at)} · ${dur(r.ms)}${r.stand ? ` · адрес ${r.stand}` : ''}${r.stopped ? ' · остановлен' : ''}`"
        @mousedown.prevent
        @click="pickedAt = r.at"
      >
        {{ fmt(r.at) }}<i class="ok">✓{{ runSum(r).ok }}</i><i v-if="runSum(r).fail" class="fail">✗{{ runSum(r).fail }}</i>
      </button>
    </div>
    <p v-else-if="!running" class="muted none">
      {{ count ? 'Нажмите «Прогнать» — тесты папки выполнятся по очереди, здесь появится таблица и история прогонов.' : 'В папке нет тестов Playwright. Запишите их в заметках папки («@Playwright» → «Записать»).' }}
    </p>

    <template v-if="shown">
      <p class="rg-sum">
        <b :class="runSum(shown).fail ? 'fail' : 'ok'">{{ runSum(shown).fail ? `Упало: ${runSum(shown).fail} из ${runSum(shown).all}` : `Все прошли: ${runSum(shown).ok} из ${runSum(shown).all}` }}</b>
        <span class="muted">{{ fmt(shown.at) }} · {{ dur(shown.ms) }}<template v-if="shown.stand"> · адрес {{ shown.stand }}</template><template v-if="shown.stopped"> · остановлен</template></span>
      </p>
      <table class="rg-t">
        <thead><tr><th>Заметка</th><th>Тест</th><th>Статус</th><th>Проверки</th><th>Время</th><th>Ошибка</th></tr></thead>
        <tbody>
          <tr v-for="i in shown.items" :key="`${i.note}#${i.key}`" :class="i.state">
            <td><a href="#" @click.prevent="openNote(i.note)">{{ noteName(i.note) }}</a></td>
            <td>{{ i.name }}</td>
            <td class="st">
              <span :class="i.state">{{ i.state === 'ok' ? '✓ прошёл' : i.soft ? '✗ упал (не останавливать)' : '✗ упал' }}</span>
              <em v-if="unstable(history, i.note, i.key)" class="flaky" title="В последних прогонах то проходил, то падал">нестабилен</em>
            </td>
            <td class="ck"><template v-if="i.checks"><i v-if="i.checks.ok" class="ok">✓{{ i.checks.ok }}</i><i v-if="i.checks.fail" class="fail">✗{{ i.checks.fail }}</i><i v-if="i.checks.warn" class="warn">!{{ i.checks.warn }}</i></template></td>
            <td class="num">{{ dur(i.ms) }}</td>
            <td class="er">{{ i.error ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.rg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  font-size: 12.5px;
}
.rg-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rg-head button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.rg-cfg {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}
.rg-cfg label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
}
.rg-cfg select,
.rg-cfg input:not([type='checkbox']) {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.stand input {
  width: 230px;
}
.rg-prog {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rg-prog .bar {
  flex: 0 0 200px;
  height: 6px;
  border-radius: 3px;
  background: var(--panel-3);
  overflow: hidden;
}
.rg-prog .bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.rg-runs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.rg-runs button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--up);
  border-radius: 4px;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11px;
}
.rg-runs button.bad {
  border-left-color: var(--down);
}
.rg-runs button.stopped {
  border-left-color: var(--muted);
}
.rg-runs button.on {
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
i {
  font-style: normal;
}
.ok {
  color: var(--up-fg);
}
.fail {
  color: var(--down-fg);
}
.warn {
  color: var(--warn-fg);
}
.rg-sum {
  display: flex;
  gap: 10px;
  margin: 0;
}
.rg-t {
  border-collapse: collapse;
  width: 100%;
}
.rg-t th,
.rg-t td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.rg-t th {
  color: var(--text-2);
  font-weight: 600;
  font-size: 11.5px;
}
.rg-t tr.fail td {
  background: rgb(239 68 68 / 0.06);
}
.rg-t .st {
  white-space: nowrap;
}
.rg-t .ck i {
  margin-right: 6px;
  font-family: var(--font-data);
}
.rg-t .num {
  font-family: var(--font-data);
  white-space: nowrap;
}
.rg-t .er {
  color: var(--down-fg);
  font-size: 12px;
}
.flaky {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgb(var(--warn-rgb, 251 191 36) / 0.2);
  color: var(--warn-fg);
  font-style: normal;
  font-size: 11px;
}
.none {
  margin: 0;
}
</style>
