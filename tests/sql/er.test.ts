import { describe, expect, it } from 'vitest'
import { erAround, erFromRows, erKey, erLinks, erMermaid, erTablesNamed, type ErColumnRow, type ErKeyRow } from '../../src/shared/sql'

const col = (schema: string | null, table: string, column: string, type: string, nullable = true, pk: number | null = null, view = false): ErColumnRow => [schema, table, column, type, nullable, null, null, null, pk, view]
const cols: ErColumnRow[] = [
  col('public', 'customers', 'id', 'int', false),
  col('public', 'customers', 'email', 'text', false),
  col('public', 'orders', 'id', 'int', false),
  col('public', 'orders', 'customer_id', 'int', true),
  col('public', 'order_lines', 'order_id', 'int', false),
  col('public', 'order_lines', 'line', 'int', false),
  col('public', 'products', 'id', 'int', false),
  col('sales', 'orders', 'id', 'int', false),
  col('public', 'v_orders', 'id', 'int', true, null, true),
]
const keys: ErKeyRow[] = [
  ['public', 'customers', 'id', 'p', null, null, null, 'customers_pkey'],
  ['public', 'customers', 'email', 'u', null, null, null, 'customers_email_key'],
  ['public', 'orders', 'id', 'p', null, null, null, 'orders_pkey'],
  ['public', 'orders', 'customer_id', 'f', 'public', 'customers', null, 'orders_customer_fk'],
  ['public', 'order_lines', 'order_id', 'p', null, null, null, 'ol_pkey'],
  ['public', 'order_lines', 'line', 'p', null, null, null, 'ol_pkey'],
  ['public', 'order_lines', 'order_id', 'f', 'public', 'orders', 'id', 'ol_order_fk'],
  ['public', 'gone', 'x', 'f', 'public', 'customers', 'id', 'gone_fk'],
]
const s = erFromRows(cols, keys, 'public')
const t = (k: string) => s.tables.find((x) => erKey(x) === k)!

describe('the structure for an ER diagram', () => {
  it('keys put on their columns; a composite primary key; a reference without its column — to the primary key', () => {
    expect(t('public.customers').columns.find((c) => c.name === 'email')).toMatchObject({ unique: true, nullable: false, pk: false })
    expect(t('public.order_lines').columns.filter((c) => c.pk).map((c) => c.name)).toEqual(['order_id', 'line'])
    expect(t('public.orders').columns.find((c) => c.name === 'customer_id')!.fk).toEqual([{ schema: 'public', table: 'customers', column: 'id', name: 'orders_customer_fk' }])
    expect(t('public.v_orders').view).toBe(true)
  })
  it('a key of a table not read is left out', () => {
    expect(s.tables.some((x) => x.name === 'gone')).toBe(false)
    expect(erLinks(s)).toHaveLength(2)
  })
  it('the query’s tables: by name, the default schema first; a schema named — that one', () => {
    expect(erTablesNamed(s, [{ name: 'ORDERS' }, { name: 'nope' }])).toEqual(['public.orders'])
    expect(erTablesNamed(s, [{ name: 'orders', schema: 'sales' }])).toEqual(['sales.orders'])
  })
  it('the neighbours a few references away, either way', () => {
    expect(erAround(s, ['public.orders'], 0)).toEqual(['public.orders'])
    expect(erAround(s, ['public.orders'], 1).sort()).toEqual(['public.customers', 'public.order_lines', 'public.orders'])
    expect(erAround(s, ['public.order_lines'], 1).sort()).toEqual(['public.order_lines', 'public.orders'])
    expect(erAround(s, ['public.order_lines'], 2).sort()).toEqual(['public.customers', 'public.order_lines', 'public.orders'])
    expect(erAround(s, ['public.products'], 2)).toEqual(['public.products'])
  })
  it('as Mermaid: keys marked, a reference that may be empty — an optional parent', () => {
    const m = erMermaid(s, ['public.customers', 'public.orders', 'public.order_lines'])
    expect(m).toContain('public_customers {')
    expect(m).toContain('    text email UK')
    expect(m).toContain('    int order_id PK, FK')
    expect(m).toContain('  public_customers |o--o{ public_orders : "customer_id"')
    expect(m).toContain('  public_orders ||--o{ public_order_lines : "order_id"')
    expect(m).not.toContain('products')
  })
})
