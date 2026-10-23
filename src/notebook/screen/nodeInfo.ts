import { findNode } from '@shared/vaultTree'
import { layout } from '@nb/workspace/paneLayout'
import { tree } from '@nb/workspace/vaultTreeStore'
import { longDate } from '@nb/domain/noteFacts'

/** A file's marks and facts as the tree has them (read through Vue: the screen follows the tree). */
export const colorOf = (path: string) => findNode(tree.value, path)?.color
export const emojiOf = (path: string) => findNode(tree.value, path)?.emoji
/** The note / board a file is linked with. */
export const pairOf = (path: string) => findNode(tree.value, path)?.pair
/** When the file was created, in words ('' — unknown). */
export const createdOf = (path: string) => longDate(findNode(tree.value, path)?.ctime)

/** The text's scale: Ctrl + wheel over the note, or the badge in its status line (50…250 %, by 10). */
export const BASE_PX = 14.5
export const clampZoom = (z: number) => Math.min(250, Math.max(50, Math.round(z / 10) * 10))
export function setZoom(z: number): void {
  layout.zoom = clampZoom(z)
}
