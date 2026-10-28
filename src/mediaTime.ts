import type { GoalEvent, ShiftEvent, SyncEvent, TapEvent } from './types'

/** Default NTSC broadcast rate for LiveBarn / rink film. */
export const FRAME_RATE = 29.97

/** Goal pads from tap instant (celebration ≈ tap): −15s … +5s. */
export const GOAL_PAD_BEFORE_MS = 15_000
export const GOAL_PAD_AFTER_MS = 5_000

/**
 * Shift pads for On/Off tap lag (exact ice window ± edge).
 * Smaller than goal pads so adjacent shifts do not overlap heavily.
 */
export const SHIFT_PAD_BEFORE_MS = 3_000
export const SHIFT_PAD_AFTER_MS = 3_000

export type MediaAnchor = {
  /** Wall clock that maps to {@link mediaMs}. */
  wallMs: number
  /** Media ms at {@link wallMs} (normally 0 = media origin). */
  mediaMs: number
  sync: SyncEvent | null
  warnedNoSync: boolean
  /**
   * True when content starts before Sync and media origin was moved earlier
   * so full ice time is preserved (Sync is then at {@link syncMediaMs} > 0).
   */
  reanchoredForPreSync: boolean
  /** Media ms of the Sync moment (0 when Sync is still the media origin). */
  syncMediaMs: number
}

export type MediaWindow = {
  inMs: number
  outMs: number
  name: string
  kind: 'shift' | 'goal'
  sourceId: string
  /** Wall On→Off (shifts) or 0 for goals. */
  wallDurationMs: number
  /** outMs − inMs after pads / re-anchor. */
  mediaDurationMs: number
}

export type MediaPlan = {
  frameRate: number
  anchor: MediaAnchor
  shifts: MediaWindow[]
  goals: MediaWindow[]
  warnings: string[]
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
 * Earliest wall time that must appear in a cut (shift On − pad, goal − pad).
 * Used to re-anchor when Sync is after opening ice.
 */
export function earliestContentWallMs(taps: TapEvent[]): number | null {
  const walls: number[] = []
  for (const t of taps) {
    if (isShift(t)) walls.push(t.startWallMs - SHIFT_PAD_BEFORE_MS)
    else if (isGoal(t)) walls.push(t.wallTimeMs - GOAL_PAD_BEFORE_MS)
  }
  if (!walls.length) return null
  return Math.min(...walls)
}

/**
 * Map wall clock → media time.
 *
 * Default: chosen Sync wall stamp = media 00:00.
 * When any shift/goal (with pads) starts before Sync, media origin is
 * re-anchored to that earliest content so duration is preserved; Sync then
 * sits at a positive media offset ({@link MediaAnchor.syncMediaMs}).
 * Place / slip the master so media 00:00 is that origin (include pre-Sync
 * ice in the file). Without Sync, origin = earliest content wall time.
 */
export function buildMediaAnchor(taps: TapEvent[]): MediaAnchor {
  const sync = pickSyncAnchor(taps)
  const earliest = earliestContentWallMs(taps)

  if (!sync) {
    const walls = taps.flatMap((t) => {
      if (isShift(t)) return [t.startWallMs, t.endWallMs]
      return [t.wallTimeMs]
    })
    const wallMs =
      earliest ?? (walls.length ? Math.min(...walls) : Date.now())
    return {
      wallMs,
      mediaMs: 0,
      sync: null,
      warnedNoSync: true,
      reanchoredForPreSync: false,
      syncMediaMs: 0,
    }
  }

  if (earliest != null && earliest < sync.wallTimeMs) {
    return {
      wallMs: earliest,
      mediaMs: 0,
      sync,
      warnedNoSync: false,
      reanchoredForPreSync: true,
      syncMediaMs: sync.wallTimeMs - earliest,
    }
  }

  return {
    wallMs: sync.wallTimeMs,
    mediaMs: 0,
    sync,
    warnedNoSync: false,
    reanchoredForPreSync: false,
    syncMediaMs: 0,
  }
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

export function formatMediaTimecode(ms: number, fps = FRAME_RATE): string {
  const totalFrames = msToFrames(Math.max(0, ms), fps)
  const { timebase } = framesToNtscTimebase()
  const f = totalFrames % timebase
  const totalSec = Math.floor(totalFrames / timebase)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}

/**
 * Build In/Out media windows for shifts (On/Off ± shift pads) and goals (−15 / +5).
 * Pre-Sync ice is preserved via re-anchor in {@link buildMediaAnchor} — not by
 * silently clamping In to 0 and shortening the clip.
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
    const inRaw = wallToMediaMs(s.startWallMs, anchor) - SHIFT_PAD_BEFORE_MS
    const outRaw = wallToMediaMs(s.endWallMs, anchor) + SHIFT_PAD_AFTER_MS
    // Safety floor only — after re-anchor, inRaw should already be ≥ 0.
    // Preserve padded duration if a window still undershoots origin.
    const paddedDur = Math.max(1, outRaw - inRaw)
    const inMs = Math.max(0, inRaw)
    const outMs =
      inRaw < 0 ? inMs + paddedDur : Math.max(inMs + 1, outRaw)
    return {
      inMs,
      outMs,
      name: `Shift ${String(i + 1).padStart(2, '0')} · ${s.player} · ${formatDurationLabel(s.durationMs)}`,
      kind: 'shift' as const,
      sourceId: s.id,
      wallDurationMs: s.durationMs,
      mediaDurationMs: outMs - inMs,
    }
  })

  const goals: MediaWindow[] = goalsChrono.map((g, i) => {
    const tap = wallToMediaMs(g.wallTimeMs, anchor)
    const inRaw = tap - GOAL_PAD_BEFORE_MS
    const outRaw = tap + GOAL_PAD_AFTER_MS
    const paddedDur = Math.max(1, outRaw - inRaw)
    const inMs = Math.max(0, inRaw)
    const outMs =
      inRaw < 0 ? inMs + paddedDur : Math.max(inMs + 1, outRaw)
    return {
      inMs,
      outMs,
      name: `Goal ${String(i + 1).padStart(2, '0')} · ${g.scorer}`,
      kind: 'goal' as const,
      sourceId: g.id,
      wallDurationMs: 0,
      mediaDurationMs: outMs - inMs,
    }
  })

  return { shifts, goals }
}

export function anchorLabel(plan: MediaPlan): string {
  const { anchor } = plan
  if (!anchor.sync) return 'no Sync (earliest content = 0)'
  const base = `${anchor.sync.syncType} · ${anchor.sync.period} ${anchor.sync.gameClock}`
  if (anchor.reanchoredForPreSync) {
    return `${base} @ media ${formatMediaTimecode(anchor.syncMediaMs)}`
  }
  return `${base} = media 00:00:00:00`
}

export function buildMediaPlan(taps: TapEvent[]): MediaPlan {
  const anchor = buildMediaAnchor(taps)
  const { shifts, goals } = buildMediaWindows(taps, anchor)
  const warnings: string[] = []

  if (anchor.warnedNoSync) {
    warnings.push(
      'No Sync taps — media times are relative to the earliest content wall and may be wrong. Add a Sync (Puck drop preferred) and re-export.',
    )
  }
  if (anchor.reanchoredForPreSync && anchor.sync) {
    warnings.push(
      `Re-anchored for pre-Sync ice: Sync (${anchor.sync.syncType}) is at media ${formatMediaTimecode(anchor.syncMediaMs)}, not 00:00:00:00. Master file must include film before Sync; slip so media 00:00 is the earliest cut In.`,
    )
  }

  for (const w of shifts) {
    const expected = w.wallDurationMs + SHIFT_PAD_BEFORE_MS + SHIFT_PAD_AFTER_MS
    if (w.mediaDurationMs + 1 < expected) {
      warnings.push(
        `Shift "${w.name}" media duration ${w.mediaDurationMs}ms is shorter than padded wall ${expected}ms — check Sync / master coverage.`,
      )
    }
  }

  return {
    frameRate: FRAME_RATE,
    anchor,
    shifts,
    goals,
    warnings,
  }
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
