/** How a run sends a text into a chat (false — not sent: empty, too long). Given by the window that holds the chats. */
export type ChatSend = (room: string, text: string) => boolean

let send: ChatSend | undefined
/** The window's chats given to the runs (the main window — at its start). */
export const setChatSend = (s: ChatSend): void => void (send = s)
/** The chats runs send to (none — this window has no chats). */
export const chatSend = (): ChatSend | undefined => send
