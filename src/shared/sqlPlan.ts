/**
 * A query's plan (EXPLAIN) of any of the databases as one tree — each step: what it does, on what, what was expected
 * and (when the query was run) what came, its own time — and what in it is slow or wrong, said in words.
 */
export interface PlanNode {
  /** What the step does (Seq Scan, Index Scan, Nested Loop, Sort…). */
  op: string
  /** On what: a table (its alias), an index. */
  on?: string
  /** Its conditions, keys, ways (Filter: …, Index Cond: …, Sort Key: …). */
  detail: string[]
  est?: { rows?: number; cost?: number }
  /** As it went: rows (all loops), its total time (all loops), loops. */
  act?: { rows?: number; ms?: number; loops?: number }
  /** Its own time: the step's minus its children's, ms. */
  selfMs?: number
  children: PlanNode[]
  /** Marks for the view: «полный просмотр», «на диске»… */
  flags: string[]
  /** PostgreSQL's facts the findings read: rows a filter dropped, a sort on disk, a hash in parts. */
  facts?: { removed?: number; filter?: string; disk?: boolean; sortKey?: string[]; batches?: number }
}
export interface Plan {
  root: PlanNode
  /** The query was run (ANALYZE): the times and rows are real. */
  analyzed: boolean
  planningMs?: number
  executionMs?: number
  findings: Array<{ level: 'warn' | 'info'; text: string }>
}
const node = (op: string, extra: Partial<PlanNode> = {}): PlanNode => ({ op, detail: [], children: [], flags: [], ...extra })
const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн` : n >= 1e4 ? `${Math.round(n / 1000)} тыс.` : String(Math.round(n)))
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} с` : `${n < 10 ? n.toFixed(1) : Math.round(n)} мс`)

// ---------- PostgreSQL: EXPLAIN (FORMAT JSON [, ANALYZE, BUFFERS]) ----------
type PgNode = Record<string, unknown> & { Plans?: PgNode[] }
export function pgPlan(json: unknown): Plan {
  const top = (Array.isArray(json) ? json[0] : json) as Record<string, unknown>
  const walk = (p: PgNode): PlanNode => {
    const loops = num(p['Actual Loops'])
    const n = node(String(p['Node Type'] ?? '?'), {
      on: [p['Relation Name'] ?? p['CTE Name'] ?? p['Function Name'], p['Index Name'] ? `индекс ${String(p['Index Name'])}` : undefined].filter(Boolean).join(' · ') || undefined,
      est: { rows: num(p['Plan Rows']), cost: num(p['Total Cost']) },
      ...(loops !== undefined ? { act: { rows: (num(p['Actual Rows']) ?? 0) * loops, ms: (num(p['Actual Total Time']) ?? 0) * loops, loops } } : {}),
    })
    if (p['Alias'] && p['Alias'] !== p['Relation Name']) n.on = `${n.on ?? ''} ${String(p['Alias'])}`.trim()
    if (p['Join Type']) n.op = `${n.op} (${String(p['Join Type'])})`
    for (const k of ['Index Cond', 'Recheck Cond', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Filter']) if (p[k]) n.detail.push(`${k}: ${String(p[k])}`)
    if (p['Rows Removed by Filter'] !== undefined) n.detail.push(`отброшено фильтром: ${fmt((num(p['Rows Removed by Filter']) ?? 0) * (loops ?? 1))}`)
    if (Array.isArray(p['Sort Key'])) n.detail.push(`Sort Key: ${(p['Sort Key'] as string[]).join(', ')}`)
    if (p['Sort Method']) n.detail.push(`сортировка: ${String(p['Sort Method'])}${p['Sort Space Used'] ? `, ${String(p['Sort Space Used'])} КБ (${String(p['Sort Space Type'])})` : ''}`)
    if (num(p['Hash Batches']) && num(p['Hash Batches'])! > 1) n.detail.push(`хеш в ${String(p['Hash Batches'])} частях (не поместился в память)`)
    const read = num(p['Shared Read Blocks'])
    const hit = num(p['Shared Hit Blocks'])
    if (read || hit) n.detail.push(`буферы: в памяти ${fmt(hit ?? 0)}, с диска ${fmt(read ?? 0)}`)
    n.children = (p.Plans ?? []).map(walk)
    // the facts the findings read
    n.facts = { removed: (num(p['Rows Removed by Filter']) ?? 0) * (loops ?? 1), filter: p['Filter'] ? String(p['Filter']) : undefined, disk: p['Sort Space Type'] === 'Disk', sortKey: Array.isArray(p['Sort Key']) ? (p['Sort Key'] as string[]) : undefined, batches: num(p['Hash Batches']) }
    return n
  }
  const root = walk(top.Plan as PgNode)
  selfTimes(root)
  const plan: Plan = { root, analyzed: root.act !== undefined, planningMs: num(top['Planning Time']), executionMs: num(top['Execution Time']), findings: [] }
  plan.findings = findings(plan)
  return plan
}

// ---------- MySQL / MariaDB: EXPLAIN FORMAT=JSON, ANALYZE FORMAT=JSON (MariaDB) ----------
export function mysqlJsonPlan(json: unknown): Plan {
  if (json && typeof json === 'object' && 'query_plan' in json) return mysqlJsonPlan2((json as { query_plan: unknown }).query_plan)
  const qb = ((json as Record<string, unknown>)?.query_block ?? json) as Record<string, unknown>
  let analyzed = false
  const walk = (o: unknown, op = 'Запрос'): PlanNode => {
    const n = node(op)
    if (!o || typeof o !== 'object') return n
    const r = o as Record<string, unknown>
    const ci = r.cost_info as Record<string, unknown> | undefined
    if (ci?.query_cost !== undefined) n.est = { cost: num(ci.query_cost) }
    if (num(r.r_total_time_ms) !== undefined) ((analyzed = true), (n.act = { ...n.act, ms: num(r.r_total_time_ms) }))
    for (const [k, v] of Object.entries(r)) {
      if (k === 'table' && v && typeof v === 'object') n.children.push(table(v as Record<string, unknown>))
      else if (k === 'nested_loop' && Array.isArray(v)) {
        const nl = node('Вложенный цикл (nested loop)')
        nl.children = v.map((x) => (x && typeof x === 'object' && 'table' in x ? table((x as Record<string, unknown>).table as Record<string, unknown>) : walk(x)))
        n.children.push(nl)
      } else if (k === 'ordering_operation' || k === 'grouping_operation' || k === 'duplicates_removal') {
        const w = v as Record<string, unknown>
        const c = walk(w, k === 'ordering_operation' ? 'Сортировка' : k === 'grouping_operation' ? 'Группировка' : 'Удаление дублей')
        if (w.using_filesort || w.filesort) c.flags.push('filesort')
        if (w.using_temporary_table || w.temporary_table) c.flags.push('временная таблица')
        n.children.push(c)
      } else if (/subquer|materialized_from_subquery|query_specifications|union_result|attached_subqueries/.test(k)) {
        const list = Array.isArray(v) ? v : [v]
        for (const x of list) n.children.push(walk((x as Record<string, unknown>)?.query_block ?? (x as Record<string, unknown>)?.query_specifications ?? x, 'Подзапрос'))
      }
    }
    return n
  }
  const table = (t: Record<string, unknown>): PlanNode => {
    const access = String(t.access_type ?? '')
    const n = node(access === 'ALL' ? 'Полный просмотр (ALL)' : access ? `Доступ ${access}` : 'Таблица', { on: [t.table_name, t.key ? `индекс ${String(t.key)}` : undefined].filter(Boolean).join(' · ') || undefined })
    n.est = { rows: num(t.rows_examined_per_scan ?? t.rows), cost: num((t.cost_info as Record<string, unknown> | undefined)?.read_cost) }
    if (num(t.r_rows) !== undefined) {
      analyzed = true
      n.act = { rows: num(t.r_rows)! * (num(t.r_loops) ?? 1), loops: num(t.r_loops), ms: num(t.r_total_time_ms) }
    }
    if (t.possible_keys) n.detail.push(`возможные индексы: ${(t.possible_keys as string[]).join(', ')}`)
    if (t.attached_condition) n.detail.push(`условие: ${String(t.attached_condition)}`)
    if (t.filtered !== undefined) n.detail.push(`проходит фильтр: ${String(t.filtered)}%`)
    if (t.using_index) n.detail.push('только по индексу (covering)')
    if (access === 'ALL') n.flags.push('полный просмотр')
    if (t.materialized_from_subquery) n.children.push(walk((t.materialized_from_subquery as Record<string, unknown>).query_block, 'Подзапрос'))
    return n
  }
  const root = walk(qb)
  selfTimes(root)
  const plan: Plan = { root, analyzed, findings: [] }
  plan.findings = findings(plan)
  return plan
}

/** MySQL 8.3+ / 9 (explain_json_format_version = 2): a tree of operations, each with its inputs. */
function mysqlJsonPlan2(qp: unknown): Plan {
  let analyzed = false
  const walk = (o: Record<string, unknown>): PlanNode => {
    const op = String(o.operation ?? o.access_type ?? '?')
    const n = node(op.replace(/\s+on\s+\S+(\s+using\s+\S+)?.*$/i, '').replace(/:\s.*$/, '') || op, {
      on: [o.alias && o.alias !== o.table_name ? `${String(o.table_name)} ${String(o.alias)}` : o.table_name, o.index_name ? `индекс ${String(o.index_name)}` : undefined].filter(Boolean).join(' · ') || undefined,
      est: { rows: num(o.estimated_rows), cost: num(o.estimated_total_cost) },
    })
    if (num(o.actual_rows) !== undefined) {
      analyzed = true
      const loops = num(o.actual_loops) ?? 1
      n.act = { rows: num(o.actual_rows)! * loops, ms: (num(o.actual_last_row_ms) ?? 0) * loops, loops }
    }
    if (o.condition) n.detail.push(`условие: ${String(o.condition)}`)
    if (o.lookup_condition) n.detail.push(`по индексу: ${String(o.lookup_condition)}`)
    if (Array.isArray(o.sort_fields)) n.detail.push(`сортировка по: ${(o.sort_fields as string[]).join(', ')}`)
    if (o.access_type === 'table') n.flags.push('полный просмотр')
    if (o.access_type === 'sort') n.flags.push('filesort')
    if (o.access_type === 'temp_table' || /temporary/i.test(op)) n.flags.push('временная таблица')
    n.children = Array.isArray(o.inputs) ? (o.inputs as Array<Record<string, unknown>>).map(walk) : []
    return n
  }
  const root = walk(qp as Record<string, unknown>)
  selfTimes(root)
  const plan: Plan = { root, analyzed, executionMs: root.act?.ms, findings: [] }
  plan.findings = findings(plan)
  return plan
}

// ---------- MySQL 8: EXPLAIN ANALYZE (a text tree) ----------
export function mysqlAnalyzePlan(text: string): Plan {
  const lines = text.split('\n').filter((l) => /^\s*->/.test(l))
  const root = node('Запрос')
  const stack: Array<{ depth: number; n: PlanNode }> = [{ depth: -1, n: root }]
  for (const l of lines) {
    const depth = l.indexOf('->')
    const body = l.slice(depth + 2).trim()
    const est = /\(cost=([\d.e+]+)(?:\.\.([\d.e+]+))? rows=([\d.e+]+)\)/.exec(body)
    const act = /\(actual time=([\d.e+]+)\.\.([\d.e+]+) rows=([\d.e+]+) loops=(\d+)\)/.exec(body)
    const op = body.replace(/\s*\(cost=[^)]*\)/, '').replace(/\s*\(actual[^)]*\)/, '').replace(/\s*\(never executed\)/, '').trim()
    const on = /\bon (\S+)(?: using (\S+))?/.exec(op)
    const n = node(op.replace(/\bon \S+( using \S+)?/, '').replace(/:\s*$/, '').trim() || op, { on: on ? [on[1], on[2] ? `индекс ${on[2]}` : undefined].filter(Boolean).join(' · ') : undefined })
    if (est) n.est = { rows: num(est[3]), cost: num(est[2] ?? est[1]) }
    if (act) n.act = { ms: Number(act[2]) * Number(act[4]), rows: Number(act[3]) * Number(act[4]), loops: Number(act[4]) }
    if (/^Table scan/i.test(op)) n.flags.push('полный просмотр')
    if (/^Sort\b/i.test(op)) n.flags.push('filesort')
    const cond = /^Filter:\s*(.*)$/.exec(op)
    if (cond) n.detail.push(`условие: ${cond[1]}`)
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    stack[stack.length - 1].n.children.push(n)
    stack.push({ depth, n })
  }
  const top = root.children.length === 1 ? root.children[0] : root
  selfTimes(top)
  const plan: Plan = { root: top, analyzed: lines.some((l) => /actual time/.test(l)), executionMs: top.act?.ms, findings: [] }
  plan.findings = findings(plan)
  return plan
}

// ---------- SQLite: EXPLAIN QUERY PLAN ----------
export function sqlitePlan(rows: Array<{ id: number; parent: number; detail: string }>): Plan {
  const root = node('Запрос')
  const by = new Map<number, PlanNode>([[0, root]])
  for (const r of rows) {
    const d = r.detail
    const m = /^(SCAN|SEARCH)\s+(?:TABLE\s+)?(\S+)(?:\s+AS\s+(\S+))?(?:\s+USING\s+(?:COVERING\s+|INTEGER PRIMARY KEY|AUTOMATIC\s+(?:PARTIAL\s+)?(?:COVERING\s+)?)?(?:INDEX\s+(\S+))?(.*))?$/i.exec(d)
    const n = m ? node(m[1].toUpperCase() === 'SCAN' ? (/USING/i.test(d) ? 'Просмотр по индексу' : 'Полный просмотр (SCAN)') : 'Поиск по индексу (SEARCH)', { on: [m[3] ? `${m[2]} ${m[3]}` : m[2], m[4] ? `индекс ${m[4]}` : undefined].filter(Boolean).join(' · ') }) : node(d)
    if (m) n.detail.push(d)
    if (m && m[1].toUpperCase() === 'SCAN' && !/USING/i.test(d)) n.flags.push('полный просмотр')
    if (/AUTOMATIC/i.test(d)) n.flags.push('временный индекс')
    if (/TEMP B-TREE/i.test(d)) n.flags.push(/ORDER BY/i.test(d) ? 'filesort' : 'временная таблица')
    by.set(r.id, n)
    ;(by.get(r.parent) ?? root).children.push(n)
  }
  const plan: Plan = { root, analyzed: false, findings: [] }
  plan.findings = findings(plan)
  return plan
}

// ---------- what is slow ----------
/** Each step's own time: its total minus its children's (the time spent in the step itself). */
function selfTimes(n: PlanNode): void {
  for (const c of n.children) selfTimes(c)
  if (n.act?.ms === undefined) return
  const kids = n.children.reduce((s, c) => s + (c.act?.ms ?? 0), 0)
  n.selfMs = Math.max(0, n.act.ms - kids)
}
const all = (n: PlanNode): PlanNode[] => [n, ...n.children.flatMap(all)]
const BIG = 10_000
/** The plan read as a person reads it: full scans of many rows, wrong estimates, sorts on disk, loops over scans. */
export function findings(p: Plan): Plan['findings'] {
  const out: Plan['findings'] = []
  const nodes = all(p.root)
  // (MySQL's trees: the condition on a Filter step above the scan)
  const parent = new Map<PlanNode, PlanNode>()
  for (const n of nodes) for (const c of n.children) parent.set(c, n)
  const condOf = (n: PlanNode) => {
    const own = n.detail.find((d) => /^условие:/.test(d))
    if (own) return own.replace(/^условие:\s*/, '')
    const up = parent.get(n)
    return up && /^Filter/i.test(up.op) ? (up.detail.find((d) => /^условие:/.test(d))?.replace(/^условие:\s*/, '') ?? /^Filter:\s*(.*)$/i.exec(up.op)?.[1]) : undefined
  }
  const total = p.executionMs ?? p.root.act?.ms
  // the heaviest step
  if (p.analyzed && total) {
    const top = nodes.filter((n) => n.selfMs !== undefined).sort((a, b) => b.selfMs! - a.selfMs!)[0]
    if (top && top.selfMs! > 1 && top.selfMs! / total > 0.3) out.push({ level: 'info', text: `Дольше всего: ${top.op}${top.on ? ` — ${top.on}` : ''}: ${ms(top.selfMs!)} (${Math.round((top.selfMs! / total) * 100)}% времени)` })
  }
  for (const n of nodes) {
    const pg = n.facts
    const scan = /^Seq Scan/.test(n.op) || n.flags.includes('полный просмотр')
    const read = (n.act?.rows ?? 0) + (pg?.removed ?? 0)
    const many = n.act ? read : (n.est?.rows ?? 0)
    if (scan && n.on) {
      const cond = pg?.filter ? String(pg.filter) : condOf(n)
      if (many >= BIG && cond) out.push({ level: 'warn', text: `Полный просмотр ${n.on}: ${n.act ? 'прочитано' : 'ожидается'} ${fmt(many)} строк${n.act && pg?.removed ? `, подошло ${fmt(n.act.rows ?? 0)}` : ''} — индекс по условию «${cond}» сократил бы чтение` })
      else if (many >= BIG * 10) out.push({ level: 'info', text: `Полный просмотр ${n.on}: ${fmt(many)} строк` })
      else if (!n.act && !n.est?.rows && n.flags.includes('полный просмотр')) out.push({ level: 'info', text: `Полный просмотр ${n.on} (без индекса)` })
    }
    // the estimate off: the statistics are old (ANALYZE) or the condition is not one the planner can judge
    if (n.act?.rows !== undefined && n.est?.rows !== undefined && n.act.loops) {
      const real = n.act.rows / n.act.loops
      const est = n.est.rows
      const ratio = Math.max(real, 1) / Math.max(est, 1)
      if ((ratio >= 10 || ratio <= 0.1) && Math.max(real, est) >= 1000)
        out.push({ level: 'warn', text: `Оценка строк ошиблась в ${Math.round(ratio >= 1 ? ratio : 1 / ratio)} раз: ${n.op}${n.on ? ` — ${n.on}` : ''}: ожидалось ${fmt(est)}, получено ${fmt(real)} — устаревшая статистика (ANALYZE таблицы) или условие, которое планировщик не может оценить` })
    }
    if (pg?.disk) out.push({ level: 'warn', text: `Сортировка ушла на диск${pg.sortKey ? ` (${(pg.sortKey as string[]).join(', ')})` : ''} — мало work_mem, или индекс по этим полям избавил бы от сортировки` })
    if (pg?.batches && pg.batches > 1) out.push({ level: 'warn', text: `Хеш-соединение не поместилось в память (${pg.batches} частей) — мало work_mem или соединяется слишком много строк` })
    if (n.flags.includes('filesort') && !pg) out.push({ level: 'info', text: `Сортировка без индекса (filesort)${n.on ? `: ${n.on}` : ''} — при больших объёмах индекс по полям ORDER BY ускорит` })
    if (n.flags.includes('временная таблица')) out.push({ level: 'info', text: `Временная таблица для ${n.op.toLowerCase()} — при больших объёмах дорого` })
    if (n.flags.includes('временный индекс')) out.push({ level: 'warn', text: `${n.on ?? 'Таблица'}: индекс строится на каждый запрос (AUTOMATIC) — нужен постоянный индекс` })
    // a loop over a scan: the inner table read once per outer row
    if (/^Nested Loop|^Вложенный цикл/.test(n.op))
      for (const c of n.children.slice(1)) {
        const inner = all(c).find((x) => /^Seq Scan/.test(x.op) || x.flags.includes('полный просмотр'))
        if (inner?.act?.loops && inner.act.loops >= 100) out.push({ level: 'warn', text: `Вложенный цикл: ${inner.on ?? 'таблица'} просматривается целиком ${fmt(inner.act.loops)} раз — нужен индекс по условию соединения` })
      }
  }
  // the same words once
  return out.filter((f, i) => out.findIndex((x) => x.text === f.text) === i)
}
