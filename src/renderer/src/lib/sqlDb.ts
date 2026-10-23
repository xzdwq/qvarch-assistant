import { shallowRef } from 'vue'
import { DB_KINDS, type DbConn } from '@shared/sql'

/** «Базы данных» as the page knows them: the connections (no passwords), read again after each change. */
export const dbConns = shallowRef<DbConn[]>([])
let loaded: Promise<void> | undefined
export function loadConns(again = false): Promise<void> {
  if (!loaded || again) loaded = window.qa.sql('conns').then((l) => void (dbConns.value = l))
  return loaded
}
export const kindTitle = (k?: string) => DB_KINDS.find((x) => x.id === k)?.title ?? k ?? ''
/** Where a connection goes, in a few words: host:port / base — or the file. */
export const connWhere = (c?: DbConn) => (!c ? '' : c.kind === 'sqlite' ? (c.file ?? '').split(/[\\/]/).pop() || 'файл не указан' : `${c.host ?? '?'}${c.port ? `:${c.port}` : ''}${c.database ? ` / ${c.database}` : ''}`)
