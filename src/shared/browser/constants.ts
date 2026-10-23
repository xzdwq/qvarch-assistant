/** Value sets of the browser context (checks, tries, recording): one list per mode, the union derived from it. */

/** How a check's row / a try came out: fine, worth a look, broken. */
export const QA_MARKS = ['ok', 'warn', 'fail'] as const
export type QaMark = (typeof QA_MARKS)[number]
