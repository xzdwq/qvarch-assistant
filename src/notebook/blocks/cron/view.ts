import { blockView } from '../../ui/blockView'
import BlockCron from './BlockCron.vue'

/** The notes' schedules (this note's new one, every one listed). */
export const cronView = blockView(BlockCron, ['path'])
