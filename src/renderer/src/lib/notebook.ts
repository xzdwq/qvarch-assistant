/**
 * The notebook's state, shared by everything that shows it (and kept while another section is open, so coming
 * back is instant): the tree, the open documents with autosave, and the panes with their tabs. The parts live in
 * src/notebook/workspace/; this is their one entry for the renderer.
 */
export { tree, files, loadTree } from '@nb/workspace/vaultTreeStore'
export { type Doc, docs, doc, setText, save, saveAll, isDirty } from '@nb/workspace/noteDocs'
export { imageUrl, audioUrl, takeImages, hasImages, draggedImageUrl } from '@nb/workspace/noteMedia'
export { transcribing, transcribeError, cancelTranscribe, TranscribeCancelled, transcribe } from '@nb/workspace/transcription'
export { type Tab, type Pane, layout, curPane, activePath, openFile, closeTab, closeEverywhere, toggleSplit, swapTab, splitWith, moveTab } from '@nb/workspace/paneLayout'
export { remap, onOutside, dropAudio, putTranscript } from '@nb/workspace/noteSync'
export { noteName, dirOf } from '@nb/domain/notePaths'
export { type SortMode, SORTS, sortNodes } from '@shared/vaultTree'
export { fixDuration } from './recorder'
