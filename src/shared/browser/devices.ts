/** The device a tab pretends to be (the developer's device mode). */
export interface DeviceMode {
  /** A preset's name, or '' — sizes of one's own. */
  name: string
  w: number
  h: number
  /** Device pixels per CSS pixel. */
  dpr: number
  /** A phone / a tablet: touch, the mobile viewport, its User-Agent. */
  mobile: boolean
  ua?: string
}
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
export const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const UA_ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
export const DEVICES: DeviceMode[] = [
  { name: 'iPhone SE', w: 375, h: 667, dpr: 2, mobile: true, ua: UA_IPHONE },
  { name: 'iPhone 12 / 13 / 14', w: 390, h: 844, dpr: 3, mobile: true, ua: UA_IPHONE },
  { name: 'iPhone 14 Pro Max', w: 430, h: 932, dpr: 3, mobile: true, ua: UA_IPHONE },
  { name: 'Pixel 8', w: 412, h: 915, dpr: 2.625, mobile: true, ua: UA_MOBILE },
  { name: 'Samsung Galaxy S20 Ultra', w: 412, h: 915, dpr: 3.5, mobile: true, ua: UA_MOBILE },
  { name: 'Samsung Galaxy A51', w: 412, h: 914, dpr: 2.625, mobile: true, ua: UA_MOBILE },
  { name: 'iPad Mini', w: 768, h: 1024, dpr: 2, mobile: true, ua: UA_IPAD },
  { name: 'iPad Air', w: 820, h: 1180, dpr: 2, mobile: true, ua: UA_IPAD },
  { name: 'iPad Pro 12.9', w: 1024, h: 1366, dpr: 2, mobile: true, ua: UA_IPAD },
  { name: 'Galaxy Tab S9', w: 800, h: 1280, dpr: 2, mobile: true, ua: UA_ANDROID_TAB },
  { name: 'Ноутбук 1366×768', w: 1366, h: 768, dpr: 1, mobile: false },
  { name: 'Ноутбук HD+ 1440×900', w: 1440, h: 900, dpr: 1, mobile: false },
  { name: 'Full HD 1920×1080', w: 1920, h: 1080, dpr: 1, mobile: false },
]
/** Device mode switched on: sizes of one's own, as Chrome's «Адаптивный». */
export const RESPONSIVE: DeviceMode = { name: '', w: 400, h: 800, dpr: 1, mobile: false }
/** The device's picture fitted into the pane (never bigger than it is): its box and scale. */
export function deviceFit(d: DeviceMode, box: { x: number; y: number; w: number; h: number }, pad = 16): { x: number; y: number; w: number; h: number; scale: number } {
  const s = Math.min(1, Math.max(0.05, (box.w - pad * 2) / d.w), Math.max(0.05, (box.h - pad * 2) / d.h))
  const w = Math.round(d.w * s)
  const h = Math.round(d.h * s)
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + Math.max(pad, (box.h - h) / 2)), w, h, scale: Math.round(s * 1000) / 1000 }
}

/** The User-Agents one may choose in the settings ('' — the built-in one). */
export const UA_PRESETS: Array<{ label: string; ua: string }> = [
  { label: 'Встроенный (Chrome)', ua: '' },
  { label: 'Microsoft Edge (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0' },
  { label: 'Firefox (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' },
  { label: 'Safari (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' },
  { label: 'Chrome (Android)', ua: UA_MOBILE },
  { label: 'Safari (iPhone)', ua: UA_IPHONE },
  { label: 'Googlebot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
]
