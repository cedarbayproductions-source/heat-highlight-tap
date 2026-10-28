import {
  anchorLabel,
  buildMediaPlan,
  formatMediaTimecode,
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
   */
  mediaPlan: {
    frameRate: number
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

export function buildExportPayload(taps: TapEvent[]): HeatHighlightExportV2 {
  const plan = buildMediaPlan(taps)
  return {
    format: EXPORT_JSON_FORMAT,
    version: EXPORT_JSON_VERSION,
    exportedAtIso: new Date().toISOString(),
    taps,
    mediaPlan: {
      frameRate: plan.frameRate,
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

export function tapsJsonText(taps: TapEvent[]): string {
  return JSON.stringify(buildExportPayload(taps), null, 2)
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

export function exportJson(taps: TapEvent[]): void {
  const blob = new Blob([tapsJsonText(taps)], {
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
