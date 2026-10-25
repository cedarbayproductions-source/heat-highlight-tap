import type { ActiveGame } from './types'

/** CAHA / rink local zone for Heat schedule times. */
export const GAME_TZ = 'America/Los_Angeles'

/**
 * Parse ActiveGame.date (YYYY-MM-DD) + start ("9:45 AM" or "09:45") into
 * epoch ms for that wall clock in America/Los_Angeles (DST-aware).
 */
export function gameStartMs(
  game: Pick<ActiveGame, 'date' | 'start'>,
  timeZone: string = GAME_TZ,
): number | null {
  if (!game.date || !game.start) return null
  const dm = game.date.trim().match(/^(20\d{2})-(\d{2})-(\d{2})$/)
  if (!dm) return null
  const y = Number(dm[1])
  const mo = Number(dm[2])
  const d = Number(dm[3])
  const parsed = parseClock(game.start.trim())
  if (!parsed) return null
  return zonedWallTimeToUtcMs(y, mo, d, parsed.hour, parsed.minute, timeZone)
}

function parseClock(start: string): { hour: number; minute: number } | null {
  const ampm = start.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (ampm) {
    let hour = Number(ampm[1]) % 12
    if (/pm/i.test(ampm[3])) hour += 12
    const minute = Number(ampm[2])
    if (minute > 59) return null
    return { hour, minute }
  }
  const mil = start.match(/^(\d{1,2}):(\d{2})$/)
  if (mil) {
    const hour = Number(mil[1])
    const minute = Number(mil[2])
    if (hour > 23 || minute > 59) return null
    return { hour, minute }
  }
  return null
}

/** Find UTC instant whose wall time in `timeZone` matches y-mo-d h:min. */
function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utc))
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second') || 0,
    )
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
    utc += desired - asUtc
  }
  return utc
}

/** Format start for UI, e.g. "Sun 9:45 AM". */
export function formatGameStartLabel(
  game: Pick<ActiveGame, 'date' | 'start'>,
  timeZone: string = GAME_TZ,
): string | null {
  const ms = gameStartMs(game, timeZone)
  if (ms == null) {
    if (game.start) return game.start
    return null
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms))
}

/** Normalize `<input type="time">` value (HH:MM) to CAHA-style "h:mm AM/PM". */
export function timeInputToStartLabel(hhmm: string): string | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(min).padStart(2, '0')} ${ap}`
}

/** Convert stored "9:45 AM" → "09:45" for time inputs. */
export function startLabelToTimeInput(start: string | null): string {
  if (!start) return ''
  const p = parseClock(start.trim())
  if (!p) return ''
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
