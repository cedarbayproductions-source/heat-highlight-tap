import { HEAT_LABEL } from './roster'
import type { ActiveGame, Side } from './types'

export const FALLBACK_GAME: ActiveGame = {
  source: 'caha',
  gameId: 58010,
  scheduleId: 'S149166330',
  opponent: 'Junior Reign 16AA-2',
  opponentShort: 'Jr Reign',
  date: '2026-10-25',
  start: '9:45 AM',
  venue: 'Santa Clarita Oly',
  side: 'home',
  note: null,
  tournamentUrl: null,
  heatLabel: HEAT_LABEL,
  fetchedAtIso: null,
}

export const CAHA_SCHEDULE_URL =
  'https://stats.caha.timetoscore.com/display-schedule?team=108&season=33&league=5&stat_class=1'

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

type ScheduleRow = {
  scheduleId: string
  gameId: number | null
  dateLabel: string
  dateISO: string
  start: string
  venue: string
  visitor: string
  home: string
  awayGoals: string
  homeGoals: string
  gameType: string
  played: boolean
  sortKey: number
}

function stripHtml(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDateLabel(label: string, now = new Date()): Date | null {
  const m = label
    .trim()
    .match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d{1,2})$/i)
  if (!m) return null
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()]
  if (month == null) return null
  const day = Number(m[2])
  if (!Number.isFinite(day)) return null
  const year = now.getFullYear()
  let d = new Date(year, month, day, 12, 0, 0)
  const deltaDays = (d.getTime() - now.getTime()) / 864e5
  if (deltaDays < -120) d = new Date(year + 1, month, day, 12, 0, 0)
  else if (deltaDays > 240) d = new Date(year - 1, month, day, 12, 0, 0)
  return d
}

export function shortOpponent(name: string): string {
  return (
    name
      .replace(/\bJunior\b/gi, 'Jr')
      .replace(/\bLos Angeles\b/gi, 'LA')
      .replace(/\s*16AA-\d+\s*/gi, ' ')
      .replace(/\s*16AA\b/gi, ' ')
      .replace(/\s*16U\s*AA\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || name
  )
}

function parseGameId(tdHtml: string, scheduleId: string): number | null {
  const m = tdHtml.match(/game_id=(\d+)/i)
  if (m) return Number(m[1])
  const cleaned = scheduleId.replace(/\*$/, '')
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null
}

function parseScheduleRows(html: string, now = new Date()): ScheduleRow[] {
  const cleaned = html.replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ')
  const rows = cleaned.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []
  const out: ScheduleRow[] = []
  for (const row of rows) {
    const tds = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi)
    if (!tds || tds.length < 11) continue
    const cells = tds.map(stripHtml)
    if (!/\d{1,2}:\d{2}\s*[AP]M/i.test(cells[2] ?? '')) continue
    const scheduleId = (cells[0] ?? '').replace(/\*$/, '').trim()
    if (!scheduleId) continue
    const dateLabel = (cells[1] ?? '').trim()
    const date = parseDateLabel(dateLabel, now)
    if (!date) continue
    const visitor = (cells[6] ?? '').trim()
    const home = (cells[8] ?? '').trim()
    if (!visitor && !home) continue
    const awayGoals = (cells[7] ?? '').trim()
    const homeGoals = (cells[9] ?? '').trim()
    const played = awayGoals !== '' && homeGoals !== ''
    out.push({
      scheduleId,
      gameId: parseGameId(tds[0], scheduleId),
      dateLabel,
      dateISO: toISODate(date),
      start: (cells[2] ?? '').trim(),
      venue: (cells[3] ?? '').trim(),
      visitor,
      home,
      awayGoals,
      homeGoals,
      gameType: (cells[10] ?? '').trim(),
      played,
      sortKey: date.getTime(),
    })
  }
  return out
}

function pickNextGame(rows: ScheduleRow[], now = new Date()): ScheduleRow | null {
  if (!rows.length) return null
  const today = toISODate(now)
  const todays = rows.filter((r) => r.dateISO === today)
  if (todays.length) {
    return todays.find((r) => !r.played) ?? todays[todays.length - 1]
  }
  const upcoming = rows
    .filter((r) => !r.played && r.dateISO >= today)
    .sort((a, b) => a.sortKey - b.sortKey)
  if (upcoming[0]) return upcoming[0]
  return [...rows].sort((a, b) => b.sortKey - a.sortKey)[0] ?? null
}

function heatSide(row: ScheduleRow): Side | null {
  if (row.home.includes('Heat')) return 'home'
  if (row.visitor.includes('Heat')) return 'visitor'
  return null
}

function opponentFromRow(row: ScheduleRow): string {
  const side = heatSide(row)
  if (side === 'home') return row.visitor || 'Opponent'
  if (side === 'visitor') return row.home || 'Opponent'
  if (/^away$/i.test(row.visitor)) {
    return row.home.includes('Heat') ? 'Opponent' : row.home
  }
  return row.visitor.includes('Heat') ? row.home : row.visitor
}

/** Known schedule-id → TTS when OSS link is not yet on the table. */
const SCHEDULE_TTS: Record<string, number> = {
  S149166330: 58010,
}

function resolveGameId(row: ScheduleRow): number | null {
  if (row.gameId != null) return row.gameId
  if (row.scheduleId && SCHEDULE_TTS[row.scheduleId] != null) {
    return SCHEDULE_TTS[row.scheduleId]
  }
  return null
}

function rowToActiveGame(row: ScheduleRow, now = new Date()): ActiveGame {
  const opponent = opponentFromRow(row)
  return {
    source: 'caha',
    gameId: resolveGameId(row),
    scheduleId: row.scheduleId,
    opponent,
    opponentShort: shortOpponent(opponent),
    date: row.dateISO,
    start: row.start,
    venue: row.venue,
    side: heatSide(row),
    note: null,
    tournamentUrl: null,
    heatLabel: HEAT_LABEL,
    fetchedAtIso: now.toISOString(),
  }
}

export async function fetchCahaActiveGame(
  now = new Date(),
): Promise<{ game: ActiveGame; games: ScheduleRow[] }> {
  const res = await fetch(CAHA_SCHEDULE_URL, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`CAHA schedule HTTP ${res.status}`)
  const rows = parseScheduleRows(await res.text(), now)
  const picked = pickNextGame(rows, now)
  if (!picked) throw new Error('No games found on CAHA schedule')
  return { game: rowToActiveGame(picked, now), games: rows }
}

export function gameIdLabel(game: ActiveGame): string {
  if (game.source === 'manual') return 'custom'
  if (game.gameId == null) {
    return game.scheduleId ? game.scheduleId : 'CAHA'
  }
  return `TTS ${game.gameId}`
}

export function makeManualGame(input: {
  opponent: string
  date?: string
  start?: string
  venue?: string
  note?: string
  tournamentUrl?: string
}): ActiveGame {
  const opponent = input.opponent.trim()
  return {
    source: 'manual',
    gameId: null,
    scheduleId: null,
    opponent,
    opponentShort: shortOpponent(opponent),
    date: input.date?.trim() || null,
    start: input.start?.trim() || null,
    venue: input.venue?.trim() || null,
    side: null,
    note: input.note?.trim() || null,
    tournamentUrl: input.tournamentUrl?.trim() || null,
    heatLabel: HEAT_LABEL,
    fetchedAtIso: new Date().toISOString(),
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function metaContent(html: string, name: string): string | null {
  const a = html.match(
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ),
  )
  if (a?.[1]) return decodeEntities(a[1].trim())
  const b = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      'i',
    ),
  )
  return b?.[1] ? decodeEntities(b[1].trim()) : null
}

function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m?.[1] ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : null
}

function findDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  }
}

export async function hintFromTournamentUrl(url: string): Promise<{
  title?: string
  opponent?: string
  date?: string
  note?: string
}> {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return {}
  try {
    const res = await fetch(trimmed, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!res.ok) {
      return {
        note: 'Could not read that page (HTTP error). Set opponent manually.',
      }
    }
    const html = await res.text()
    if (html.length > 1.5e6) {
      return { note: 'Page too large to scan. Set opponent manually.' }
    }
    const title =
      metaContent(html, 'og:title') ||
      metaContent(html, 'twitter:title') ||
      pageTitle(html) ||
      undefined
    const desc =
      metaContent(html, 'og:description') ||
      metaContent(html, 'description') ||
      ''
    const blob = `${title ?? ''} ${desc}`
    const date = findDate(blob) ?? findDate(html.slice(0, 2e4))
    const vs = blob.match(/\bvs\.?\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,40})/i)
    let opponent: string | undefined
    if (vs?.[1]) {
      opponent = vs[1].replace(/\s+/g, ' ').trim().split('|')[0]?.trim()
    }
    const out: {
      title?: string
      opponent?: string
      date?: string
      note?: string
    } = {}
    if (title) out.title = title
    if (opponent) out.opponent = opponent
    if (date) out.date = date
    if (!opponent) {
      out.note = title
        ? `Opened “${title.slice(0, 60)}” — set opponent manually.`
        : 'Page loaded but no opponent found. Set opponent manually.'
    }
    return out
  } catch {
    return {
      note: 'Site blocked browser fetch (CORS). Paste opponent manually — URL is still saved.',
    }
  }
}
