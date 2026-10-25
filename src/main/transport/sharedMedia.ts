import { MEDIA_PATH, TICKET_HEADER, type TransportMethods } from '../../shared/transport/protocol'
import { isSpaceFile, mediaWhy, type MediaReport } from '../../shared/transport/space'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Vault } from '../vault'
import type { SpacePasses } from './spacePasses'

export type { MediaReport }
/** Which way a sync goes: send what the server lacks, fetch what this computer lacks (both — by default). */
export interface MediaWays {
  send?: boolean
  fetch?: boolean
}

export type SharedMediaAsk = <M extends 'media.missing' | 'media.ticket'>(m: M, p: TransportMethods[M]['p']) => Promise<TransportMethods[M]['r']>

/** How each kind of media file is read and written in the notebook (by its folder). */
const KINDS: Record<string, { read: (v: Vault, rel: string) => Uint8Array; write: (v: Vault, rel: string, b: Uint8Array) => void }> = {
  '.images/': { read: (v, rel) => v.readImage(rel), write: (v, rel, b) => v.restoreImage(rel, b) },
  '.audio/': { read: (v, rel) => v.readAudio(rel), write: (v, rel, b) => v.restoreAudio(rel, b) },
  // a test file of a set: its path is checked (isSpaceFile) before it gets here
  '.files/': {
    read: (v, rel) => readFileSync(join(v.root, rel)),
    write: (v, rel, b) => {
      const f = join(v.root, rel)
      mkdirSync(dirname(f), { recursive: true })
      if (!existsSync(f)) writeFileSync(f, b)
    },
  },
}
const kindOf = (rel: string) => KINDS[Object.keys(KINDS).find((k) => rel.startsWith(k))!]
function readLocal(vault: Vault, rel: string): Uint8Array | undefined {
  try {
    return kindOf(rel).read(vault, rel)
  } catch {
    return undefined
  }
}

/**
 * The media files of a shared note in step with the server's copy: a picture or a recording this computer has and
 * the server lacks — sent; one the note embeds and this computer lacks — fetched into the notebook. Over HTTP with a
 * pass of the socket (files are too big for it).
 */
export class SharedMedia {
  constructor(
    private readonly vault: Vault,
    private readonly ask: SharedMediaAsk,
    private readonly passes: SpacePasses,
    /** The server's HTTP address (`http://host:port`), none — offline. */
    private readonly base: () => string | undefined,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** What became of each file (written to the journal too): fetched, and why the others are not here (for the person). */
  async sync(space: string, rels: readonly string[], ways: MediaWays = {}): Promise<MediaReport> {
    const report = await this.syncFiles(space, rels, ways)
    for (const rel of rels) this.log(`media ${space.slice(0, 8)} ${rel}: ${report.fetched.includes(rel) ? 'загружено' : (mediaWhy(report, rel) ?? 'на месте')}`)
    return report
  }
  private async syncFiles(space: string, rels: readonly string[], ways: MediaWays): Promise<MediaReport> {
    const { send = true, fetch: take = true } = ways
    const report: MediaReport = { fetched: [], absent: [], failed: {} }
    const wanted = rels.filter((r) => isSpaceFile(r))
    const base = this.base()
    if (!wanted.length) return report
    if (!base) {
      for (const rel of wanted) report.failed[rel] = 'нет связи с сервером'
      return report
    }
    const url = (rel: string) => `${base}${MEDIA_PATH}${space}/${rel.split('/').map(encodeURIComponent).join('/')}`
    const said = async (r: Response) => `${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`.trim()
    const serverLacks = new Set(await this.ask('media.missing', { space, rels: wanted }))
    for (const rel of wanted) {
      const local = readLocal(this.vault, rel)
      if (send && local && serverLacks.has(rel)) {
        const r = await this.passes.request(space, (pass) => fetch(url(rel), { method: 'PUT', body: Buffer.from(local), headers: { [TICKET_HEADER]: pass } })).catch((e: Error) => e)
        if (r instanceof Error) report.failed[rel] = `не отправлено: ${r.message}`
        else if (!r.ok) report.failed[rel] = `сервер не принял: ${await said(r)}`
        else this.log(`media ${space.slice(0, 8)} ${rel}: отправлено`)
      }
      if (!take || local) continue
      if (serverLacks.has(rel)) {
        report.absent.push(rel)
        continue
      }
      const r = await this.passes.request(space, (pass) => fetch(url(rel), { headers: { [TICKET_HEADER]: pass } })).catch((e: Error) => e)
      if (r instanceof Error || !r.ok) {
        report.failed[rel] = r instanceof Error ? `не загружено: ${r.message}` : `не загружено: ${await said(r)}`
        continue
      }
      try {
        kindOf(rel).write(this.vault, rel, new Uint8Array(await r.arrayBuffer()))
        report.fetched.push(rel)
      } catch (e) {
        report.failed[rel] = `не записано: ${(e as Error).message}`
      }
    }
    return report
  }
}
