import {
  anchorLabel,
  buildMediaPlan,
  formatMediaTimecode,
  type BuildMediaPlanOpts,
  type MediaPlan,
} from './mediaTime'
import type { TapEvent } from './types'

export const EXPORT_JSON_FORMAT = 'heat-highlight-export'
export const EXPORT_JSON_VERSION = 2 as const

export type HeatHighlightExportV2 = {
  format: typeof EXPORT_JSON_FORMAT
  version: typeof EXPORT_JSON_VERSION
  exportedAtIso: string
  /** Raw taps — same shape as legacy array export. */
  taps: TapEvent[]
  /**
   * Corrected media In/Out for agent cuts + Premiere (shared math with XML).
   * Prefer these windows over re-deriving Sync=0 + clamp.
   * In/Out already include LiveBarn slipMs (pads applied before slip).
   */
  mediaPlan: {
    frameRate: number
    /** LiveBarn master slip applied to all shift/goal In/Out (ms). */
    slipMs: number
    landmark: MediaPlan['landmark']
    anchor: {
      wallMs: number
      mediaMs: number
      syncMediaMs: number
      syncMediaTimecode: string
      reanchoredForPreSync: boolean
      warnedNoSync: boolean
      sync: MediaPlan['anchor']['sync']
      label: string
    }
    shifts: MediaPlan['shifts']
    goals: MediaPlan['goals']
    warnings: string[]
  }
}

export function buildExportPayload(
  taps: TapEvent[],
  opts: BuildMediaPlanOpts = {},
): HeatHighlightExportV2 {
  const plan = buildMediaPlan(taps, opts)
  return {
    format: EXPORT_JSON_FORMAT,
    version: EXPORT_JSON_VERSION,
    exportedAtIso: new Date().toISOString(),
    taps,
    mediaPlan: {
      frameRate: plan.frameRate,
      slipMs: plan.slipMs,
      landmark: plan.landmark,
      anchor: {
        wallMs: plan.anchor.wallMs,
        mediaMs: plan.anchor.mediaMs,
        syncMediaMs: plan.anchor.syncMediaMs,
        syncMediaTimecode: formatMediaTimecode(plan.anchor.syncMediaMs),
        reanchoredForPreSync: plan.anchor.reanchoredForPreSync,
        warnedNoSync: plan.anchor.warnedNoSync,
        sync: plan.anchor.sync,
        label: anchorLabel(plan),
      },
      shifts: plan.shifts,
      goals: plan.goals,
      warnings: plan.warnings,
    },
  }
}

export function tapsJsonText(
  taps: TapEvent[],
  opts: BuildMediaPlanOpts = {},
): string {
  return JSON.stringify(buildExportPayload(taps, opts), null, 2)
}

/** Accept legacy tap arrays or v2 export envelopes. */
export function parseExportTaps(raw: unknown): TapEvent[] {
  if (Array.isArray(raw)) return raw as TapEvent[]
  if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as HeatHighlightExportV2).taps)
  ) {
    return (raw as HeatHighlightExportV2).taps
  }
  throw new Error(
    'Expected a heat-highlight taps array or v2 export object with .taps',
  )
}

/** Read slip/landmark from a v2 envelope (0 / null when absent). */
export function parseExportSlip(raw: unknown): BuildMediaPlanOpts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const plan = (raw as HeatHighlightExportV2).mediaPlan
  if (!plan || typeof plan !== 'object') return {}
  const slipMs =
    typeof plan.slipMs === 'number' && Number.isFinite(plan.slipMs)
      ? plan.slipMs
      : 0
  const landmark = plan.landmark ?? null
  return { slipMs, landmark }
}

export function exportJson(
  taps: TapEvent[],
  opts: BuildMediaPlanOpts = {},
): void {
  const blob = new Blob([tapsJsonText(taps, opts)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `heat-highlight-taps-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Copy the same JSON export payload (taps + mediaPlan) to the clipboard.
 * Prefer Clipboard API; fall back to textarea + execCommand for iOS Safari/PWA.
 */
export async function copyJson(
  taps: TapEvent[],
  opts: BuildMediaPlanOpts = {},
): Promise<boolean> {
  const text = tapsJsonText(taps, opts)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // iOS needs the field in-viewport and selectable
    ta.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
