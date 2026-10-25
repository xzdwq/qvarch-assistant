import { NAME_MAX } from '../../../src/shared/transport/constants'
import type { DeviceInfo } from '../../../src/shared/transport/protocol'
import type { Db } from '../db'
import { text, type Flags, type ModuleFactory } from '../module'

/** The core: the devices (installations of the app) and the switches. */
const MIGRATIONS = [
  `create table qa_devices (
     id text primary key,
     key text unique,
     name text not null,
     bot boolean not null default false,
     created_at timestamptz not null default now(),
     seen_at timestamptz not null default now()
   );
   create table qa_flags (key text primary key, value boolean not null, at timestamptz not null default now());`,
  // the server's own participants (a test bot) are gone
  'alter table qa_devices drop column bot;',
]

/** A name as kept: trimmed, not too long; none — the fingerprint's start. */
export const deviceName = (name: string, id: string): string => name.trim().slice(0, NAME_MAX) || `Устройство ${id.slice(0, 6)}`

interface DeviceRow {
  id: string
  name: string
}
const info = (r: DeviceRow): DeviceInfo => ({ id: r.id, name: r.name })

/** The devices the server has met. */
export class Devices {
  constructor(private readonly db: Db) {}

  /** A device signed in: met first — kept; known — its name (when it gave one) and the time seen updated. */
  async signIn(id: string, key: string, name: string): Promise<DeviceInfo> {
    const row = await this.db.one<DeviceRow>(
      `insert into qa_devices (id, key, name) values ($1, $2, $3)
       on conflict (id) do update set seen_at = now(), name = case when $4 then excluded.name else qa_devices.name end
       returning id, name`,
      [id, key, deviceName(name, id), !!name.trim()],
    )
    return info(row!)
  }
  async rename(id: string, name: string): Promise<DeviceInfo> {
    const row = await this.db.one<DeviceRow>('update qa_devices set name = $2 where id = $1 returning id, name', [id, deviceName(name, id)])
    return info(row!)
  }
}

/** The switches in the database, read at most every few seconds (the admin command's change is seen that soon). */
export class DbFlags implements Flags {
  private cache = new Map<string, { value: boolean | undefined; at: number }>()
  constructor(
    private readonly db: Db,
    private readonly ttlMs = 3000,
  ) {}
  async get(key: string, dflt: boolean): Promise<boolean> {
    const c = this.cache.get(key)
    if (c && Date.now() - c.at < this.ttlMs) return c.value ?? dflt
    const row = await this.db.one<{ value: boolean }>('select value from qa_flags where key = $1', [key])
    this.cache.set(key, { value: row?.value, at: Date.now() })
    return row?.value ?? dflt
  }
  async set(key: string, on: boolean): Promise<void> {
    await this.db.rows('insert into qa_flags (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, at = now()', [key, on])
    this.cache.delete(key)
  }
}

export const coreModule: ModuleFactory = (ctx) => {
  const devices = new Devices(ctx.db)
  return {
    name: 'core',
    migrations: MIGRATIONS,
    methods: {
      // the connection's own idea of the name follows (its next messages are signed with it)
      'core.rename': async (p, s) => (s.device = await devices.rename(s.device.id, text(p, 'name'))),
    },
  }
}
