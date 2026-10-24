/** The server's settings, all from the environment (compose's `.env`): nothing about a stand is written in the code. */
export interface ServerConfig {
  port: number
  /** PostgreSQL: `postgres://user:password@host:5432/db`. */
  databaseUrl: string
  /** A code the apps must know to connect ('' — any app of the network may). */
  accessCode: string
  version: string
}

/** The settings read; a missing database is the one thing that stops the start. */
export function readConfig(env: Record<string, string | undefined>, version: string): ServerConfig {
  const port = Number(env.QA_PORT ?? 3000)
  const databaseUrl = (env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL не задан')
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000,
    databaseUrl,
    accessCode: (env.QA_ACCESS_CODE ?? '').trim(),
    version,
  }
}
