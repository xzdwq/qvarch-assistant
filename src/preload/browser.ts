/// <reference lib="dom" />
// recording a Playwright scenario (off until the app starts it for this tab)
import './pwRecorder'
import { lookAtPage } from './recorder/pageLook'
import { onMain, sendMain } from './pageIpc'
// sign-in forms: a login sent is offered to keep, a saved one typed in
import './page/passwordFill'
// rulers over the page
import './page/rulers'
// no passkeys offered to pages (a hung Windows dialog would take the page's input with it)
import './noPasskeys'
// no page drags the app's window (a site's own app-region: drag)
import './noWindowDrag'

/**
 * The browser's pages' preload (the section's tabs, the notes' browsers), isolated from the site: each concern a
 * module of its own; the channels to main — shared/browser/pageChannels.ts.
 */

// the app asks what this page offers to act on (an AI agent looking at it — asked to by the person)
onMain('look', (id) => sendMain('lookReply', id, lookAtPage()))
