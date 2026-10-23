import { contentsOf, type AppContext } from '../app/appContext'
import { TabletService } from '../tablet'
import { emit, handle } from './router'

/** The pen tablet (Qvarch reads it and drives the mouse): its settings, live samples, the board's area on screen. */
export function registerTabletIpc(app: AppContext): void {
  const tablet = new TabletService(
    app.store.root,
    () => {
      const main = app.windows.main
      return main && !main.isDestroyed() ? main.getNativeWindowHandle().readBigUInt64LE(0) : undefined
    },
    (msg) => emit(contentsOf(app.windows.main), 'onTablet', msg),
  )
  app.tablet = tablet
  handle('tabletState', () => tablet.state())
  handle('tabletSet', (_e, patch) => tablet.set(patch))
  handle('tabletLive', (_e, on) => tablet.live(!!on))
  handle('tabletCanvas', (_e, rect) => tablet.canvas(rect && rect.w > 0 && rect.h > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } : undefined))
}
