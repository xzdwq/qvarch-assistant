import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import type { Db } from '../../db'

/**
 * Who talks with whom: the people one may add to a chat (those one already shares a chat or a shared note with), the
 * main conversation of two (their first chat of just the two of them — no space, not a comment, not a branch),
 * a chat's maker, its people and branches changed.
 */
export class ChatPeople {
  constructor(private readonly db: Db) {}

  async peopleOf(dev: string): Promise<DeviceInfo[]> {
    return this.db.rows<DeviceInfo>(
      `select d.id, d.name from qa_devices d where d.id <> $1 and not d.bot and (
         d.id in (select x.device from chat_members x where x.room in (select room from chat_members where device = $1))
         or d.id in (select y.device from space_members y where y.space in (select space from space_members where device = $1)))
       order by d.name`,
      [dev],
    )
  }
  /** The main conversation of two (none — they never talked just the two of them). */
  async mainOf(a: string, b: string): Promise<string | undefined> {
    const r = await this.db.one<{ id: string }>(
      `select r.id from chat_rooms r
       where r.space is null and r.doc is null and r.parent is null
         and (select count(*) from chat_members m where m.room = r.id) = 2
         and exists (select 1 from chat_members m where m.room = r.id and m.device = $1)
         and exists (select 1 from chat_members m where m.room = r.id and m.device = $2)
       order by r.created_at limit 1`,
      [a, b],
    )
    return r?.id
  }
  async makerOf(room: string): Promise<string | undefined> {
    return (await this.db.one<{ created_by: string }>('select created_by from chat_rooms where id = $1', [room]))?.created_by
  }
  async rename(room: string, title: string): Promise<void> {
    await this.db.rows('update chat_rooms set title = $2 where id = $1', [room, title])
  }
  async add(room: string, dev: string): Promise<void> {
    await this.db.rows('insert into chat_members (room, device) values ($1, $2) on conflict do nothing', [room, dev])
  }
  async branchOf(room: string, parent: string): Promise<void> {
    await this.db.rows('update chat_rooms set parent = $2 where id = $1', [room, parent])
  }
  /** A chat of one alone taken away (one that never got anyone else, being replaced by a conversation). */
  async dropLonely(room: string, dev: string): Promise<void> {
    await this.db.rows(`delete from chat_rooms r where r.id = $1 and r.created_by = $2 and (select count(*) from chat_members m where m.room = r.id) = 1`, [room, dev])
  }
}
