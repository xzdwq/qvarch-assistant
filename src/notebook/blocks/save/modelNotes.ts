import { fencedBlocksOf } from '../../domain/noteBlocks'
import { saveMd, saveOf } from './model'

/**
 * A note's «Сохранить в файл» blocks, as the «Значение» block asks of them. (Apart from the model: reading a note's
 * blocks goes through the blocks' registry, which the spec — and so the model — is part of.)
 */
/** The note saves this variable already. */
export const savesOf = (noteText: string, ref: string): boolean => fencedBlocksOf(noteText).some((b) => b.kind === 'save' && saveOf(b.body).ref === ref)
/** A note with a block saving the variable put at its end (one there already — as it is). */
export const withSaveBlock = (noteText: string, ref: string): string => (savesOf(noteText, ref) ? noteText : `${noteText.replace(/\s*$/, '')}\n\n${saveMd(ref)}\n`)
