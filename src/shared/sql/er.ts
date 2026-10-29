/**
 * The database's structure for an ER diagram: its tables (and views) with their columns — type, NULL or not, the
 * default, the comment —, their keys (primary, unique) and their references (a foreign key: which table and column it
 * points to). Read from each database's catalogue in one row shape for all of them (the queries differ, the rows do
 * not); the diagram is drawn of a part of it: the tables a query uses, some picked, or all — with their neighbours
 * a few references away.
 */

export interface ErRef {
  schema?: string
  table: string
  /** The column pointed to (none — the target's primary key: SQLite's short form). */
  column?: string
  /** The constraint's name (the columns of one foreign key share it). */
  name?: string
}
export interface ErColumn {
  name: string
  type?: string
  nullable: boolean
  default?: string
  comment?: string
  pk: boolean
  unique: boolean
  /** Where it points (a column in two foreign keys — both). */
  fk?: ErRef[]
}
export interface ErTable {
  schema?: string
  name: string
  comment?: string
  /** A view (no keys of its own). */
  view?: boolean
  columns: ErColumn[]
}
export interface ErSchema {
  defaultSchema?: string
  tables: ErTable[]
  at: number
  /** The catalogue had more rows than were read (a huge database): the diagram may miss some. */
  truncated?: boolean
}

/**
 * A column's row as every database's query gives it: schema, table, column, type, nullable, default, comment, the
 * table's comment, its place in the primary key (SQLite's; others — null), the table is a view.
 */
export type ErColumnRow = [string | null, string, string, string | null, unknown, string | null, string | null, string | null, number | null, unknown]
/** A key's row: schema, table, column, kind (p primary, u unique, f foreign), the target's schema, table, column, the constraint's name. */
export type ErKeyRow = [string | null, string, string, string, string | null, string | null, string | null, string | null]

const yes = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'YES' || v === 'yes'
export const erKey = (t: { schema?: string; name: string }) => `${t.schema ?? ''}.${t.name}`
export const erLabel = (t: { schema?: string; name: string }, def?: string) => (t.schema && t.schema !== def ? `${t.schema}.${t.name}` : t.name)

/** The catalogue's rows made into tables (a foreign key without its target column — to the target's primary key). */
export function erFromRows(cols: readonly ErColumnRow[], keys: readonly ErKeyRow[], defaultSchema?: string, truncated = false): ErSchema {
  const by = new Map<string, ErTable>()
  for (const [schema, table, column, type, nullable, dflt, comment, tableComment, pk, view] of cols) {
    const k = erKey({ schema: schema ?? undefined, name: table })
    const t = by.get(k) ?? by.set(k, { ...(schema ? { schema } : {}), name: table, ...(tableComment ? { comment: tableComment } : {}), ...(yes(view) ? { view: true } : {}), columns: [] }).get(k)!
    t.columns.push({ name: column, ...(type ? { type } : {}), nullable: yes(nullable), ...(dflt != null && dflt !== '' ? { default: String(dflt) } : {}), ...(comment ? { comment } : {}), pk: !!pk && Number(pk) > 0, unique: false })
  }
  const colOf = (schema: string | null, table: string, column: string) => by.get(erKey({ schema: schema ?? undefined, name: table }))?.columns.find((c) => c.name === column)
  for (const [schema, table, column, kind, rs, rt, rc, name] of keys) {
    const c = colOf(schema, table, column)
    if (!c) continue
    if (kind === 'p') c.pk = true
    else if (kind === 'u') c.unique = true
    else if (kind === 'f' && rt) (c.fk ??= []).push({ ...(rs ? { schema: rs } : {}), table: rt, ...(rc ? { column: rc } : {}), ...(name ? { name } : {}) })
  }
  // (a reference to a table's primary key without naming it: its first key column)
  for (const t of by.values())
    for (const c of t.columns)
      for (const r of c.fk ?? []) if (!r.column) r.column = by.get(erKey({ schema: r.schema, name: r.table }))?.columns.find((x) => x.pk)?.name
  return { ...(defaultSchema ? { defaultSchema } : {}), tables: [...by.values()], at: Date.now(), ...(truncated ? { truncated: true } : {}) }
}

/** The tables of a schema a query names (by name, any case; a schema named — that one, else the default first). */
export function erTablesNamed(s: ErSchema, names: ReadonlyArray<{ name: string; schema?: string }>): string[] {
  const out = new Set<string>()
  for (const n of names) {
    const same = s.tables.filter((t) => t.name.toLowerCase() === n.name.toLowerCase() && (!n.schema || (t.schema ?? '').toLowerCase() === n.schema.toLowerCase()))
    const pick = same.find((t) => !n.schema && t.schema === s.defaultSchema) ?? same[0]
    if (pick) out.add(erKey(pick))
  }
  return [...out]
}

/** Every reference between two tables of the schema (from → to), each table pair once per column pair. */
export function erLinks(s: ErSchema): Array<{ from: string; fromColumn: string; to: string; toColumn?: string; optional: boolean }> {
  const out: Array<{ from: string; fromColumn: string; to: string; toColumn?: string; optional: boolean }> = []
  for (const t of s.tables)
    for (const c of t.columns) for (const r of c.fk ?? []) out.push({ from: erKey(t), fromColumn: c.name, to: erKey({ schema: r.schema, name: r.table }), ...(r.column ? { toColumn: r.column } : {}), optional: c.nullable })
  return out
}

/** The tables picked and the ones within `depth` references of them, either way (0 — the picked ones alone). */
export function erAround(s: ErSchema, picked: readonly string[], depth: number): string[] {
  const near = new Map<string, Set<string>>()
  for (const l of erLinks(s)) {
    ;(near.get(l.from) ?? near.set(l.from, new Set()).get(l.from)!).add(l.to)
    ;(near.get(l.to) ?? near.set(l.to, new Set()).get(l.to)!).add(l.from)
  }
  const known = new Set(s.tables.map(erKey))
  const keep = new Set(picked.filter((k) => known.has(k)))
  let edge = [...keep]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const k of edge) for (const n of near.get(k) ?? []) if (known.has(n) && !keep.has(n)) (keep.add(n), next.push(n))
    edge = next
  }
  return [...keep]
}

/** The tables as Mermaid's erDiagram (to put into a note): columns with PK / FK / UK, a line per reference. */
export function erMermaid(s: ErSchema, keys: readonly string[]): string {
  const keep = new Set(keys)
  const id = (k: string) => k.replace(/^\./, '').replace(/[^\p{L}\p{N}_]/gu, '_')
  const word = (t?: string) => (t ?? 'any').replace(/[^\p{L}\p{N}_]/gu, '_') || 'any'
  const lines = ['erDiagram']
  for (const t of s.tables.filter((x) => keep.has(erKey(x)))) {
    lines.push(`  ${id(erKey(t))} {`)
    for (const c of t.columns) {
      const marks = [c.pk && 'PK', c.fk?.length && 'FK', c.unique && 'UK'].filter(Boolean).join(', ')
      lines.push(`    ${word(c.type)} ${word(c.name)}${marks ? ` ${marks}` : ''}${c.comment ? ` "${c.comment.replace(/"/g, "'")}"` : ''}`)
    }
    lines.push('  }')
  }
  // the parent (pointed to) has many children; a child's reference may be empty (NULL) — its parent is optional
  for (const l of erLinks(s)) if (keep.has(l.from) && keep.has(l.to)) lines.push(`  ${id(l.to)} ${l.optional ? '|o' : '||'}--o{ ${id(l.from)} : "${l.fromColumn}"`)
  return lines.join('\n')
}
