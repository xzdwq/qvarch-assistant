/** A database connection as the settings keep it: its kinds, its fields, its defaults. */
interface DbKindInfo {
  id: string
  title: string
  /** The server's usual port (none — a file). */
  port?: number
}
const DB_KIND_LIST = [
  { id: 'pg', title: 'PostgreSQL', port: 5432 },
  { id: 'mysql', title: 'MySQL / MariaDB', port: 3306 },
  { id: 'sqlite', title: 'SQLite' },
] as const satisfies readonly DbKindInfo[]
export type DbKind = (typeof DB_KIND_LIST)[number]['id']
export const DB_KINDS: ReadonlyArray<DbKindInfo & { id: DbKind }> = DB_KIND_LIST
/** TLS: off, required with the certificate checked, required without the check (a self-signed one). */
export const SSL_MODES = [
  { id: 'off', title: 'без TLS' },
  { id: 'verify', title: 'TLS, проверять сертификат' },
  { id: 'no-verify', title: 'TLS, без проверки сертификата' },
] as const satisfies ReadonlyArray<{ id: string; title: string }>
export type SslMode = (typeof SSL_MODES)[number]['id']
/** A connection as the settings keep it (the password apart, encrypted; never in a note). */
export interface DbConn {
  id: string
  /** What a note calls it: ```sql db=<name>. */
  name: string
  kind: DbKind
  host?: string
  port?: number
  database?: string
  user?: string
  /** The password: only going in (to be saved); what comes out says only whether there is one. */
  password?: string
  hasPassword?: boolean
  ssl?: SslMode
  /** SQLite: the file. */
  file?: string
  /** A query's time on the server, s (then it is cancelled). */
  timeoutSec?: number
  /** How long a lock held by another session is waited for, s (then the query gives up — nothing waits behind it). */
  lockSec?: number
  /** Rows read at most (the rest not fetched). */
  maxRows?: number
  /** Marked as production: shown so (it is read-only as every connection is). */
  prod?: boolean
}
export const DB_DEFAULTS = { timeoutSec: 30, lockSec: 3, maxRows: 1000, connectSec: 10 }
/** A connection's name a note can use (letters, digits, «_.-»). */
export const connName = (s: string) => /^[\p{L}\p{N}_.-]{1,60}$/u.test(s)
