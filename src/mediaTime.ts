import type { GoalEvent, ShiftEvent, SyncEvent, TapEvent } from './types'

/** Default NTSC broadcast rate for LiveBarn / rink film. */
export const FRAME_RATE = 29.97

/** Goal pads from tap instant (celebration ≈ tap): −15s … +5s. */
export const GOAL_PAD_BEFORE_MS = 15_000
export const GOAL_PAD_AFTER_MS = 5_000

export type MediaAnchor = {
  wallMs: number
  /** Media ms at the Sync wall stamp (0 = Sync moment is media origin). */
  mediaMs: number
  sync: SyncEvent | null
  warnedNoSync: boolean
}

export type MediaWindow = {
  inMs: number
  outMs: number
  name: string
  kind: 'shift' | 'goal'
  sourceId: string
}

function isSync(e: TapEvent): e is SyncEvent {
  return e.type === 'sync'
}

function isShift(e: TapEvent): e is ShiftEvent {
  return e.type === 'shift'
}

function isGoal(e: TapEvent): e is GoalEvent {
  return e.type === 'goal'
}

/** Prefer earliest Puck drop; else earliest Sync; else null. */
export function pickSyncAnchor(taps: TapEvent[]): SyncEvent | null {
  const syncs = taps.filter(isSync).sort((a, b) => a.wallTimeMs - b.wallTimeMs)
  if (!syncs.length) return null
  const puck = syncs.find((s) => s.syncType === 'Puck drop')
  return puck ?? syncs[0]
}

/**
 * Map wall clock → media time.
 * Convention: at the chosen Sync wall stamp, media time = 0.
 * Slip / place the master clip in Premiere so that Sync moment sits at 00:00
 * on the film (or relink and nudge). Without Sync, origin = earliest event wall time.
 */
export function buildMediaAnchor(taps: TapEvent[]): MediaAnchor {
  const sync = pickSyncAnchor(taps)
  if (sync) {
    return {
      wallMs: sync.wallTimeMs,
      mediaMs: 0,
      sync,
      warnedNoSync: false,
    }
  }
  const walls = taps.flatMap((t) => {
    if (isShift(t)) return [t.startWallMs, t.endWallMs]
    return [t.wallTimeMs]
  })
  const wallMs = walls.length ? Math.min(...walls) : Date.now()
  return { wallMs, mediaMs: 0, sync: null, warnedNoSync: true }
}

export function wallToMediaMs(wallMs: number, anchor: MediaAnchor): number {
  return anchor.mediaMs + (wallMs - anchor.wallMs)
}

export function msToFrames(ms: number, fps = FRAME_RATE): number {
  return Math.max(0, Math.round((ms / 1000) * fps))
}

export function framesToNtscTimebase(_frames?: number): {
  timebase: number
  ntsc: boolean
} {
  // 29.97 → timebase 30 + ntsc TRUE (FCP / Premiere convention)
  void _frames
  return { timebase: 30, ntsc: true }
}

function formatDurationLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

/**
 * Build In/Out media windows for shifts (exact start/end) and goals (−15 / +5).
 * Negative media times are clamped to 0 (pre-Sync taps).
 */
export function buildMediaWindows(
  taps: TapEvent[],
  anchor: MediaAnchor,
): { shifts: MediaWindow[]; goals: MediaWindow[] } {
  const shiftsChrono = taps
    .filter(isShift)
    .sort((a, b) => a.startWallMs - b.startWallMs)
  const goalsChrono = taps
    .filter(isGoal)
    .sort((a, b) => a.wallTimeMs - b.wallTimeMs)

  const shifts: MediaWindow[] = shiftsChrono.map((s, i) => {
    const inRaw = wallToMediaMs(s.startWallMs, anchor)
    const outRaw = wallToMediaMs(s.endWallMs, anchor)
    const inMs = Math.max(0, inRaw)
    const outMs = Math.max(inMs + 1, outRaw)
    return {
      inMs,
      outMs,
      name: `Shift ${String(i + 1).padStart(2, '0')} · ${s.player} · ${formatDurationLabel(s.durationMs)}`,
      kind: 'shift',
      sourceId: s.id,
    }
  })

  const goals: MediaWindow[] = goalsChrono.map((g, i) => {
    const tap = wallToMediaMs(g.wallTimeMs, anchor)
    const inMs = Math.max(0, tap - GOAL_PAD_BEFORE_MS)
    const outMs = Math.max(inMs + 1, tap + GOAL_PAD_AFTER_MS)
    return {
      inMs,
      outMs,
      name: `Goal ${String(i + 1).padStart(2, '0')} · ${g.scorer}`,
      kind: 'goal',
      sourceId: g.id,
    }
  })

  return { shifts, goals }
}

/** Relative master-clip filename placeholder for the game dump. */
export function masterClipFileName(opts: {
  opponentShort: string
  date: string | null
  gameId: number | null
}): string {
  const opp = opts.opponentShort
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  const date = opts.date ?? 'undated'
  const tts = opts.gameId != null ? `_TTS${opts.gameId}` : ''
  return `Heat_vs_${opp}_${date}${tts}.mp4`
}

/**
 * Premiere/FCP pathurl convention (document in highlight-tap.md):
 * Put the LiveBarn/GoPro dump next to a `MEDIA/` folder (or rename to match),
 * then File → Import the XML. Relink if needed.
 * Example: `file://localhost/MEDIA/Heat_vs_Jr_Reign_2026-10-25_TTS58010.mp4`
 */
export function masterClipPathUrl(fileName: string): string {
  const encoded = fileName
    .split('/')
    .map((p) => encodeURIComponent(p).replace(/%2E/g, '.'))
    .join('/')
  return `file://localhost/MEDIA/${encoded}`
}
