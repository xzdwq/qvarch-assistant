/**
 * The recorder's DOM side: how an element is found again (a locator Playwright runs) and said in words (a step) —
 * no events, no IPC: the recording (pwRecorder.ts) uses it, the tests run it in a real page against fixtures.
 * The pieces live in ./recorder/; this entry keeps one import (and one bundle) for all of them.
 */
export * from './recorder/domText'
export * from './recorder/fieldLocators'
export * from './recorder/cssPath'
export * from './recorder/testIdLocators'
export * from './recorder/locators'
export * from './recorder/stepWords'
