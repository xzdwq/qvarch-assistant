<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { BranchRef, CommitInfo, ConflictCause, ConflictSource, MainStatus, PlanItem, ProjectProfile } from '@shared/release'
import Icon from '../components/Icon.vue'
import JiraReleasePicker from '../components/JiraReleasePicker.vue'
import type { JiraVersion } from '@shared/jira'
import { computeRail, drawRail, railWidth, type Row } from '../lib/releaseRail'
import { colors, listen, loadProjects, openProject, planTick, requestDateCheck, rs, send, showError, today } from '../lib/releaseStore'

/**
 * Релиз — the release branch builder (formerly the "Qvarh Release" VS Code extension), laid out as its
 * panel was: the git bar, then 1 branches · 2 chronology · 3 cherry-pick by hand · 4 the build.
 */
const colorFor = colors.colorFor
listen()

// ---------- projects ----------
const managerOpen = ref(false)
onMounted(async () => {
  await loadProjects()
  if (!rs.projects.length) {
    if (await window.qa.releaseImport()) await loadProjects()
  }
  if (!rs.projects.length) {
    managerOpen.value = true
    return
  }
  const id = rs.projects.some((p) => p.id === rs.projectId) ? rs.projectId : rs.projects[0].id
  void openProject(id)
})
const projOpen = ref(false)
const projEl = ref<HTMLElement>()
function pickProject(id: string): void {
  projOpen.value = false
  void openProject(id, true)
}

// ---------- helpers ----------
const open = (url?: string | null) => url && openUrl(url)
const short = (sha: string) => sha.slice(0, 8)
function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const count = (n: number) => (n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k')
const status = (b: BranchRef): MainStatus => rs.statusOverride.get(b.ref) ?? b.mainStatus
function commitsOf(ref: string) {
  const v = rs.commits.get(ref)
  return v && v !== 'loading' ? v : undefined
}
/** "Открыть в VS Code" — conflicts are resolved in the editor. */
const openCode = (path: string) => path && void window.qa.releaseOpenInCode(path)

// ---------- the git bar ----------
const branchNames = computed(() => {
  const s = new Set(rs.branches.map((b) => b.name))
  for (const n of [rs.current, rs.mainBranch, rs.devBranch]) if (n) s.add(n)
  return [...s].sort()
})
const dirtyMark = computed(() => (rs.dirty.hasUnstaged || rs.dirty.hasStaged ? ` (${rs.dirty.hasUnstaged ? '*' : ''}${rs.dirty.hasStaged ? '+' : ''})` : ''))
function switchBranch(name: string): void {
  showError('')
  send({ command: 'switchBranch', branch: name })
}
function pull(): void {
  showError('')
  rs.busy.pull = true
  send({ command: 'pullCurrentBranch' })
}

// ---------- 1. branches ----------
const cards = ref({ branches: false, chrono: false, cherry: false, build: false })
let filterTimer: ReturnType<typeof setTimeout> | undefined
const searching = ref(false)
function onFilter(v: string): void {
  rs.filter = v
  clearTimeout(filterTimer)
  searching.value = true
  filterTimer = setTimeout(() => send({ command: 'filterBranches', query: v }), 150)
}
watch(
  () => rs.branches,
  () => (searching.value = false),
)
function applyFilters(): void {
  showError('')
  searching.value = true
  send({ command: 'setBranchListLimit', limit: rs.limit, hideAlreadyInMain: rs.hideInMain })
}
// ---------- a Jira release: its tasks' branches get ticked ----------
const relBusy = ref(false)
/** The keys to tick once the full list of branches comes (it was limited when the release was picked). */
let pendingKeys: string[] | undefined
/** A branch is a task's when its name holds the key as a whole word: feature/DOS-12, DOS-12-fix — not DOS-123. */
const keyRe = (k: string) => new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i')
function tickKeys(keys: string[]): void {
  const res = keys.map(keyRe)
  const s = new Set(rs.selected)
  const found = new Set<string>()
  for (const b of rs.branches)
    keys.forEach((k, i) => {
      if (res[i].test(b.name)) {
        s.add(b.ref)
        found.add(k)
      }
    })
  rs.selected = s
  const missing = keys.length - found.size
  rs.jiraReleaseInfo = `задач ${keys.length} · веток отмечено ${found.size}${missing ? ` · без ветки ${missing}` : ''}`
}
async function onRelease(v: JiraVersion | undefined): Promise<void> {
  rs.jiraRelease = v
  rs.jiraReleaseInfo = ''
  pendingKeys = undefined
  // cleared: only the release goes, the ticked branches stay
  if (!v) return
  relBusy.value = true
  try {
    const keys = await window.qa.jiraVersionIssues(v.id)
    if (rs.jiraRelease?.id !== v.id) return
    tickKeys(keys)
    // a limited list may hide some of the branches: show them all, tick again when they come
    if (rs.limit < LIMITS[LIMITS.length - 1]) {
      pendingKeys = keys
      rs.limit = LIMITS[LIMITS.length - 1]
      applyFilters()
    }
  } catch (e) {
    rs.jiraReleaseInfo = `Jira: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)}`
  } finally {
    relBusy.value = false
  }
}
watch(
  () => rs.branches,
  () => {
    if (!pendingKeys) return
    tickKeys(pendingKeys)
    pendingKeys = undefined
  },
)
function setService(show: boolean): void {
  rs.showService = show
  searching.value = true
  send({ command: 'setHideServiceBranches', hide: !show })
}
function refresh(): void {
  rs.busy.refresh = true
  searching.value = true
  send({ command: 'refreshBranches' })
}
const LIMITS = [25, 50, 100, 200, 500, 1000000]
function toggleSel(ref: string, on: boolean): void {
  const s = new Set(rs.selected)
  if (on) s.add(ref)
  else s.delete(ref)
  rs.selected = s
}
const allSelected = computed(() => rs.branches.length > 0 && rs.branches.every((b) => rs.selected.has(b.ref)))
function selectAll(on: boolean): void {
  const s = new Set(rs.selected)
  for (const b of rs.branches) on ? s.add(b.ref) : s.delete(b.ref)
  rs.selected = s
}
function toggleExpand(ref: string): void {
  const s = new Set(rs.expanded)
  if (s.has(ref)) s.delete(ref)
  else {
    s.add(ref)
    if (!rs.commits.has(ref)) {
      rs.commits.set(ref, 'loading')
      send({ command: 'expandBranch', ref })
    }
  }
  rs.expanded = s
}
const allExpanded = computed(() => rs.branches.length > 0 && rs.branches.every((b) => rs.expanded.has(b.ref)))
function expandAll(): void {
  const on = !allExpanded.value
  const s = new Set(rs.expanded)
  for (const b of rs.branches) {
    if (on) {
      s.add(b.ref)
      if (!rs.commits.has(b.ref)) {
        rs.commits.set(b.ref, 'loading')
        send({ command: 'expandBranch', ref: b.ref })
      }
    } else s.delete(b.ref)
  }
  rs.expanded = s
}
const selectedList = computed(() => [...rs.selected].map((ref) => ({ ref, name: rs.nameByRef.get(ref) ?? ref })))
function buildPlan(): void {
  showError('')
  rs.busy.plan = true
  send({ command: 'buildPlan', selectedRefs: [...rs.selected] })
}
// the branch list's rail: one coloured dot per branch, the line between two dots in the lower one's colour
const listEl = ref<HTMLElement>()
const listRail = ref({ svg: '', h: 0 })
function drawListRail(): void {
  const el = listEl.value
  if (!el) return
  const rows = [...el.querySelectorAll<HTMLElement>(':scope > .brow')]
  if (!rows.length) {
    listRail.value = { svg: '', h: 0 }
    return
  }
  const centers = rows.map((r) => r.offsetTop + Math.min(r.offsetHeight / 2, 12))
  const last = rows[rows.length - 1]
  const x = 11
  let svg = ''
  rs.branches.forEach((b, i) => {
    if (i > 0 && centers[i] !== undefined) svg += `<line x1="${x}" y1="${centers[i - 1]}" x2="${x}" y2="${centers[i]}" stroke="${colorFor(b.name)}" stroke-width="2" />`
  })
  rs.branches.forEach((b, i) => {
    if (centers[i] !== undefined) svg += `<circle cx="${x}" cy="${centers[i]}" r="4" fill="${colorFor(b.name)}" />`
  })
  listRail.value = { svg, h: last.offsetTop + last.offsetHeight }
}
watch([() => rs.branches, () => rs.expanded.size, () => rs.commits.size, () => cards.value.branches], () => void nextTick(drawListRail), { flush: 'post' })

// ---------- 2. the chronology ----------
const plan = computed(() => rs.plan)
const items = computed(() => plan.value?.items ?? [])
const shaToBranch = computed(() => new Map(items.value.map((i) => [i.sha, i.branch])))
const inSync = computed(() => {
  if (!plan.value) return null
  const a = new Set(items.value.map((i) => i.branch))
  const b = new Set([...rs.selected].map((r) => rs.nameByRef.get(r) ?? r))
  return a.size === b.size && [...a].every((x) => b.has(x))
})
const included = computed(() => items.value.filter((i) => i.included))
const summary = computed(() => {
  void planTick.value
  const inc = included.value
  return {
    commits: inc.length,
    branches: new Set(inc.map((i) => i.branch)).size,
    authors: new Set(inc.map((i) => i.authorName)).size,
    ins: inc.reduce((s, i) => s + (i.insertions || 0), 0),
    del: inc.reduce((s, i) => s + (i.deletions || 0), 0),
    files: new Set(inc.flatMap((i) => i.files ?? [])).size,
    conflicts: inc.filter((i) => i.dryRunStatus === 'conflict').length,
    conditional: inc.filter((i) => i.dryRunStatus === 'conditional').length,
  }
})
const contextCount = computed(() => plan.value?.contextCommits?.length ?? 0)
const rows = computed<Row[]>(() => {
  void planTick.value
  const p = plan.value
  if (!p || !p.items.length) return []
  const ctx = rs.contextCollapsed ? [] : (p.contextCommits ?? [])
  const markers: Row[] = Object.entries(p.mergeEventsByBranch ?? {}).flatMap(([branch, evs]) =>
    evs.map((ev) => ({ kind: 'mergeMarker' as const, date: ev.authorDate, branch, commit: { ...ev, parents: [], alreadyInMain: false } as CommitInfo & { prUrl: string | null; prNumber: number | null } })),
  )
  const markerShas = new Set(markers.map((m) => (m as { commit: CommitInfo }).commit.sha))
  return [
    ...p.items.map((item) => ({ kind: 'item' as const, date: item.authorDate, item })),
    ...ctx.filter((c) => !markerShas.has(c.sha)).map((c) => ({ kind: 'context' as const, date: c.authorDate, commit: c })),
    ...markers,
    ...(rs.contextCollapsed || !p.anchorCommit ? [] : [{ kind: 'anchor' as const, date: p.anchorCommit.authorDate, commit: p.anchorCommit }]),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
})
const rail = computed(() => computeRail(rows.value, plan.value?.absorbedBranches ?? []))
const railW = computed(() => railWidth(rail.value))
const rowsEl = ref<HTMLElement>()
const railSvg = ref('')
const railH = ref(0)
function drawNow(): void {
  const el = rowsEl.value
  if (!el || !rows.value.length) {
    railSvg.value = ''
    return
  }
  const rowEls = [...el.querySelectorAll<HTMLElement>(':scope > .trow')]
  const centers = rowEls.map((r) => r.offsetTop + r.offsetHeight / 2)
  railH.value = el.scrollHeight
  railSvg.value = drawRail(rail.value, rows.value, centers, el.scrollHeight, colorFor)
}
watch([rows, () => rs.contextCollapsed, () => rs.expandedConflicts.size, () => cards.value.chrono], () => void nextTick(drawNow), { flush: 'post' })
let ro: ResizeObserver | undefined
let raf = 0
const redraw = () => {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    drawNow()
    drawListRail()
  })
}
onMounted(() => {
  ro = new ResizeObserver(redraw)
  for (const el of [rowsEl.value, listEl.value]) if (el) ro.observe(el)
  void nextTick(redraw)
})
watch([rowsEl, listEl], (now, before) => {
  for (const el of before) if (el) ro?.unobserve(el)
  for (const el of now) if (el) ro?.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())
/** Hovering a dot lights its whole branch on the rail. */
function onRailOver(e: MouseEvent): void {
  const b = (e.target as Element).closest?.('[data-branch]')?.getAttribute('data-branch')
  const svg = (e.currentTarget as HTMLElement).querySelector('svg')
  if (!svg) return
  for (const el of svg.querySelectorAll<SVGElement>('[data-branch]')) {
    el.classList.toggle('hot', !!b && el.getAttribute('data-branch') === b)
    el.classList.toggle('dim', !!b && el.getAttribute('data-branch') !== b)
  }
}
function toggleItem(it: PlanItem, on: boolean): void {
  it.included = on
  planTick.value++
  send({ command: 'toggleItem', sha: it.sha, included: on })
}
function flipConflict(key: string): void {
  const s = new Set(rs.expandedConflicts)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  rs.expandedConflicts = s
}
function causesOf(it: PlanItem): ConflictCause[] {
  const seen = new Set<string>()
  return (it.dryRunConflictSources ?? []).flatMap((s) => s.possibleCauses ?? []).filter((c) => (seen.has(c.branch) ? false : (seen.add(c.branch), true)))
}
const pending = (it: PlanItem) => (it.dryRunConflictSources ?? [])[0]?.analysisPending === true
function blockers(it: PlanItem): PlanItem[] {
  const files = new Set(it.dryRunConflictFiles ?? [])
  const out: PlanItem[] = []
  for (const o of items.value) {
    if (o === it) break
    if (o.dryRunStatus === 'conflict' && (o.files ?? []).some((f) => files.has(f))) out.push(o)
  }
  return out
}
const whoBranch = (s: ConflictSource) => (s.sha ? shaToBranch.value.get(s.sha) : undefined)
const overlapNames = (it: PlanItem) => {
  const names = [...new Set((it.overlapsWith ?? []).map((s) => shaToBranch.value.get(s)).filter(Boolean))]
  return names.length ? names.join(', ') : `${it.overlapsWith.length} коммит(ами) на других ветках`
}
function addStale(ref: string): void {
  const s = new Set(rs.selected)
  s.add(ref)
  rs.selected = s
}
function setLookback(v: string): void {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 1) return
  rs.lookback = n
  send({ command: 'setStaleBranchesLookback', value: n })
}
function clearPlan(): void {
  showError('')
  send({ command: 'clearPlan' })
}

// ---------- 3. cherry-pick by hand ----------
const pendingItems = computed(() => {
  void planTick.value
  return included.value.filter((i) => !i.applied)
})
const segments = computed(() => {
  const out: PlanItem[][] = []
  let cur: PlanItem[] = []
  for (const it of pendingItems.value) {
    cur.push(it)
    if (it.dryRunStatus === 'conflict' || it.dryRunStatus === 'conditional') {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
})
const segKey = (seg: PlanItem[]) => seg.map((i) => i.sha).join(',')
async function copySeg(seg: PlanItem[]): Promise<void> {
  await navigator.clipboard.writeText('git cherry-pick ' + seg.map((i) => i.sha).join(' '))
  rs.copied = new Set([...rs.copied, segKey(seg)])
}

// ---------- 4. the build ----------
const hasRelease = computed(() => !!plan.value?.releaseBranch)
const hasItems = computed(() => hasRelease.value && items.value.length > 0)
const hasPendingBuild = computed(() => hasItems.value && items.value.some((i) => i.included && !i.applied))
const appliedCount = computed(() => {
  void planTick.value
  return included.value.filter((i) => i.applied).length
})
const createDisabled = computed(() => rs.busy.create || rs.dateCheck.exists || (!!rs.dateCheck.branchName && rs.current === rs.dateCheck.branchName))
let dateTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => rs.releaseDate,
  () => {
    clearTimeout(dateTimer)
    dateTimer = setTimeout(requestDateCheck, 200)
  },
)
function createBranch(): void {
  showError('')
  rs.busy.create = true
  send({ command: 'startBuilding', releaseDate: rs.releaseDate.trim() })
}
function startAuto(): void {
  rs.busy.start = true
  showError('')
  send({ command: 'startAuto' })
}
function publish(): void {
  rs.busy.publish = true
  send({ command: 'publishRelease' })
}
const repoPath = computed(() => rs.projects.find((p) => p.id === rs.projectId)?.repositoryPath ?? '')
const cardNo = (k: 'cherry' | 'build') => (k === 'cherry' ? 3 : pendingItems.value.length ? 4 : 3)

// ---------- the projects window ----------
const EMPTY: Partial<ProjectProfile> & { prefixes: string } = { name: '', repositoryPath: '', mainBranch: 'main', devBranch: 'dev', remoteName: 'origin', releaseBranchPattern: 'release/release-{date}', branchListLimit: 100, staleBranchesLookbackReleases: 4, hideDuplicateRemoteBranches: true, taskTrackerBaseUrl: '', bitbucketWorkspace: '', bitbucketRepoSlug: '', prefixes: 'qa, revert-pr-, chore/' }
const form = ref<(Partial<ProjectProfile> & { prefixes: string }) | null>(null)
const formError = ref('')
const delAsk = ref('')
function editProject(p?: ProjectProfile): void {
  formError.value = ''
  form.value = p ? { ...p, prefixes: p.nonTaskBranchPrefixes.join(', ') } : { ...EMPTY }
}
async function saveForm(): Promise<void> {
  if (!form.value) return
  const { prefixes, ...rest } = form.value
  try {
    const saved = await window.qa.releaseSaveProject(JSON.parse(JSON.stringify({ ...rest, nonTaskBranchPrefixes: prefixes.split(',').map((x) => x.trim()).filter(Boolean) })) as Partial<ProjectProfile>)
    form.value = null
    await loadProjects()
    if (!rs.opened || saved.id === rs.opened) void openProject(saved.id, true)
  } catch (e) {
    formError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }
}
async function pickFolder(): Promise<void> {
  const p = await window.qa.releasePickFolder()
  if (p && form.value) {
    form.value.repositoryPath = p
    if (!form.value.name) form.value.name = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  }
}
async function removeProject(id: string): Promise<void> {
  await window.qa.releaseDeleteProject(id)
  delAsk.value = ''
  await loadProjects()
}
function onDown(e: MouseEvent): void {
  if (projOpen.value && !projEl.value?.contains(e.target as Node)) projOpen.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (form.value) form.value = null
    else managerOpen.value = false
  }
}
onMounted(() => {
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('keydown', onKey)
})
const subjectOf = (r: Row) => (r.kind === 'item' ? r.item.subject : r.commit.subject)
</script>

<template>
  <div class="rel">
    <div class="body">
      <div v-if="rs.error" class="err">
        <span class="et">{{ rs.error }}</span>
        <button v-if="rs.conflict && repoPath" class="b sec sm" @click="openCode(repoPath)">Открыть в VS Code</button>
        <button class="ex" title="Закрыть" @click="showError('')">×</button>
      </div>

      <!-- the git bar -->
      <div class="card gitbar">
        <div class="fi">
          <label>Текущая ветка</label>
          <select :value="rs.current" :title="dirtyMark ? '* — изменения без git add; + — застейджено, но не закоммичено' : ''" @change="switchBranch(($event.target as HTMLSelectElement).value)">
            <option v-for="n in branchNames" :key="n" :value="n">{{ n }}{{ n === rs.current ? dirtyMark : '' }}</option>
          </select>
          <div ref="projEl" class="pop">
            <button class="pname" :class="{ on: projOpen }" title="Проект" @click="projOpen = !projOpen">{{ rs.projectName || 'Проект' }}<Icon name="chevronDown" :size="12" /></button>
            <div v-if="projOpen" class="pd">
              <button v-for="p in rs.projects" :key="p.id" class="pi" :class="{ on: p.id === rs.projectId }" @click="pickProject(p.id)">
                <span class="pn">{{ p.name }}</span><small>{{ p.repositoryPath }}</small>
              </button>
              <div class="sep"></div>
              <button class="pi" @click="(projOpen = false), (managerOpen = true)"><span class="pn">Проекты…</span></button>
              <button class="pi" :disabled="!rs.projectId" @click="(projOpen = false), openProject(rs.projectId, true, true)"><span class="pn">Продолжить сохранённую сборку</span></button>
            </div>
          </div>
        </div>
        <div class="acts">
          <button class="ib" title="Открыть в VS Code" :disabled="!repoPath" @click="openCode(repoPath)"><Icon name="code" :size="14" /></button>
          <button class="b blue" :disabled="rs.busy.pull || !rs.current" title="git pull текущей ветки" @click="pull"><span v-if="rs.busy.pull" class="ld"></span>{{ rs.busy.pull ? 'Pull…' : 'Pull' }}</button>
        </div>
      </div>

      <!-- 1. branches -->
      <section class="card">
        <div class="ch" @click="cards.branches = !cards.branches">
          <span class="num">1</span>
          <div class="cht">
            <h3>Выберите ветки для релиза</h3>
            <div class="cd">Отметьте ветки, которые хотите включить в релиз.</div>
          </div>
          <div class="chx">
            <button class="b sec sm" :disabled="rs.busy.refresh" @click.stop="refresh"><span v-if="rs.busy.refresh" class="ld"></span>{{ rs.busy.refresh ? 'Обновляем…' : 'Обновить список веток' }}</button>
            <span class="arr">{{ cards.branches ? '▸' : '▾' }}</span>
          </div>
        </div>
        <div v-show="!cards.branches">
          <div class="frow">
            <label class="sf">
              <Icon name="search" :size="13" />
              <input :value="rs.filter" placeholder="фильтр по названию" @input="onFilter(($event.target as HTMLInputElement).value)" />
            </label>
            <label class="sw" title="Скрывает ветки, уже полностью выпущенные — проверка идёт git-запросом">
              <input :checked="rs.hideInMain" type="checkbox" @change="(rs.hideInMain = ($event.target as HTMLInputElement).checked), applyFilters()" /><span class="tr"></span>Скрыть уже в {{ rs.mainBranch }}
            </label>
            <label class="sw" title="qa, revert-pr-, chore/ и т.п.">
              <input :checked="rs.showService" type="checkbox" @change="setService(($event.target as HTMLInputElement).checked)" /><span class="tr"></span>Показать служебные
            </label>
            <label class="lim">Показывать
              <select v-model.number="rs.limit" @change="applyFilters">
                <option v-for="l in LIMITS" :key="l" :value="l">{{ l >= 1000000 ? 'Все' : l }}</option>
                <option v-if="!LIMITS.includes(rs.limit)" :value="rs.limit">{{ rs.limit }}</option>
              </select>
            </label>
          </div>
          <div class="arow">
            <label class="ck"><input type="checkbox" :checked="allSelected" @change="selectAll(($event.target as HTMLInputElement).checked)" />Выбрать все</label>
            <button class="b sec sm" @click="expandAll">{{ allExpanded ? `▾ Скрыть коммиты в ${rs.devBranch} (для всех)` : `▸ Показать коммиты в ${rs.devBranch} (для всех)` }}</button>
            <JiraReleasePicker :model-value="rs.jiraRelease" :busy="relBusy" :info="rs.jiraReleaseInfo" @update:model-value="onRelease" />
          </div>
          <div v-if="rs.branches.length" class="bgrid bhead">
            <span></span><span>Ветка и последний коммит</span><span class="r">Изменения</span>
          </div>
          <div ref="listEl" class="blist">
            <div class="lrail" :style="{ height: `${listRail.h}px` }"><svg width="22" :height="listRail.h" style="overflow: visible" v-html="listRail.svg"></svg></div>
            <div v-for="b in rs.branches" :key="b.ref" class="bgrid brow" :class="{ remote: b.isRemote }">
              <span></span>
              <div class="binfo">
                <input type="checkbox" :checked="rs.selected.has(b.ref)" @change="toggleSel(b.ref, ($event.target as HTMLInputElement).checked)" />
                <div class="bmain">
                  <div>
                    <span class="bname">{{ b.name }}</span>
                    <span v-if="status(b) === 'full'" class="badge inmain">уже в {{ rs.mainBranch }}</span>
                    <span v-else-if="status(b) === 'partial'" class="badge partial">частично в {{ rs.mainBranch }}</span>
                  </div>
                  <div class="sha mut">{{ b.lastCommitSha ? short(b.lastCommitSha) : '' }} · {{ fmtDate(b.lastCommitDate) }} · {{ b.lastCommitAuthor }} · {{ b.lastCommitSubject }}</div>
                  <div class="links">
                    <a v-if="b.taskUrl" @click="open(b.taskUrl)">Задача</a>
                    <a v-if="b.prUrl" @click="open(b.prUrl)">PR #{{ b.prNumber }}</a>
                    <a v-if="b.commitUrl" @click="open(b.commitUrl)">коммит</a>
                  </div>
                  <button class="lnk" @click="toggleExpand(b.ref)">{{ rs.expanded.has(b.ref) ? '▾ скрыть коммиты' : `▸ показать коммиты (относительно ${rs.devBranch}-ветки)` }}</button>
                  <template v-if="rs.expanded.has(b.ref)">
                    <div v-if="rs.commits.get(b.ref) === 'loading'" class="bcs mut"><span class="ld"></span>Загрузка коммитов…</div>
                    <template v-else-if="commitsOf(b.ref)">
                      <div v-if="commitsOf(b.ref)!.forkedFrom" class="bcs mut">Ветка заведена не от {{ rs.devBranch }}, а от <b>{{ commitsOf(b.ref)!.forkedFrom }}</b> — коммиты показаны относительно неё</div>
                      <div v-if="!commitsOf(b.ref)!.commits.length" class="bcs mut">Нет коммитов, отсутствующих в {{ rs.devBranch }}-ветке</div>
                      <div v-else class="bcs">
                        <div v-for="c in commitsOf(b.ref)!.commits" :key="c.sha" class="bc">
                          <span class="sha">{{ short(c.sha) }}</span> · {{ fmtDate(c.authorDate) }} · {{ c.authorName }} · {{ c.subject }}
                          <span v-if="c.alreadyInMain" class="badge inmain">уже в {{ rs.mainBranch }}</span>
                          <span class="links inl">
                            <a v-if="c.taskUrl" @click="open(c.taskUrl)">Задача</a>
                            <a v-if="c.commitUrl" @click="open(c.commitUrl)">коммит</a>
                            <span v-if="c.insertions || c.deletions" class="ds"><i>+{{ count(c.insertions) }}</i><u>-{{ count(c.deletions) }}</u></span>
                          </span>
                        </div>
                      </div>
                      <div v-if="commitsOf(b.ref)!.truncated" class="bcs mut">Показаны не все коммиты — возможно, {{ rs.devBranch }}-ветка сильно отстала</div>
                    </template>
                  </template>
                </div>
              </div>
              <div class="bdiff">
                <template v-if="rs.diffStats.has(b.ref)">
                  <span v-if="rs.diffStats.get(b.ref)!.insertions" class="add">+{{ count(rs.diffStats.get(b.ref)!.insertions) }}</span>
                  <span v-if="rs.diffStats.get(b.ref)!.deletions" class="del">-{{ count(rs.diffStats.get(b.ref)!.deletions) }}</span>
                  <span v-if="rs.diffStats.get(b.ref)!.filesChanged" class="mut fc">({{ rs.diffStats.get(b.ref)!.filesChanged }} файл(ов))</span>
                </template>
                <span v-else class="ld"></span>
              </div>
            </div>
            <div v-if="!rs.branches.length" class="empty mut">
              <template v-if="rs.listInfo.startsWith('Загрузка')"><span class="ld"></span>Загрузка веток…</template>
              <template v-else>Ничего не найдено (проверьте фильтр или переключатели выше)</template>
            </div>
          </div>
          <div class="info mut">
            <template v-if="searching"><span class="ld"></span>Обновление списка веток…</template>
            <template v-else>Показано {{ rs.listInfo }}.</template>
          </div>
          <div class="selsum">
            <template v-if="selectedList.length">
              <button class="clr" title="Очистить выбранное" @click="rs.selected = new Set()">×</button>
              <span class="mut">Выбрано ({{ selectedList.length }}):</span>
              <span v-for="s in selectedList" :key="s.ref" class="chip" :style="{ background: colorFor(s.name) }">{{ s.name }}<button class="cx" title="Убрать из выбора" @click="toggleSel(s.ref, false)">×</button></span>
            </template>
            <span v-else class="mut">Ветки не выбраны</span>
          </div>
          <div class="brow-btns">
            <button class="b pri" :disabled="rs.busy.plan" @click="buildPlan"><span v-if="rs.busy.plan" class="ld"></span>{{ rs.busy.plan ? 'Строим хронологию и проверяем конфликты…' : 'Построить хронологию выбранных веток' }}</button>
          </div>
        </div>
      </section>

      <!-- 2. chronology -->
      <section class="card">
        <div class="ch" @click="cards.chrono = !cards.chrono">
          <span class="num">2</span>
          <div class="cht">
            <h3>Хронология коммитов</h3>
            <div class="cd">Проверьте порядок коммитов перед сборкой релиза.</div>
          </div>
          <div class="chx">
            <button v-if="inSync !== null || rs.busy.plan" class="ib sync" :class="inSync ? 'ok' : 'bad'" :title="inSync ? 'Хронология соответствует текущему выбору веток' : 'Выбор веток изменился — нажмите, чтобы перестроить'" @click.stop="buildPlan">
              <span v-if="rs.busy.plan" class="ld"></span><Icon v-else name="refresh" :size="15" />
            </button>
            <template v-if="items.length">
              <span v-if="!summary.conflicts && !summary.conditional" class="cst ok">Конфликты: 0 ✓</span>
              <template v-else>
                <span v-if="summary.conflicts" class="cst bad">Конфликты: {{ summary.conflicts }} ⚠</span>
                <span v-if="summary.conditional" class="cst cond">? {{ summary.conditional }} возможных</span>
              </template>
            </template>
            <button v-if="plan" class="b sec sm" @click.stop="clearPlan">Очистить</button>
            <span class="arr">{{ cards.chrono ? '▸' : '▾' }}</span>
          </div>
        </div>
        <div v-show="!cards.chrono">
          <button v-if="items.length && (contextCount || plan?.anchorCommit)" class="b sec sm ctxb" @click="rs.contextCollapsed = !rs.contextCollapsed">
            {{ rs.contextCollapsed ? `▸ показать контекстные коммиты ${rs.devBranch} (${contextCount}${plan?.contextCommitsTruncated ? '+' : ''})` : `▾ скрыть контекстные коммиты ${rs.devBranch}` }}
          </button>

          <!-- forgotten branches -->
          <div v-if="plan && items.length && (rs.staleLoading || rs.staleHints)" class="stale">
            <div class="mut stc">
              Окно поиска — последние <input type="number" min="1" :value="rs.lookback" @change="setLookback(($event.target as HTMLInputElement).value)" /> релиз(ов)<template v-if="rs.patternCount !== null"> из {{ rs.patternCount }}</template>. Изменение применится при следующем построении хронологии.
            </div>
            <div v-if="rs.staleLoading" class="mut"><span class="ld"></span>Проверяем, нет ли забытых или не выбранных в релиз веток…</div>
            <div v-else-if="!rs.staleHints?.length" class="mut">Забытых или давно не выбранных в релиз веток не нашлось.</div>
            <template v-else>
              <div class="mut sti">Отсоединились раньше самого свежего коммита среди уже выбранных веток в этой хронологии, либо не выбраны в релиз в пределах окна последних релизов, и ещё не выпущены — возможно, забыли:</div>
              <div v-for="h in rs.staleHints" :key="h.ref" class="str">
                → <span class="chip" :style="{ background: colorFor(h.branch) }">{{ h.branch }}</span>
                <button class="add" :class="{ added: rs.selected.has(h.ref) }" :disabled="rs.selected.has(h.ref)" title="Добавить в релиз" @click="addStale(h.ref)">{{ rs.selected.has(h.ref) ? '✓' : '+' }}</button>
                — «{{ h.subject }}», <a @click="open(h.commitUrl)">{{ short(h.sha) }}</a> · {{ h.authorName }} · {{ fmtDate(h.authorDate) }}<template v-if="h.taskUrl"> · <a @click="open(h.taskUrl)">задача</a></template>
              </div>
            </template>
          </div>

          <div v-if="!items.length" class="mut empty">
            <template v-if="rs.busy.plan"><span class="ld"></span>Строим хронологию…</template>
            <template v-else>Постройте хронологию, чтобы увидеть коммиты</template>
          </div>
          <div v-else class="cscroll">
            <div class="cinner" :style="{ '--rail': `${railW}px`, minWidth: `${railW + 420 + 160}px` }">
              <div class="trow thead">
                <span></span><span>Ветка</span><span>Коммит</span><span>Дата</span><span>Автор</span>
              </div>
              <div ref="rowsEl" class="rows">
                <div class="railo" :style="{ width: `${railW}px`, height: `${railH}px` }" @mouseover="onRailOver" @mouseleave="onRailOver">
                  <svg :width="railW" :height="railH" style="overflow: visible" v-html="railSvg"></svg>
                </div>
                <template v-for="(r, ri) in rows" :key="ri">
                  <div v-if="r.kind === 'mergeMarker' && rs.contextCollapsed" class="trow hidden"></div>
                  <div v-else-if="r.kind === 'item'" class="trow">
                    <span></span>
                    <div class="cell cbr">
                      <input type="checkbox" :checked="r.item.included" :disabled="r.item.applied" @change="toggleItem(r.item, ($event.target as HTMLInputElement).checked)" />
                      <span class="lane" :style="{ background: colorFor(r.item.branch) }">{{ r.item.branch }}</span>
                    </div>
                    <div class="cell ccm">
                      <div>{{ r.item.subject }}</div>
                      <span class="sha">{{ short(r.item.sha) }}</span>
                      <div class="links">
                        <a v-if="r.item.taskUrl" @click="open(r.item.taskUrl)">Задача</a>
                        <a v-if="r.item.prUrl" @click="open(r.item.prUrl)">PR #{{ r.item.prNumber }}</a>
                        <a v-if="r.item.commitUrl" @click="open(r.item.commitUrl)">коммит</a>
                      </div>
                      <div>
                        <span v-if="r.item.applied" class="badge applied">применён</span>
                        <span v-if="r.item.dryRunStatus === 'ok'" class="badge ok">конфликтов нет</span>
                        <span v-else-if="r.item.dryRunStatus === 'empty'" class="badge inmain">уже применено (пустой cherry-pick)</span>
                        <span v-else-if="r.item.dryRunStatus === 'conflict'" class="badge conflict">⚠ конфликт ({{ r.item.dryRunConflictFiles.length }} файл(ов))</span>
                        <span v-else-if="r.item.dryRunStatus === 'conditional'" class="badge cond">? возможен конфликт ({{ r.item.dryRunConflictFiles.length }} файл(ов))</span>
                        <span v-if="r.item.overlapsWith?.length" class="badge overlap">пересекается с: {{ overlapNames(r.item) }}</span>
                        <span v-if="r.item.alreadyInMain" class="badge inmain">уже в {{ rs.mainBranch }}</span>
                      </div>
                      <!-- a real conflict -->
                      <template v-if="r.item.dryRunStatus === 'conflict'">
                        <div v-if="!r.item.dryRunConflictSources?.length" class="cdet mut">Файлы: {{ r.item.dryRunConflictFiles.join(', ') }}</div>
                        <div v-else class="cdet">
                          <div v-for="s in r.item.dryRunConflictSources" :key="s.file" class="cfb">
                            <div class="cf">
                              <span class="cft" @click="flipConflict(r.item.sha + '|' + s.file)"><span class="ca">{{ rs.expandedConflicts.has(r.item.sha + '|' + s.file) ? '▾' : '▸' }}</span> <b>{{ s.file }}</b></span>
                              —
                              <template v-if="s.analysisPending">причина ещё считается фоном…</template>
                              <template v-else-if="!s.sha">файла нет в истории основной ветки (вероятно, его создаёт сам этот коммит)</template>
                              <template v-else>
                                конфликтующие строки последним менял: <template v-if="whoBranch(s)">ветка <b>{{ whoBranch(s) }}</b></template><template v-else>уже в основной ветке</template>,
                                <a @click="open(s.commitUrl)">{{ short(s.sha) }}</a><template v-if="s.subject"> «{{ s.subject }}»</template><template v-if="s.authorName"> · {{ s.authorName }}</template><template v-if="s.authorDate"> · {{ fmtDate(s.authorDate) }}</template>
                              </template>
                            </div>
                            <div v-if="rs.expandedConflicts.has(r.item.sha + '|' + s.file)" class="cfbody">
                              <div v-if="s.analysisPending" class="mut"><span class="ld"></span>Загружаем причину конфликта…</div>
                              <template v-else>
                                <template v-for="(h, hi) in s.hunks" :key="hi">
                                  <div class="hunk">
                                    <div class="hside">
                                      <span class="mut hl">{{ rs.mainBranch }} (текущая){{ h.oursStartLine !== null ? ', строка ' + h.oursStartLine : '' }}:</span>
                                      <div class="code">
                                        <div v-for="(l, li) in h.oursText" :key="li" class="line" :data-line="h.oursStartLine !== null ? h.oursStartLine + li : ''">{{ l }}</div>
                                        <div v-if="!h.oursText.length" class="line mut">(пусто — {{ rs.mainBranch }} тут ничего не меняет)</div>
                                      </div>
                                    </div>
                                    <div class="hside">
                                      <span class="mut hl">входящий коммит{{ h.theirsStartLine !== null ? ', строка ' + h.theirsStartLine : '' }}:</span>
                                      <div class="code">
                                        <div v-for="(l, li) in h.theirsText" :key="li" class="line" :data-line="h.theirsStartLine !== null ? h.theirsStartLine + li : ''">{{ l }}</div>
                                        <div v-if="!h.theirsText.length" class="line mut">(пусто — входящий коммит удаляет это место)</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div v-if="h.sameContent" class="div ok">✓ Различий по сути нет (пробелы/пустые строки не в счёт) — конфликт из-за контекста слияния. Можно принять любую сторону.</div>
                                </template>
                                <div v-if="s.sha && s.taskDivergence" class="div" :class="s.taskDivergence.contentMatch === 'different' ? 'warn' : 'ok'">
                                  <template v-if="s.taskDivergence.contentMatch === 'different'">⚠ Задача {{ s.taskDivergence.taskKey }} также реализована на dev отдельным коммитом (</template>
                                  <template v-else>✓ Похоже, задача {{ s.taskDivergence.taskKey }} уже реализована на dev отдельным коммитом (</template>
                                  <a @click="open(s.taskDivergence.otherCommitUrl)">{{ short(s.taskDivergence.otherSha) }}</a> «{{ s.taskDivergence.otherSubject }}» · {{ s.taskDivergence.otherAuthorName }} · {{ fmtDate(s.taskDivergence.otherAuthorDate) }})
                                  <template v-if="s.taskDivergence.contentMatch === 'different'">, но содержимое отличается — разрешайте вручную.</template>
                                  <template v-else> — {{ s.taskDivergence.contentMatch === 'identical' ? 'содержимое совпадает' : 'отличается только пробелами/пустыми строками' }}. Можно принять любую сторону.</template>
                                </div>
                              </template>
                            </div>
                          </div>
                        </div>
                        <template v-if="!pending(r.item)">
                          <div v-if="r.item.alreadyInMain" class="hint">Похоже, эта задача уже выпущена в {{ rs.mainBranch }} — возможно, проще исключить её из релиза, а не разрешать конфликт.</div>
                          <template v-else-if="causesOf(r.item).length">
                            <div class="hint">Возможно, дело не в противоречащих правках, а в забытой задаче — эти ветки тоже меняют конфликтующий файл и ещё не выпущены:</div>
                            <div v-for="c in causesOf(r.item)" :key="c.branch" class="cause">
                              → <b>{{ c.branch }}</b>
                              <button class="add" :class="{ added: rs.selected.has(c.ref) }" :disabled="rs.selected.has(c.ref)" title="Добавить в релиз" @click="addStale(c.ref)">{{ rs.selected.has(c.ref) ? '✓' : '+' }}</button>
                              — «{{ c.subject }}», <a @click="open(c.commitUrl)">{{ short(c.sha) }}</a> · {{ c.authorName }} · {{ fmtDate(c.authorDate) }}<template v-if="c.taskUrl"> · <a @click="open(c.taskUrl)">задача</a></template>
                            </div>
                          </template>
                          <div v-else class="hint mut">Других веток, трогающих этот файл и ещё не выпущенных, не нашлось — похоже, конфликт придётся разрешить вручную.</div>
                        </template>
                      </template>
                      <div v-else-if="r.item.dryRunStatus === 'conditional'" class="cond-det">
                        Не проверено — зависит от конфликта
                        <a v-for="bl in blockers(r.item)" :key="bl.sha" @click="open(bl.commitUrl)">{{ short(bl.sha) }} </a>
                        по {{ r.item.dryRunConflictFiles.join(', ') }}.
                      </div>
                    </div>
                    <div class="cell cdate">{{ fmtDate(r.item.authorDate) }}</div>
                    <div class="cell cauth" :title="r.item.authorName">
                      <div>{{ r.item.authorName }}</div>
                      <span v-if="r.item.insertions || r.item.deletions" class="ds"><i v-if="r.item.insertions">+{{ count(r.item.insertions) }}</i><u v-if="r.item.deletions">-{{ count(r.item.deletions) }}</u></span>
                    </div>
                  </div>
                  <div v-else class="trow ctx">
                    <span></span>
                    <div class="cell cbr"><span class="lane dev">{{ rs.devBranch }}</span></div>
                    <div class="cell ccm">
                      <div>{{ subjectOf(r) }}<span v-if="r.kind === 'anchor'" class="mut"> — последний коммит {{ rs.devBranch }} перед началом хронологии</span></div>
                      <span class="sha">{{ short(r.commit.sha) }}</span>
                      <div class="links">
                        <a v-if="r.commit.taskUrl" @click="open(r.commit.taskUrl)">Задача</a>
                        <a v-if="r.kind === 'mergeMarker' && r.commit.prUrl" @click="open(r.commit.prUrl)">PR #{{ r.commit.prNumber }}</a>
                        <a v-if="r.commit.commitUrl" @click="open(r.commit.commitUrl)">коммит</a>
                      </div>
                    </div>
                    <div class="cell cdate">{{ fmtDate(r.commit.authorDate) }}</div>
                    <div class="cell cauth">{{ r.commit.authorName }}</div>
                  </div>
                </template>
              </div>
              <div v-if="summary.commits" class="csum">
                <span>{{ summary.commits }} коммит(ов)</span><i>·</i><span>{{ summary.branches }} веток</span><i>·</i><span>{{ summary.authors }} авторов</span><i>·</i>
                <span class="ds"><i>+{{ count(summary.ins) }}</i><u>-{{ count(summary.del) }}</u></span><i>·</i><span>{{ summary.files }} файлов</span>
                <template v-if="summary.conflicts"><i>·</i><span class="badge conflict">⚠ {{ summary.conflicts }} конфликт(ов)</span></template>
                <template v-if="summary.conditional"><i>·</i><span class="badge cond">? {{ summary.conditional }} возможных</span></template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. cherry-pick by hand -->
      <section v-if="pendingItems.length" class="card">
        <div class="ch" @click="cards.cherry = !cards.cherry">
          <span class="num">{{ cardNo('cherry') }}</span>
          <div class="cht"><h3>Команда для ручного cherry-pick</h3></div>
          <div class="chx">
            <button class="b sec sm" @click.stop="rs.copied = new Set()">Сбросить состояние копирования</button>
            <span class="arr">{{ cards.cherry ? '▸' : '▾' }}</span>
          </div>
        </div>
        <div v-show="!cards.cherry">
          <div v-for="(seg, si) in segments" :key="segKey(seg)" class="cmd" :class="{ copied: rs.copied.has(segKey(seg)) }">
            <div class="cmdh">
              <span class="mut">{{ segments.length > 1 ? `Команда ${si + 1} из ${segments.length}` : 'Команда' }}<template v-if="seg[seg.length - 1].dryRunStatus === 'conflict'"> — заканчивается конфликтом</template><template v-else-if="seg[seg.length - 1].dryRunStatus === 'conditional'"> — заканчивается непроверенным коммитом (возможен конфликт)</template></span>
              <button class="b sec" @click="copySeg(seg)">Копировать</button>
            </div>
            <div class="cmdb">
              <span class="pre">git cherry-pick</span>
              <template v-for="it in seg" :key="it.sha"><a class="csha" :class="it.dryRunStatus" :style="{ background: colorFor(it.branch) }" :title="`${it.branch} · ${it.subject}`" @click="open(it.commitUrl)">{{ short(it.sha) }}</a>{{ ' ' }}</template>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. build -->
      <section class="card">
        <div class="ch" @click="cards.build = !cards.build">
          <span class="num">{{ cardNo('build') }}</span>
          <div class="cht"><h3>Сборка релизной ветки</h3></div>
          <div class="chx"><span class="arr">{{ cards.build ? '▸' : '▾' }}</span></div>
        </div>
        <div v-show="!cards.build">
          <div class="frow2">
            <label>Дата релиза (для имени релизной ветки):</label>
            <input v-model="rs.releaseDate" class="din" type="text" />
            <button class="ib" title="Сбросить на сегодняшнюю дату" @click="rs.releaseDate = today()"><Icon name="refresh" :size="14" /></button>
          </div>
          <div class="brow-btns">
            <button class="b blue" :disabled="createDisabled" @click="createBranch"><span v-if="rs.busy.create" class="ld"></span>{{ rs.busy.create ? 'Создаём…' : 'Создать релизную ветку' }}</button>
            <span class="mut">
              <template v-if="hasRelease">Релизная ветка: {{ plan!.releaseBranch }}</template>
              <template v-else-if="rs.dateCheck.exists">Ветка "{{ rs.dateCheck.branchName }}" уже существует — используйте «Начать сборку»</template>
              <template v-else>Релизная ветка ещё не создана</template>
            </span>
          </div>
          <div v-if="rs.releaseInfo && !items.length" class="rinfo mut">
            <div v-if="!rs.releaseInfo.commits.length">{{ rs.releaseInfo.note }}</div>
            <template v-else>
              <div>Уже в ветке {{ rs.releaseInfo.releaseBranch }} (плана нет — выберите те же ветки и постройте хронологию, чтобы увидеть полную картину):</div>
              <div v-for="c in rs.releaseInfo.commits" :key="c.sha">→ «{{ c.subject }}», <a @click="open(c.commitUrl)">{{ short(c.sha) }}</a> · {{ c.authorName }} · {{ fmtDate(c.authorDate) }}<template v-if="c.taskUrl"> · <a @click="open(c.taskUrl)">задача</a></template></div>
            </template>
          </div>
          <div class="brow-btns gap">
            <button class="b green" :disabled="!hasPendingBuild || rs.busy.start" @click="startAuto"><span v-if="rs.busy.start" class="ld"></span>{{ rs.busy.start ? 'Собираем…' : appliedCount ? 'Продолжить сборку' : 'Начать сборку' }}</button>
            <button class="b red" @click="send({ command: 'abortBuild' })">Отменить сборку</button>
          </div>
          <div class="mut bst">
            <template v-if="rs.published"><span class="okc">✓ Релизная ветка опубликована (запушена в remote).</span></template>
            <template v-else-if="hasRelease && !hasItems">В хронологии нет коммитов.</template>
            <template v-else-if="hasItems && !included.length">В хронологии нет отмеченных коммитов.</template>
            <template v-else-if="hasItems && appliedCount === included.length"><span class="okc">✓ Релиз собран — применено {{ included.length }} из {{ included.length }} коммитов.</span></template>
            <template v-else-if="hasItems">Применено {{ appliedCount }} из {{ included.length }} коммитов.</template>
          </div>
          <div v-if="hasItems && included.length && appliedCount === included.length && !rs.published" class="brow-btns">
            <button class="b pri" :disabled="rs.busy.publish" @click="publish"><span v-if="rs.busy.publish" class="ld"></span>{{ rs.busy.publish ? 'Публикуем…' : 'Опубликовать релизную ветку' }}</button>
          </div>
        </div>
      </section>
    </div>

    <!-- the projects -->
    <Teleport to="body">
      <div v-if="managerOpen" class="rm-back" @pointerdown.self="managerOpen = false">
        <div class="rm">
          <div class="rmh">
            <b>Проекты</b>
            <span class="sp"></span>
            <button class="rib" title="Новый" @click="editProject()"><Icon name="plus" :size="14" /></button>
            <button class="rib" title="Закрыть" @click="managerOpen = false"><Icon name="x" :size="14" /></button>
          </div>
          <div v-for="p in rs.projects" :key="p.id" class="prow" :class="{ on: p.id === rs.projectId }">
            <div class="pinfo" @click="(managerOpen = false), openProject(p.id, true)">
              <b>{{ p.name }}</b><small>{{ p.repositoryPath }}</small>
            </div>
            <template v-if="delAsk === p.id">
              <button class="rbtn red" @click="removeProject(p.id)">Удалить</button>
              <button class="rbtn" @click="delAsk = ''">Нет</button>
            </template>
            <template v-else>
              <button class="rib" title="Изменить" @click="editProject(p)"><Icon name="pencil" :size="13" /></button>
              <button class="rib" title="Удалить" @click="delAsk = p.id"><Icon name="trash" :size="13" /></button>
            </template>
          </div>
          <p v-if="!rs.projects.length && !form" class="rmut">Добавьте проект — git-репозиторий, из веток которого собирается релиз</p>
          <form v-if="form" class="pform" @submit.prevent="saveForm">
            <label class="w2">Имя <input v-model="form.name" placeholder="my-project" /></label>
            <label class="w2">Репозиторий
              <span class="row"><input v-model="form.repositoryPath" placeholder="C:\path\to\repo" /><button type="button" class="rib" title="Выбрать папку" @click="pickFolder"><Icon name="folderOpen" :size="14" /></button></span>
            </label>
            <label>Основная ветка <input v-model="form.mainBranch" placeholder="main" /></label>
            <label>Dev-ветка <input v-model="form.devBranch" placeholder="dev" /></label>
            <label>Remote <input v-model="form.remoteName" placeholder="origin" /></label>
            <label>Релизная ветка <input v-model="form.releaseBranchPattern" placeholder="release/release-{date}" /></label>
            <label class="w2">Служебные префиксы <input v-model="form.prefixes" placeholder="qa, revert-pr-, chore/" /></label>
            <label>Веток в списке <input v-model.number="form.branchListLimit" type="number" min="1" /></label>
            <label>Окно забытых (релизов) <input v-model.number="form.staleBranchesLookbackReleases" type="number" min="1" /></label>
            <label class="w2 ckl"><input v-model="form.hideDuplicateRemoteBranches" type="checkbox" />Скрывать remote-ветку, если есть локальная</label>
            <label class="w2">Ссылка на задачу <input v-model="form.taskTrackerBaseUrl" placeholder="https://company.atlassian.net/browse" /></label>
            <label>Bitbucket workspace <input v-model="form.bitbucketWorkspace" /></label>
            <label>Bitbucket repo <input v-model="form.bitbucketRepoSlug" placeholder="по имени папки" /></label>
            <p v-if="formError" class="ferr w2">{{ formError }}</p>
            <div class="w2 fact">
              <button type="button" class="rbtn" @click="form = null">Отмена</button>
              <button type="submit" class="rbtn pri">Сохранить проект</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.rel {
  --c-green: var(--up);
  --c-red: var(--down);
  --c-yellow: var(--warn-fg);
  --c-orange: #fb923c;
  --c-blue: var(--info);
  --c-purple: var(--accent);
  --link: var(--info-fg);
  --rad: 8px;
  --rad-sm: 5px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  font-size: 13px;
}
.mut {
  color: var(--muted);
  font-size: 12px;
}
a {
  color: var(--link);
  cursor: pointer;
  text-decoration: underline;
}
/* the one spinner of the section: a ring that turns (never the button under it) */
.ld {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  vertical-align: -1px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: currentColor;
  animation: qspin 0.8s linear infinite;
}
.ib .ld {
  margin: 0;
}
@keyframes qspin {
  to {
    transform: rotate(360deg);
  }
}
/* buttons */
.b {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--rad-sm);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
}
.b:hover:not(:disabled) {
  filter: brightness(1.12);
}
.b:disabled {
  opacity: 0.5;
  cursor: default;
}
.b.sec {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.b.sm {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.b.blue {
  background: var(--accent);
}
.b.green {
  background: var(--up);
}
.b.red {
  background: var(--down);
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.4;
}
.ib.sync.ok {
  color: var(--c-green);
}
.ib.sync.bad {
  color: var(--c-red);
}
.err {
  position: sticky;
  top: -14px;
  z-index: 6;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 14px;
  padding: 8px 10px;
  border-radius: var(--rad-sm);
  border: 1px solid rgba(255, 61, 61, 0.55);
  background: var(--panel);
  color: var(--down-fg);
}
.err .et {
  flex: 1;
  white-space: pre-wrap;
}
.ex {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  opacity: 0.7;
  cursor: pointer;
}
.ex:hover {
  opacity: 1;
}
/* cards */
.card {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: var(--rad);
  border: 1px solid var(--border);
  background: var(--panel);
}
.gitbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.fi {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fi label {
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
select,
input[type='text'],
input[type='number'] {
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--rad-sm);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}
select option {
  background: var(--panel-2);
}
.fi select {
  min-width: 200px;
  max-width: 320px;
}
.acts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.pop {
  position: relative;
}
.pname {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.pname:hover,
.pname.on {
  background: rgba(255, 255, 255, 0.06);
}
.pd {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: 340px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.pi {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.pi:hover:not(:disabled) {
  background: rgb(var(--accent-rgb) / 0.16);
}
.pi.on {
  color: var(--accent-fg);
}
.pi:disabled {
  opacity: 0.4;
}
.pn {
  flex: none;
}
.pi small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.sep {
  margin: 4px 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.ch {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
}
.num {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 600;
}
.cht {
  flex: 1;
  min-width: 0;
}
.cht h3 {
  margin: 0;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
.cd {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 11px;
}
.chx {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin-top: 1px;
}
.arr {
  width: 10px;
  color: var(--muted);
  font-size: 10px;
  text-align: center;
}
.cst {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
}
.cst.ok {
  background: color-mix(in srgb, var(--c-green) 20%, transparent);
  color: var(--c-green);
}
.cst.bad {
  background: var(--c-red);
  color: var(--text-hi);
}
.cst.cond {
  background: var(--c-yellow);
  color: #000;
}
/* 1. branches */
.frow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  font-size: 12px;
}
.sf {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 1 260px;
  color: var(--muted);
}
.sf :deep(svg) {
  position: absolute;
  left: 8px;
  pointer-events: none;
}
.sf input {
  width: 100%;
  padding-left: 28px;
}
.sw {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.sw input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.sw .tr {
  position: relative;
  flex: none;
  width: 30px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}
.sw .tr::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--muted);
  transition:
    transform 0.15s ease,
    background-color 0.15s ease;
}
.sw input:checked + .tr {
  border-color: var(--accent);
  background: var(--accent);
}
.sw input:checked + .tr::after {
  transform: translateX(14px);
  background: var(--text-hi);
}
.sw input:focus-visible + .tr {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.lim {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  white-space: nowrap;
}
.arow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.ck {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
input[type='checkbox'] {
  margin: 0;
  accent-color: var(--accent);
}
.bgrid {
  display: grid;
  grid-template-columns: 22px minmax(160px, 1fr) 96px;
  align-items: stretch;
}
.bhead {
  padding-bottom: 4px;
  margin-top: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.bhead > span:nth-child(2) {
  padding: 0 8px;
}
.bhead .r {
  padding: 0 8px;
  text-align: right;
}
.blist {
  position: relative;
  height: 280px;
  min-height: 120px;
  margin-top: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--rad-sm);
}
.lrail {
  position: absolute;
  top: 0;
  left: 0;
  width: 22px;
  pointer-events: none;
}
.brow {
  padding: 5px 0;
  border-bottom: 1px dashed var(--border);
}
.brow:last-of-type {
  border-bottom: none;
}
.binfo {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 0 8px;
}
.binfo > input {
  margin-top: 3px;
}
.bmain {
  flex: 1;
  min-width: 0;
}
.bname {
  font-family: var(--font-data);
  font-size: 11.5px;
  font-weight: 500;
  word-break: break-all;
}
.brow.remote .bname::after {
  content: ' (remote)';
  opacity: 0.5;
  font-size: 10px;
}
.sha {
  font-family: var(--font-data);
  font-size: 11px;
  opacity: 0.85;
}
.sha.mut {
  color: var(--muted);
  word-break: break-word;
}
.links a {
  margin-right: 8px;
  font-size: 11px;
  text-decoration: none;
}
.links a:hover {
  text-decoration: underline;
}
.links.inl {
  margin-left: 4px;
}
.lnk {
  padding: 0;
  border: 0;
  background: none;
  color: var(--link);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
.bcs {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid var(--border);
}
.bc {
  padding: 2px 0;
  font-size: 11px;
}
.bdiff {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 3px 8px;
  font-family: var(--font-data);
  font-size: 11px;
}
.bdiff .fc {
  font-family: inherit;
  font-size: 10px;
}
.add {
  color: var(--c-green);
}
.del {
  color: var(--c-red);
}
.ds {
  display: inline-flex;
  gap: 4px;
  font-family: var(--font-data);
  font-size: 11px;
}
.ds i {
  font-style: normal;
  color: var(--c-green);
}
.ds u {
  text-decoration: none;
  color: var(--c-red);
}
.empty {
  display: flex;
  align-items: center;
  padding: 8px;
}
.info {
  margin-top: 6px;
}
.selsum {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
}
.clr {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--c-red);
  color: var(--text-hi);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.clr:hover {
  filter: brightness(1.15);
}
.chip {
  display: inline-flex;
  align-items: center;
  margin: 2px 4px 2px 0;
  padding: 2px 8px;
  border-radius: var(--rad-sm);
  color: #000;
  font-size: 11px;
}
.cx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cx:hover {
  background: rgba(0, 0, 0, 0.15);
}
.brow-btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.brow-btns.gap {
  margin-top: 12px;
}
/* 2. chronology */
.ctxb {
  margin-bottom: 6px;
}
.stale {
  margin-top: 8px;
  font-size: 11.5px;
}
.stc {
  margin-bottom: 4px;
}
.stc input {
  width: 3.4em;
  height: 22px;
}
.sti {
  margin: 4px 0;
}
.str {
  padding: 3px 0;
  border-bottom: 1px dashed var(--border);
}
button.add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0 2px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--c-green);
  color: #000;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  cursor: pointer;
}
button.add:hover {
  filter: brightness(1.15);
}
button.add.added,
button.add:disabled {
  background: transparent;
  color: var(--c-green);
  cursor: default;
  opacity: 0.8;
}
.cscroll {
  margin-top: 4px;
  overflow-x: auto;
  overflow-y: hidden;
}
.trow {
  display: grid;
  grid-template-columns: var(--rail, 18px) 152px minmax(160px, 1fr) 144px 124px;
  align-items: stretch;
  border-bottom: 1px dashed var(--border);
}
.thead {
  padding-bottom: 4px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--border);
}
.thead span {
  padding: 3px 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.trow.hidden {
  min-height: 0;
  border-bottom: none;
}
.rows {
  position: relative;
}
.rows > .trow:last-child {
  border-bottom: none;
}
.railo {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  pointer-events: none;
}
.railo :deep(.rl) {
  fill: none;
  stroke-width: 2;
  transition:
    opacity 0.1s ease,
    stroke-width 0.1s ease;
}
.railo :deep(.rh) {
  fill: var(--panel);
}
.railo :deep(circle[data-branch]) {
  pointer-events: auto;
  cursor: pointer;
  transition: opacity 0.1s ease;
}
.railo :deep(.dim) {
  opacity: 0.2;
}
.railo :deep(.hot.rl) {
  stroke-width: 3.5;
}
.cell {
  min-width: 0;
  padding: 3px 8px;
}
.cbr {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.cbr input {
  margin-top: 3px;
}
.lane {
  flex: 1 1 auto;
  min-width: 0;
  padding: 1px 6px;
  border-radius: var(--r2);
  color: #000;
  font-size: 11px;
  text-align: center;
  overflow-wrap: break-word;
  word-break: break-word;
}
.ctx {
  opacity: 0.55;
  font-size: 11px;
}
.lane.dev {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text);
}
.badge {
  display: inline-block;
  margin: 2px 4px 0 0;
  padding: 1px 6px;
  border-radius: var(--r2);
  font-size: 11px;
}
.badge.ok {
  background: var(--c-green);
  color: #000;
}
.badge.conflict {
  background: var(--c-red);
  color: var(--text-hi);
}
.badge.cond {
  background: var(--c-yellow);
  color: #000;
}
.badge.applied {
  background: var(--c-blue);
  color: var(--text-hi);
}
.badge.inmain {
  background: var(--c-purple);
  color: #000;
}
.badge.partial {
  background: var(--c-yellow);
  color: #000;
}
.badge.overlap {
  background: var(--c-orange);
  color: #000;
}
.cdet {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--c-red);
}
.cfb + .cfb {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.cf {
  padding: 2px 0;
  font-size: 11px;
}
.cft {
  cursor: pointer;
  user-select: none;
}
.cft:hover {
  text-decoration: underline;
}
.ca {
  display: inline-block;
  width: 12px;
}
.cfbody {
  container-type: inline-size;
}
.hunk {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 2px 8px;
}
.hside {
  flex: 1 1 240px;
  min-width: 200px;
}
.hside .hl {
  font-size: 10px;
}
@container (max-width: 420px) {
  .hunk + .hunk {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border);
  }
}
.code {
  max-height: 160px;
  margin: 2px 0 0;
  overflow-y: auto;
  padding: 4px 0;
  border-radius: var(--r2);
  background: var(--bg);
  font-family: var(--font-data);
  font-size: 11px;
}
.line {
  position: relative;
  padding: 0 6px 0 34px;
  white-space: pre-wrap;
  word-break: break-word;
}
.line::before {
  content: attr(data-line);
  position: absolute;
  left: 6px;
  width: 24px;
  color: var(--border-3);
  text-align: right;
  user-select: none;
}
.line.mut {
  padding-left: 6px;
  font-style: italic;
}
.line.mut::before {
  content: none;
}
.div {
  padding: 2px 0 2px 8px;
  font-size: 11px;
}
.div.ok {
  color: var(--c-green);
}
.div.warn {
  color: var(--c-orange);
}
.hint {
  padding: 3px 0;
  font-size: 11px;
}
.cause {
  padding: 2px 0 2px 8px;
  font-size: 11px;
}
.cond-det {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--c-yellow);
  font-size: 11px;
}
.cdate {
  font-family: var(--font-data);
  font-size: 11px;
  opacity: 0.8;
  white-space: nowrap;
}
.cauth {
  font-size: 11px;
  opacity: 0.85;
}
.cauth > div:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cauth .ds {
  display: flex;
  margin-top: 2px;
}
.csum {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  opacity: 0.85;
}
.csum > i {
  margin: 0 -8px;
  font-style: normal;
  opacity: 0.5;
}
/* 3. cherry-pick */
.cmd {
  margin-bottom: 10px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--rad-sm);
}
.cmd.copied {
  opacity: 0.45;
}
.cmdh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.cmdh .mut {
  font-size: 11px;
}
.cmdb {
  font-family: var(--font-data);
  font-size: 12px;
  line-height: 2;
  word-break: break-word;
}
.pre {
  margin-right: 6px;
  opacity: 0.8;
}
.csha {
  display: inline-block;
  margin: 1px 3px 1px 0;
  padding: 1px 6px;
  border: 2px solid transparent;
  border-radius: var(--rad-sm);
  color: #000;
  font-size: 11px;
  text-decoration: none;
  cursor: pointer;
}
.csha:hover {
  filter: brightness(1.12);
  text-decoration: underline;
}
.csha.conflict {
  border-color: var(--c-red);
}
.csha.conditional {
  border-color: var(--c-yellow);
}
/* 4. build */
.frow2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.din {
  width: 160px;
}
.rinfo {
  margin-top: 6px;
}
.bst {
  margin-top: 4px;
}
.okc {
  color: var(--c-green);
}
@media (max-width: 860px) {
  .trow {
    grid-template-columns: var(--rail, 18px) 120px minmax(160px, 1fr) 120px;
  }
  .trow > :nth-child(5) {
    display: none;
  }
  .lim {
    margin-left: 0;
  }
}
</style>

<style>
/* the projects window (teleported) */
.rm-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 60px;
  background: rgba(13, 17, 23, 0.5);
}
.rm {
  width: 620px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 90px);
  overflow: auto;
  padding: 10px 14px 14px;
  border-radius: var(--r3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  color: var(--text);
}
.rmh {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.rmh .sp {
  flex: 1;
}
.rib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.rib:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.rbtn {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.rbtn.pri {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}
.rbtn.red {
  border-color: transparent;
  background: var(--down);
  color: var(--text-hi);
}
.prow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
}
.prow:hover {
  background: rgba(255, 255, 255, 0.04);
}
.prow.on .pinfo b {
  color: var(--accent-fg);
}
.pinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  font-size: 12.5px;
}
.pinfo small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}
.pform {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.pform label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--muted);
  font-size: 11.5px;
}
.pform .w2 {
  grid-column: 1 / -1;
}
.pform input:not([type='checkbox']) {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
}
.pform .row {
  display: flex;
  gap: 4px;
}
.pform .row input {
  flex: 1;
}
.pform .ckl {
  flex-direction: row;
  align-items: center;
  gap: 7px;
}
.fact {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.ferr {
  margin: 4px 0;
  color: var(--down-fg);
  font-size: 12px;
}
.rmut {
  margin: 10px 4px;
  color: var(--muted);
  font-size: 12.5px;
}
</style>
