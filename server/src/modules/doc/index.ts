import * as Y from 'yjs'
import type { DeviceInfo } from '../../../../src/shared/transport/protocol'
import { ROLE_RIGHTS } from '../../../../src/shared/transport/space'
import { RpcFail, text, uuid, type ModuleFactory, type Session } from '../../module'
import { readUpdate } from '../space'
import { SpaceStore } from '../space/spaceStore'
import { COMPACT_EVERY, DOC_MIGRATIONS, DocStore } from './docStore'

/** A document held in memory while someone has it open. */
interface Live {
  y: Y.Doc
  space: string
  /** The devices that have it open (they get its updates). */
  open: Set<string>
  /** Updates kept since the last merge into the state. */
  since: number
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

/**
 * Shared documents, live: a document opened is held in memory (loaded once — two opening it at once share the load),
 * an edit applied, kept and sent to the others who have it open; every so many edits — merged into the state. Who has
 * it open — sent to them (presence). The last one closing it — it leaves memory.
 */
export const docModule: ModuleFactory = (ctx) => {
  const store = new DocStore(ctx.db)
  const spaces = new SpaceStore(ctx.db)
  const live = new Map<string, Promise<Live>>()

  function hold(doc: string, space: string): Promise<Live> {
    let l = live.get(doc)
    if (!l) {
      l = store.load(doc).then(({ y, pending }) => ({ y, space, open: new Set<string>(), since: pending }))
      live.set(doc, l)
      l.catch(() => live.delete(doc))
    }
    return l
  }
  async function access(doc: string, s: Session) {
    const r = await spaces.docRole(doc, s.device.id)
    if (!r) throw new RpcFail('denied', 'Нет доступа к этому документу')
    return r
  }
  /** Everyone with the document open told who is there. */
  async function presence(doc: string, l: Live): Promise<void> {
    const ids = [...l.open]
    const rows = await ctx.db.rows<DeviceInfo>('select id, name from qa_devices where id = any($1::text[]) order by name', [ids])
    ctx.delivery.send(ids, { e: 'doc.presence', p: { doc, devices: rows } })
  }
  /** A device no longer has the document open (the last one gone — it leaves memory). */
  async function close(doc: string, device: string): Promise<void> {
    const l = await live.get(doc)
    if (!l || !l.open.delete(device)) return
    if (!l.open.size) live.delete(doc)
    else await presence(doc, l)
  }
  const closeAll = (pick: (l: Live) => boolean, device: string) => {
    for (const [doc, p] of live)
      void p
        .then((l) => {
          if (pick(l)) return close(doc, device)
        })
        .catch(() => undefined)
  }
  ctx.bus.on('space.left', ({ space, device }) => closeAll((l) => l.space === space, device))

  return {
    name: 'doc',
    migrations: DOC_MIGRATIONS,
    onClose: (s) => closeAll(() => true, s.device.id),
    methods: {
      'doc.open': async (p, s) => {
        const doc = uuid(p, 'doc')
        const { space, role } = await access(doc, s)
        const l = await hold(doc, space)
        const sv = text(p, 'sv')
        let update: Uint8Array
        try {
          update = Y.encodeStateAsUpdate(l.y, sv ? Buffer.from(sv, 'base64') : undefined)
        } catch {
          throw new RpcFail('bad', 'sv: это не вектор состояния')
        }
        l.open.add(s.device.id)
        await presence(doc, l)
        return { update: b64(update), sv: b64(Y.encodeStateVector(l.y)), role, space }
      },
      'doc.update': async (p, s) => {
        const doc = uuid(p, 'doc')
        const { space, role } = await access(doc, s)
        if (!ROLE_RIGHTS[role].edit) throw new RpcFail('denied', 'Только чтение: править документ нельзя')
        const update = readUpdate(p.update)
        const l = await hold(doc, space)
        // into memory first: a merge into the state never drops an update kept but not applied
        Y.applyUpdate(l.y, update)
        await store.append(doc, update, s.device.id)
        ctx.delivery.send([...l.open].filter((d) => d !== s.device.id), { e: 'doc.update', p: { doc, update: b64(update), by: s.device.id } })
        if (++l.since >= COMPACT_EVERY) {
          l.since = 0
          await store.compact(doc, l.y)
        }
        return null
      },
      'doc.close': async (p, s) => {
        await close(uuid(p, 'doc'), s.device.id)
        return null
      },
    },
  }
}
