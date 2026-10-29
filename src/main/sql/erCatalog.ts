import { erFromRows, type DbConn, type DbKind, type ErColumnRow, type ErKeyRow, type ErSchema } from '../../shared/sql'
import { DEFAULT_SCHEMA, runSql } from './engine'

/**
 * The database's structure for an ER diagram, read from its catalogue — each database's own (PostgreSQL's pg_catalog,
 * MySQL's information_schema, SQLite's pragmas), each giving the same row shape (erFromRows). Read the safe way any
 * query is (its own connection, read-only, the server's time limit, a lock waited for a few seconds only; stopped —
 * cancelled on the server): two queries one after the other — the columns, then the keys.
 */
const CATALOG: Record<DbKind, { columns: string; keys: string }> = {
  pg: {
    columns: `select n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), not a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
  col_description(c.oid, a.attnum), obj_description(c.oid, 'pg_class'), null, c.relkind in ('v', 'm')
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
  and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
order by n.nspname, c.relname, a.attnum`,
    keys: `select n.nspname, c.relname, a.attname, con.contype::text, rn.nspname, rc.relname, ra.attname, con.conname
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join lateral unnest(con.conkey) with ordinality as k(attnum, i) on true
join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
left join pg_catalog.pg_class rc on rc.oid = con.confrelid
left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
left join pg_catalog.pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = con.confkey[k.i]
where con.contype in ('p', 'u', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'`,
  },
  mysql: {
    columns: `select c.table_schema, c.table_name, c.column_name, c.column_type, c.is_nullable = 'YES', c.column_default,
  nullif(c.column_comment, ''), nullif(t.table_comment, ''), null, t.table_type = 'VIEW'
from information_schema.columns c
join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = coalesce(database(), c.table_schema) and c.table_schema not in ('mysql', 'sys', 'information_schema', 'performance_schema')
order by c.table_schema, c.table_name, c.ordinal_position`,
    keys: `select k.table_schema, k.table_name, k.column_name,
  case tc.constraint_type when 'PRIMARY KEY' then 'p' when 'UNIQUE' then 'u' else 'f' end,
  k.referenced_table_schema, k.referenced_table_name, k.referenced_column_name, k.constraint_name
from information_schema.key_column_usage k
join information_schema.table_constraints tc on tc.constraint_schema = k.constraint_schema and tc.constraint_name = k.constraint_name and tc.table_name = k.table_name
where k.table_schema = coalesce(database(), k.table_schema) and k.table_schema not in ('mysql', 'sys', 'information_schema', 'performance_schema')
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')`,
  },
  sqlite: {
    columns: `select null, m.name, p.name, p.type, p."notnull" = 0, p.dflt_value, null, null, p.pk, m.type = 'view'
from sqlite_master m join pragma_table_info(m.name) p
where m.type in ('table', 'view') and m.name not like 'sqlite\\_%' escape '\\'
order by m.name, p.cid`,
    keys: `select null, m.name, f."from", 'f', null, f."table", f."to", 'fk' || f.id
from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table'
union all
select null, m.name, ii.name, 'u', null, null, null, il.name
from sqlite_master m join pragma_index_list(m.name) il join pragma_index_info(il.name) ii
where m.type = 'table' and il."unique" = 1 and il.origin = 'u'`,
  },
}
/** The catalogue's queries of a database (the tests check them against the guard). */
export const erCatalogOf = (kind: DbKind) => CATALOG[kind]

/** The tables, columns, keys and references the connection's user can see. */
export async function readEr(c: DbConn, signal?: AbortSignal): Promise<ErSchema> {
  const big = { ...c, maxRows: 100_000 }
  const cols = (await runSql(big, CATALOG[c.kind].columns, [], 'run', signal)).result!
  const keys = (await runSql(big, CATALOG[c.kind].keys, [], 'run', signal)).result!
  return erFromRows(cols.rows as ErColumnRow[], keys.rows as ErKeyRow[], DEFAULT_SCHEMA[c.kind](c), !!(cols.more || keys.more))
}
