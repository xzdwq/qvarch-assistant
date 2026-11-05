import { NAME_MAX } from '../../../src/shared/transport/constants'
import type { DeviceInfo } from '../../../src/shared/transport/protocol'
import type { Db } from '../db'
import type { ModuleFactory } from '../module'

/** The core: the devices (installations of the app). */
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
  // never read: the key (the id is its fingerprint — a signature is checked by the key the device sends), the time
  // seen, the switches
  'alter table qa_devices drop column key, drop column seen_at; drop table qa_flags;',
]

/** A name as kept: trimmed, not too long; none — the fingerprint's start. */
export const deviceName = (name: string, id: string): string => name.trim().slice(0, NAME_MAX) || `Устройство ${id.slice(0, 6)}`

/** The devices the server has met. */
export class Devices {
  constructor(private readonly db: Db) {}

  /** A device signed in: met first — kept; known — its name updated (when it gave one). */
  async signIn(id: string, name: string): Promise<DeviceInfo> {
    const row = await this.db.one<DeviceInfo>(
      `insert into qa_devices (id, name) values ($1, $2)
       on conflict (id) do update set name = case when $3 then excluded.name else qa_devices.name end
       returning id, name`,
      [id, deviceName(name, id), !!name.trim()],
    )
    return { id: row!.id, name: row!.name }
  }
}

export const coreModule: ModuleFactory = () => ({ name: 'core', migrations: MIGRATIONS })
