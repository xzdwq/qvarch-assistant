import { QA_CHECK_TIMEOUT, wrapCheck, type QaCheckKind } from '../../../shared/qaChecks'
import { joinFence, splitFence } from '../../domain/fence'
import { fencedBlocksOf } from '../../domain/noteBlocks'
import type { BlockInfo } from '../../domain/blockInfo'

/**
 * A Playwright block's checks («Проверить ▾»): the scenario wrapped into one, its time limit raised to what the check
 * needs. The block's menu and the AI agent's tool do it the same way.
 */

/** A scenario with a check put in, and its info line with the time the check needs (a smaller limit raised). */
export function withCheck(info: BlockInfo, code: string, kind: QaCheckKind): { info: BlockInfo; code: string } | { error: string } {
  const r = wrapCheck(code, kind)
  if ('error' in r) return r
  const least = QA_CHECK_TIMEOUT[kind]
  return { code: r.code, info: least && (info.timeout ?? 0) < least ? { ...info, timeout: least } : info }
}

/** A note's Playwright block (by its name) with a check put in: the note's new text, or why not. */
export function checkBlockIn(text: string, name: string, kind: QaCheckKind): { text: string } | { error: string } {
  const b = fencedBlocksOf(text).find((x) => x.kind === 'pw' && x.info.name === name)
  if (!b) return { error: `В заметке нет блока Playwright «${name}» (name=…)` }
  const parts = splitFence(b.src)
  const r = withCheck(parts.info, parts.body, kind)
  if ('error' in r) return r
  const lines = text.split('\n')
  lines.splice(b.line0 - 1, b.line1 - b.line0 + 1, ...joinFence(parts.fence, r.info, r.code).split('\n'))
  return { text: lines.join('\n') }
}
