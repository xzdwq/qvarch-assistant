import type { ModuleFactory } from '../module'
import { chatModule } from './chat'
import { coreModule } from './core'
import { docModule } from './doc'
import { mediaModule } from './media'
import { resultsModule } from './results'
import { spaceModule } from './space'

/**
 * The server's modules in order (a module's tables may refer to the ones before it). A new area — presence, shared
 * folders, analytics, tasks given to others — is one more line here and its own folder.
 */
export const MODULES: readonly ModuleFactory[] = [coreModule, chatModule, spaceModule, docModule, mediaModule, resultsModule]
