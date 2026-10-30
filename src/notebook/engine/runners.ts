import { codeRunner } from '../blocks/code/run'
import { httpRunner } from '../blocks/http/run'
import { pwRunner } from '../blocks/pw/run'
import type { RunnableKind } from '../blocks/specs'
import { sqlRunner } from '../blocks/sql/run'
import { tplRunner } from '../blocks/tpl/run'
import { saveRunner } from '../blocks/save/run'
import type { BlockRunner } from './blockRunner'

/** The runners of the runnable kinds (the compiler checks every runnable spec has one). */
export const BLOCK_RUNNERS: { readonly [K in RunnableKind]: BlockRunner } = {
  http: httpRunner,
  code: codeRunner,
  pw: pwRunner,
  sql: sqlRunner,
  tpl: tplRunner,
  save: saveRunner,
}
