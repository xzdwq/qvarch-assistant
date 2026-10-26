/**
 * Браузер: tabs (each a page of its own, a profile apart from the app), one or two panes, bookmarks — and the
 * recording of the requests a page sends (XHR / fetch), which become a chain of requests in the HTTP section.
 * The pieces live in ./browser/; this entry keeps one import for all of them.
 */
export * from './browser/tabs'
export * from './browser/devices'
export * from './browser/recording'
export { hostKey } from './browser/recordedRequest'
export * from './browser/recordingLinks'
export * from './browser/recordingToHttp'
export * from './browser/apiMapToRec'
export * from './browser/api'
