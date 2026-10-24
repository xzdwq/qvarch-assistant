import type { BlockSpec } from '../../domain/blockSpec'
import { fenceOfLang, fixedHeight } from '../detectors'

/** The feed of every chat and discussion (```chatfeed) — put by «@чат» → «Лента чатов», wherever one wants it. */
export const chatfeedSpec: BlockSpec<'chatfeed'> = {
  kind: 'chatfeed',
  title: 'Лента чатов',
  detect: fenceOfLang('chatfeed'),
  estimateHeight: fixedHeight(640),
  rawEditable: true,
}
