import { ISLAND_CHAT_OPS, ISLAND_OPS_SHOWING_APP, NO_ISLAND_CHAT, type IslandChatOp, type IslandChatState } from '../../shared/islandChat'
import { contentsOf, type AppContext } from '../app/appContext'
import { emit, handle, listen } from './router'
import { WindowAsk } from './windowAsk'

/**
 * The chats in the island: the main window holds them and tells their short state (kept here, passed to the island);
 * the island's asks (a room's messages, a message sent, a room opened) go to the main window and its answers back.
 */
export function registerIslandChatIpc(app: AppContext): void {
  let state: IslandChatState = NO_ISLAND_CHAT
  listen('islandChatPublish', (_e, s) => {
    state = s
    emit(contentsOf(app.windows.island?.win), 'onIslandChat', s)
  })
  handle('islandChatGet', () => state)

  const asker = new WindowAsk((id, op, args) => {
    const w = contentsOf(app.windows.main)
    if (w) emit(w, 'onIslandChatCall', id, op as IslandChatOp, args)
    return !!w
  }, 'Окно Qvarch закрыто — чаты недоступны')
  listen('islandChatReply', (_e, id, ok, value) => asker.settle(String(id), ok, value))
  handle('islandChatCall', async (_e, op, args) => {
    if (!(ISLAND_CHAT_OPS as readonly string[]).includes(op)) throw new Error(`Неизвестная операция ${op}`)
    // (a file goes to the server meanwhile: its time is longer)
    const r = await asker.ask(op, args ?? {}, 120_000)
    // (a room opened, a link, a note taken — shown in the app once done; failed — the island says why)
    if (ISLAND_OPS_SHOWING_APP.has(op)) app.windows.showMain()
    return r
  })
}
