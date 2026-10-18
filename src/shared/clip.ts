/** The clipboard's history (see main/clipLog.ts): texts only, newest first. */
export interface ClipItem {
  id: string
  text: string
  /** When it was copied (the last time, if copied again). */
  at: number
  /** How many times. */
  count: number
}
export interface ClipState {
  on: boolean
  items: ClipItem[]
}
