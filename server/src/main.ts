import pkg from '../package.json'
import { readConfig } from './config'
import { Db } from './db'
import { startTransport } from './hub'
import { MODULES } from './modules'

/** The server's start: the settings from the environment, the database, the modules; a clean stop on a signal. */
async function main(): Promise<void> {
  const config = readConfig(process.env, pkg.version)
  const db = new Db(config.databaseUrl)
  const transport = await startTransport(config, db, MODULES)
  console.log(`qvarch-transport ${config.version}: порт ${transport.port}, код доступа ${config.accessCode ? 'задан' : 'не задан'}`)
  const stop = async () => {
    await transport.close()
    await db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop())
  process.on('SIGINT', () => void stop())
}

main().catch((e: Error) => {
  console.error('start:', e.message)
  process.exit(1)
})
