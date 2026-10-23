import type { DeviceMode } from '../../shared/browser'
import type { BrowserHost, Tab } from './tab'

/**
 * The device mode: a tab as a phone, a tablet or a screen of a size of its own — its size, density, touch and
 * User-Agent told to the page over the DevTools protocol; drawn smaller to fit its pane.
 */
export class DeviceEmulation {
  constructor(private host: BrowserHost) {}

  /** A tab as a device (undefined — as itself again). */
  set(id: string, d?: DeviceMode): void {
    const t = this.host.tabs.get(id)
    if (!t) return
    this.host.wake(t)
    const before = t.t.device
    if (!d) {
      if (!before) return
      t.t.device = undefined
      t.devScale = undefined
      const dbg = t.view.webContents.debugger
      const wasMobileUa = !!before.ua
      void (async () => {
        try {
          if (dbg.isAttached()) {
            await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
            await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
            await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false })
            await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: this.host.userAgent() })
          }
        } catch {
          // the page is going
        }
        this.host.cdp.drop(t, 'device')
        // the site saw a phone: it is asked again as itself
        if (wasMobileUa) t.view.webContents.reload()
      })()
      this.host.changed()
      return
    }
    const w = Math.round(Math.min(4000, Math.max(50, d.w)))
    const h = Math.round(Math.min(4000, Math.max(50, d.h)))
    const dpr = Math.min(5, Math.max(0.5, d.dpr || 1))
    t.t.device = { name: String(d.name ?? ''), w, h, dpr, mobile: !!d.mobile, ua: d.ua || undefined }
    const uaChanged = (before?.ua ?? '') !== (t.t.device.ua ?? '')
    this.host.changed()
    void this.apply(t).then(() => uaChanged && t.view.webContents.getURL() && !t.view.webContents.getURL().startsWith('about:') && t.view.webContents.reload())
  }
  /** The device mode told to the page: its size, scale (to fit the pane), touch, User-Agent. */
  async apply(t: Tab, sizeOnly = false): Promise<void> {
    const dv = t.t.device
    if (!dv) return
    try {
      const d = this.host.cdp.use(t, 'device')
      const scale = t.devScale ?? 1
      await d.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: dv.w,
        height: dv.h,
        // (Chromium honours its own density for a mobile device only; a computer keeps the screen's)
        deviceScaleFactor: dv.mobile ? dv.dpr : 0,
        mobile: dv.mobile,
        scale,
        screenWidth: dv.w,
        screenHeight: dv.h,
        screenOrientation: dv.w > dv.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
      })
      if (sizeOnly) return
      await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: dv.mobile, maxTouchPoints: dv.mobile ? 5 : 1 })
      await d.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: dv.mobile, configuration: dv.mobile ? 'mobile' : 'desktop' })
      await d.sendCommand('Emulation.setUserAgentOverride', { userAgent: dv.ua || this.host.userAgent() })
    } catch (e) {
      this.host.emit('recError', `Режим устройства не включился: ${e instanceof Error ? e.message : String(e)}`)
      t.t.device = undefined
      this.host.cdp.drop(t, 'device')
      this.host.changed()
    }
  }
}
