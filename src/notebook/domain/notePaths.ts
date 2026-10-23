/** A vault path's parts: the note's shown name (no extension), its folder. */
export const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|qboard)$/i, '')
export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')
