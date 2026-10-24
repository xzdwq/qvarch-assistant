import type { RunnableKind } from '@nb/blocks/specs'
import type { BlockKind } from '@nb/domain/blockSpec'
import { audioView } from '../blocks/audio/view'
import { boardView } from '../blocks/board/view'
import { browserView } from '../blocks/browser/view'
import { calloutView } from '../blocks/callout/view'
import { chartView } from '../blocks/chart/view'
import { chatView } from '../blocks/chat/view'
import { chatfeedView } from '../blocks/chatfeed/view'
import { codeView } from '../blocks/code/view'
import { dataView } from '../blocks/data/view'
import { filesView } from '../blocks/files/view'
import { httpView } from '../blocks/http/view'
import { imageView } from '../blocks/image/view'
import { loopView } from '../blocks/loop/view'
import { loopEndView } from '../blocks/loopEnd/view'
import { mermaidView } from '../blocks/mermaid/view'
import { pwView } from '../blocks/pw/view'
import { refView } from '../blocks/ref/view'
import { regressView } from '../blocks/regress/view'
import { sqlView } from '../blocks/sql/view'
import { tableView } from '../blocks/table/view'
import { tocView } from '../blocks/toc/view'
import { toggleView } from '../blocks/toggle/view'
import { tplView } from '../blocks/tpl/view'
import { workView } from '../blocks/work/view'
import type { BlockView, RunnableBlockView } from './blockView'

/** The registry of the block kinds' views (the compiler checks every kind has one; a runnable one — its pass result's shape). */
export const BLOCK_VIEWS: { readonly [K in BlockKind]: K extends RunnableKind ? RunnableBlockView : BlockView } = {
  table: tableView,
  chart: chartView,
  mermaid: mermaidView,
  toc: tocView,
  callout: calloutView,
  toggle: toggleView,
  work: workView,
  audio: audioView,
  image: imageView,
  board: boardView,
  chat: chatView,
  chatfeed: chatfeedView,
  http: httpView,
  code: codeView,
  data: dataView,
  ref: refView,
  pw: pwView,
  browser: browserView,
  regress: regressView,
  files: filesView,
  sql: sqlView,
  tpl: tplView,
  loop: loopView,
  loopEnd: loopEndView,
}
