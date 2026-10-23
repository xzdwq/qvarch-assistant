import { Facet, StateEffect } from '@codemirror/state'

/**
 * What the note editor's extensions ask of the component that hosts them: the note's path and the events they
 * raise (a recording to transcribe, a [[link]] clicked…). Given once, as a facet: an extension reads it from the
 * view's state, never from the component's props.
 */
export interface EditorHost {
  /** The note's path in the vault ('' — no note: nothing runs, no values). */
  notePath(): string
  /** A recording asked to be transcribed. */
  transcribe(rel: string): void
  /** A recording asked to be deleted (from the note and the disk). */
  dropAudio(rel: string): void
  /** A [[link]] followed. */
  openWiki(target: string): void
  /** Something to tell the person (a picture not taken…). */
  warn(text: string): void
  /** «@аудио»: a voice recording into the note asked for. */
  requestRecording(): void
  /** «@изображение»: a picture from a file asked for. */
  requestImage(): void
}
const NO_HOST: EditorHost = { notePath: () => '', transcribe: () => undefined, dropAudio: () => undefined, openWiki: () => undefined, warn: () => undefined, requestRecording: () => undefined, requestImage: () => undefined }
export const editorHost = Facet.define<EditorHost, EditorHost>({ combine: (hosts) => hosts[0] ?? NO_HOST })

/**
 * The user events that mark the editor's own changes to components (inserted, deleted, moved): the guard lets them
 * through, the «@» menu knows them from typing.
 */
export const COMPONENT_INPUT = 'input.component'
export const COMPONENT_DELETE = 'delete.component'
export const COMPONENT_MOVE = 'move.component'

/** Redraw the decorations (values, chips, players changed outside the text). */
export const refreshDecorations = StateEffect.define<null>()
