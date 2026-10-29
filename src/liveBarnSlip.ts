import type { ActiveGame, ShiftEvent, SyncEvent, TapEvent } from './types'
import { buildMediaAnchor, pickSyncAnchor, wallToMediaMs } from './mediaTime'

const SLIP_KEY = 'heat-highlight-lb-slip-v1'

export type LandmarkKind = 'sync' | 'shiftOn'

export type LiveBarnLandmark = {
  kind: LandmarkKind
  /** 1-based shift index when kind is shiftOn */
  shiftIndex: number | null
  sourceId: string | null
  wallMs: number
  /** User-entered LiveBarn media time for that wall moment (ms). */
  mediaMs: number
}

export type LiveBarnSlipState = {
  /** Fixed offset added to all Sync-relative media In/Out times. */
  slipMs: number
  landmark: LiveBarnLandmark | null
  mode: 'none' | 'landmark' | 'manual'
  updatedAtIso: string
}

export type SlipByGame = Record<string, LiveBarnSlipState>

export function emptySlip(): LiveBarnSlipState {
  return {
    slipMs: 0,
    landmark: null,
    mode: 'none',
    updatedAtIso: new Date(0).toISOString(),
  }
}

/** Stable localStorage key for the active game. */
export function slipGameKey(game: ActiveGame): string {
  if (game.gameId != null) return `caha:${game.gameId}`
  if (game.source === 'manual') {
    return `manual:${game.opponentShort}:${game.date ?? 'undated'}`
  }
  return `opp:${game.opponentShort}:${game.date ?? 'undated'}`
}

function isLandmark(raw: unknown): raw is LiveBarnLandmark {
  if (!raw || typeof raw !== 'object') return false
  const l = raw as Record<string, unknown>
  return (
    (l.kind === 'sync' || l.kind === 'shiftOn') &&
    typeof l.wallMs === 'number' &&
    typeof l.mediaMs === 'number'
  )
}

export function parseSlipState(raw: unknown): LiveBarnSlipState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.slipMs !== 'number' || !Number.isFinite(s.slipMs)) return null
  const mode =
    s.mode === 'landmark' || s.mode === 'manual' || s.mode === 'none'
      ? s.mode
      : s.slipMs === 0
        ? 'none'
        : 'manual'
  return {
    slipMs: s.slipMs,
    landmark: isLandmark(s.landmark) ? {
      kind: s.landmark.kind,
      shiftIndex:
        typeof s.landmark.shiftIndex === 'number' ? s.landmark.shiftIndex : null,
      sourceId:
        typeof s.landmark.sourceId === 'string' ? s.landmark.sourceId : null,
      wallMs: s.landmark.wallMs,
      mediaMs: s.landmark.mediaMs,
    } : null,
    mode,
    updatedAtIso:
      typeof s.updatedAtIso === 'string'
        ? s.updatedAtIso
        : new Date().toISOString(),
  }
}

export function loadAllSlips(): SlipByGame {
  try {
    const raw = localStorage.getItem(SLIP_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: SlipByGame = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const s = parseSlipState(v)
      if (s) out[k] = s
    }
    return out
  } catch {
    return {}
  }
}

export function loadSlipForGame(game: ActiveGame): LiveBarnSlipState {
  return loadAllSlips()[slipGameKey(game)] ?? emptySlip()
}

export function saveSlipForGame(
  game: ActiveGame,
  state: LiveBarnSlipState,
): void {
  const all = loadAllSlips()
  const key = slipGameKey(game)
  if (state.mode === 'none' && state.slipMs === 0 && !state.landmark) {
    delete all[key]
  } else {
    all[key] = state
  }
  localStorage.setItem(SLIP_KEY, JSON.stringify(all))
}

export function clearSlipForGame(game: ActiveGame): LiveBarnSlipState {
  const next = emptySlip()
  next.updatedAtIso = new Date().toISOString()
  saveSlipForGame(game, next)
  return next
}

/**
 * Parse a media time as MM:SS, H:MM:SS, or plain seconds (int/float).
 * Returns milliseconds, or null if invalid.
 */
export function parseMediaTimeInput(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const sec = Number(t)
    if (!Number.isFinite(sec)) return null
    return Math.round(sec * 1000)
  }
  const parts = t.split(':')
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p))
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
    let sec = 0
    if (parts.length === 3) {
      sec = nums[0] * 3600 + nums[1] * 60 + nums[2]
    } else {
      sec = nums[0] * 60 + nums[1]
    }
    return Math.round(sec * 1000)
  }
  return null
}

/** Format slip for UI: +0.171s / −3s / 0s */
export function formatSlipSeconds(slipMs: number): string {
  const sec = slipMs / 1000
  const rounded =
    Math.abs(sec) >= 10
      ? sec.toFixed(1).replace(/\.0$/, '')
      : Math.abs(sec) >= 1
        ? sec.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
        : sec.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  if (slipMs === 0) return '0s'
  const sign = slipMs > 0 ? '+' : ''
  return `${sign}${rounded}s`
}

export function formatMediaClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

export function chronoShifts(taps: TapEvent[]): ShiftEvent[] {
  return taps
    .filter((t): t is ShiftEvent => t.type === 'shift')
    .sort((a, b) => a.startWallMs - b.startWallMs)
}

/**
 * Sync-relative media ms for a wall stamp (before LiveBarn slip).
 * Prefer this over raw (wall − sync) so pre-Sync re-anchor stays correct.
 */
export function relativeMediaMs(wallMs: number, taps: TapEvent[]): number {
  const anchor = buildMediaAnchor(taps)
  return wallToMediaMs(wallMs, anchor)
}

/**
 * Landmark → slip.
 * slipMs = landmarkMediaMs − relativeMedia(wallMs)
 * (= landmarkMediaMs − (wallMs − syncWallMs) when Sync is still media 0)
 */
export function slipFromLandmark(opts: {
  taps: TapEvent[]
  wallMs: number
  landmarkMediaMs: number
}): number {
  return opts.landmarkMediaMs - relativeMediaMs(opts.wallMs, opts.taps)
}

export function resolveLandmarkWall(
  taps: TapEvent[],
  kind: LandmarkKind,
  shiftIndex1Based: number | null,
): { wallMs: number; sourceId: string | null; sync: SyncEvent | null } | null {
  if (kind === 'sync') {
    const sync = pickSyncAnchor(taps)
    if (!sync) return null
    return { wallMs: sync.wallTimeMs, sourceId: sync.id, sync }
  }
  const shifts = chronoShifts(taps)
  if (!shiftIndex1Based || shiftIndex1Based < 1 || shiftIndex1Based > shifts.length) {
    return null
  }
  const s = shifts[shiftIndex1Based - 1]
  return { wallMs: s.startWallMs, sourceId: s.id, sync: pickSyncAnchor(taps) }
}

export function makeLandmarkSlip(opts: {
  taps: TapEvent[]
  kind: LandmarkKind
  shiftIndex1Based: number | null
  landmarkMediaMs: number
}): LiveBarnSlipState | null {
  const resolved = resolveLandmarkWall(
    opts.taps,
    opts.kind,
    opts.shiftIndex1Based,
  )
  if (!resolved) return null
  const slipMs = slipFromLandmark({
    taps: opts.taps,
    wallMs: resolved.wallMs,
    landmarkMediaMs: opts.landmarkMediaMs,
  })
  return {
    slipMs,
    landmark: {
      kind: opts.kind,
      shiftIndex: opts.kind === 'shiftOn' ? opts.shiftIndex1Based : null,
      sourceId: resolved.sourceId,
      wallMs: resolved.wallMs,
      mediaMs: opts.landmarkMediaMs,
    },
    mode: 'landmark',
    updatedAtIso: new Date().toISOString(),
  }
}

export function makeManualSlip(slipMs: number): LiveBarnSlipState {
  return {
    slipMs: Math.round(slipMs),
    landmark: null,
    mode: slipMs === 0 ? 'none' : 'manual',
    updatedAtIso: new Date().toISOString(),
  }
}
