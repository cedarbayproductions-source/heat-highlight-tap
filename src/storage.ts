import { FALLBACK_GAME } from './game'
import type {
  ActiveGame,
  GameLabelFields,
  GameSource,
  OpenShift,
  TapEvent,
} from './types'

const ACTIVE_KEY = 'heat-highlight-active-game-v1'
const TAPS_KEY = 'heat-highlight-taps-v1'
const OPEN_SHIFT_KEY = 'heat-highlight-open-shift-v1'

function isSource(v: unknown): v is GameSource {
  return v === 'caha' || v === 'manual'
}

export function parseActiveGame(raw: unknown): ActiveGame | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (!isSource(g.source) || typeof g.opponent !== 'string' || !g.opponent.trim()) {
    return null
  }
  const opponent = g.opponent.trim()
  return {
    source: g.source,
    gameId: typeof g.gameId === 'number' ? g.gameId : null,
    scheduleId: typeof g.scheduleId === 'string' ? g.scheduleId : null,
    opponent,
    opponentShort:
      typeof g.opponentShort === 'string' && g.opponentShort.trim()
        ? g.opponentShort.trim()
        : opponent,
    date: typeof g.date === 'string' ? g.date : null,
    start: typeof g.start === 'string' ? g.start : null,
    venue: typeof g.venue === 'string' ? g.venue : null,
    side: g.side === 'home' || g.side === 'visitor' ? g.side : null,
    note: typeof g.note === 'string' ? g.note : null,
    tournamentUrl: typeof g.tournamentUrl === 'string' ? g.tournamentUrl : null,
    heatLabel:
      typeof g.heatLabel === 'string' && g.heatLabel.trim()
        ? g.heatLabel.trim()
        : FALLBACK_GAME.heatLabel,
    fetchedAtIso: typeof g.fetchedAtIso === 'string' ? g.fetchedAtIso : null,
  }
}

export function loadActiveGame(): ActiveGame {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (!raw) return { ...FALLBACK_GAME }
    return parseActiveGame(JSON.parse(raw)) ?? { ...FALLBACK_GAME }
  } catch {
    return { ...FALLBACK_GAME }
  }
}

export function saveActiveGame(game: ActiveGame): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(game))
}

function labelFields(
  e: Record<string, unknown>,
  fallback: ActiveGame | null,
): GameLabelFields {
  return {
    gameId:
      typeof e.gameId === 'number'
        ? e.gameId
        : e.gameId === null
          ? null
          : (fallback?.gameId ?? null),
    gameSource: e.gameSource === 'manual' ? 'manual' : 'caha',
    opponent:
      typeof e.opponent === 'string' && e.opponent.trim()
        ? e.opponent.trim()
        : (fallback?.opponent ?? 'Unknown'),
    opponentShort:
      typeof e.opponentShort === 'string' && e.opponentShort.trim()
        ? e.opponentShort.trim()
        : (fallback?.opponentShort ?? 'Unknown'),
    tournamentUrl: typeof e.tournamentUrl === 'string' ? e.tournamentUrl : null,
  }
}

export function parseTap(
  raw: unknown,
  fallback: ActiveGame | null,
): TapEvent | null {
  if (!raw || typeof raw !== 'object' || !('id' in raw)) return null
  const e = raw as Record<string, unknown>
  if (e.type === 'sync') {
    if (!e.syncType || !e.period || !e.gameClock) return null
    return {
      id: String(e.id),
      type: 'sync',
      wallTimeMs: Number(e.wallTimeMs),
      wallTimeIso: String(e.wallTimeIso),
      syncType: e.syncType as 'Puck drop' | 'Stoppage' | 'Other',
      period: e.period as 'P1' | 'P2' | 'P3' | 'OT',
      gameClock: String(e.gameClock),
      note: (e.note as string | null) ?? null,
      createdAtIso: String(e.createdAtIso),
      ...labelFields(e, fallback),
    }
  }
  if (e.type === 'shift') {
    if (
      typeof e.player !== 'string' ||
      typeof e.startWallMs !== 'number' ||
      typeof e.endWallMs !== 'number'
    ) {
      return null
    }
    const startWallIso =
      typeof e.startWallIso === 'string'
        ? e.startWallIso
        : new Date(e.startWallMs).toISOString()
    const endWallIso =
      typeof e.endWallIso === 'string'
        ? e.endWallIso
        : new Date(e.endWallMs).toISOString()
    const durationMs =
      typeof e.durationMs === 'number'
        ? e.durationMs
        : Math.max(0, e.endWallMs - e.startWallMs)
    return {
      id: String(e.id),
      type: 'shift',
      player: e.player,
      wallTimeMs: e.startWallMs,
      wallTimeIso: startWallIso,
      startWallMs: e.startWallMs,
      startWallIso,
      endWallMs: e.endWallMs,
      endWallIso,
      durationMs,
      createdAtIso: String(e.createdAtIso),
      ...labelFields(e, fallback),
    }
  }
  if (!e.scorer) return null
  return {
    id: String(e.id),
    type: 'goal',
    wallTimeMs: Number(e.wallTimeMs),
    wallTimeIso: String(e.wallTimeIso),
    scorer: String(e.scorer),
    assist1: (e.assist1 as string | null) ?? null,
    assist2: (e.assist2 as string | null) ?? null,
    duringShift: e.duringShift === true || undefined,
    createdAtIso: String(e.createdAtIso),
    ...labelFields(e, fallback),
  }
}

export function loadTaps(fallback: ActiveGame | null = null): TapEvent[] {
  try {
    const raw = localStorage.getItem(TAPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((t) => parseTap(t, fallback))
      .filter((t): t is TapEvent => t !== null)
  } catch {
    return []
  }
}

export function saveTaps(taps: TapEvent[]): void {
  localStorage.setItem(TAPS_KEY, JSON.stringify(taps))
}

export function loadOpenShift(): OpenShift | null {
  try {
    const raw = localStorage.getItem(OPEN_SHIFT_KEY)
    if (!raw) return null
    const t = JSON.parse(raw)
    if (
      !t ||
      typeof t.player !== 'string' ||
      typeof t.startWallMs !== 'number' ||
      typeof t.startWallIso !== 'string'
    ) {
      return null
    }
    return t as OpenShift
  } catch {
    return null
  }
}

export function saveOpenShift(shift: OpenShift | null): void {
  if (shift) localStorage.setItem(OPEN_SHIFT_KEY, JSON.stringify(shift))
  else localStorage.removeItem(OPEN_SHIFT_KEY)
}

export function labelsFromGame(game: ActiveGame): GameLabelFields {
  return {
    gameId: game.gameId,
    gameSource: game.source,
    opponent: game.opponent,
    opponentShort: game.opponentShort,
    tournamentUrl: game.tournamentUrl,
  }
}
