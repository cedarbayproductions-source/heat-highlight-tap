/**
 * Build corrected media windows from a Highlight Tap export.
 *
 * Usage:
 *   npx tsx scripts/media-plan-from-json.ts path/to/export.json [out.json]
 *
 * Accepts legacy taps arrays or v2 envelopes. Writes a mediaPlan JSON
 * suitable for agent cutting / stitching when the master film is available.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildExportPayload,
  parseExportSlip,
  parseExportTaps,
} from '../src/exportJson'
import {
  SHIFT_PAD_AFTER_MS,
  SHIFT_PAD_BEFORE_MS,
  formatMediaTimecode,
} from '../src/mediaTime'

function main() {
  const inPath = process.argv[2]
  if (!inPath) {
    console.error(
      'Usage: npx tsx scripts/media-plan-from-json.ts <export.json> [out.json]',
    )
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(resolve(inPath), 'utf8')) as unknown
  const taps = parseExportTaps(raw)
  const slipOpts = parseExportSlip(raw)
  const payload = buildExportPayload(taps, slipOpts)
  const outPath = resolve(
    process.argv[3] ??
      inPath.replace(/\.json$/i, '') + '.media-plan.json',
  )
  writeFileSync(outPath, JSON.stringify(payload, null, 2))

  const { mediaPlan } = payload
  console.log(`Wrote ${outPath}`)
  console.log(`  taps: ${taps.length}`)
  console.log(`  shifts: ${mediaPlan.shifts.length}`)
  console.log(`  goals: ${mediaPlan.goals.length}`)
  console.log(`  anchor: ${mediaPlan.anchor.label}`)
  console.log(
    `  slipMs: ${mediaPlan.slipMs}${mediaPlan.landmark ? ` · landmark ${mediaPlan.landmark.kind}` : ''}`,
  )
  console.log(
    `  shift pads: −${SHIFT_PAD_BEFORE_MS}ms / +${SHIFT_PAD_AFTER_MS}ms (before slip)`,
  )
  for (const w of mediaPlan.shifts) {
    console.log(
      `  · ${w.name}: in ${formatMediaTimecode(w.inMs)} → out ${formatMediaTimecode(w.outMs)} (${w.mediaDurationMs}ms media / ${w.wallDurationMs}ms wall)`,
    )
  }
  for (const w of mediaPlan.warnings) console.log(`  ! ${w}`)
}

main()
