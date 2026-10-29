/**
 * «@бд»: a query to a database (PostgreSQL, MySQL / MariaDB, SQLite) from a note — read only, one connection per
 * query (opened, used, closed), never a lock waited for long nor held: what is safe to send is decided here, before
 * anything reaches the server. The parts live in ./sql/; this is their one entry.
 */
export * from './sql/connection'
export * from './sql/tokens'
export * from './sql/guard'
export * from './sql/bind'
export * from './sql/result'
export * from './sql/templates'
export * from './sql/errors'
export * from './sql/api'
export * from './sql/er'
export * from './sql/erFocus'
