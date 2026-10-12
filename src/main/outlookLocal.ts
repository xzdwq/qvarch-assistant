import { execFile } from 'node:child_process'
import type { OutlookEvent } from '../shared/outlook'

/**
 * Meetings straight from the classic Outlook running on this computer (its COM object model), read-only:
 * no Azure app, no consent — it is the user's own mail client and the calendar it already keeps in sync.
 * Outlook must be running (a hidden instance is never started); the new Outlook (olk) has no COM.
 */
const SCRIPT = (backDays: number, aheadDays: number) => `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { '{"error":"notRunning"}'; exit }
$from = (Get-Date).Date.AddDays(-${backDays})
$to = (Get-Date).Date.AddDays(${aheadDays + 1})
$items = $ol.Session.GetDefaultFolder(9).Items
$items.Sort('[Start]')
$items.IncludeRecurrences = $true
$f = "[Start] < '" + $to.ToString('g') + "' AND [End] > '" + $from.ToString('g') + "'"
$out = New-Object System.Collections.ArrayList
foreach ($a in $items.Restrict($f)) {
  if ($out.Count -gt 3000) { break }
  [void]$out.Add([ordered]@{
    id = ($a.GlobalAppointmentID + '|' + $a.StartUTC.ToString('s'))
    subject = $a.Subject
    start = $a.StartUTC.ToString('s') + 'Z'
    end = $a.EndUTC.ToString('s') + 'Z'
    allDay = $a.AllDayEvent
    busy = $a.BusyStatus
    response = $a.ResponseStatus
    status = $a.MeetingStatus
    organizer = $a.Organizer
    location = $a.Location
  })
}
ConvertTo-Json -InputObject @{ events = $out.ToArray() } -Depth 3 -Compress
`

interface Raw {
  id: string
  subject?: string
  start: string
  end: string
  allDay?: boolean
  busy?: number
  response?: number
  status?: number
  organizer?: string
  location?: string
}
// Outlook enums → the Graph words the rest of the app uses
const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere']
const RESPONSE = ['none', 'organizer', 'tentativelyAccepted', 'accepted', 'declined', 'notResponded']
/** olMeetingCanceled = 5, olMeetingReceivedAndCanceled = 7 */
const CANCELLED = [5, 7]

export function readLocalOutlook(backDays: number, aheadDays: number): Promise<OutlookEvent[]> {
  const encoded = Buffer.from(SCRIPT(backDays, aheadDays), 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 90_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`Outlook не ответил: ${err.message.split('\n')[0]}`))
        let data: { error?: string; events?: Raw[] | Raw }
        try {
          data = JSON.parse(stdout.trim()) as typeof data
        } catch {
          return reject(new Error('Outlook вернул непонятный ответ — нужен классический Outlook (не «новый»)'))
        }
        if (data.error === 'notRunning') return reject(new Error('Outlook не запущен — встречи подтянутся, когда он будет открыт'))
        // one item comes as an object, not an array
        const list = Array.isArray(data.events) ? data.events : data.events ? [data.events] : []
        resolve(
          list.map((r) => ({
            id: r.id,
            subject: r.subject ?? '',
            start: Date.parse(r.start),
            end: Date.parse(r.end),
            allDay: !!r.allDay,
            cancelled: CANCELLED.includes(r.status ?? 0),
            showAs: SHOW_AS[r.busy ?? 2] ?? 'busy',
            response: RESPONSE[r.response ?? 0] ?? 'none',
            organizer: r.organizer || undefined,
            online: /teams|skype|zoom/i.test(r.location ?? ''),
            location: r.location || undefined,
            attendees: 0,
          })),
        )
      },
    )
  })
}
