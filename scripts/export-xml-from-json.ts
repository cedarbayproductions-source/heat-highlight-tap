/**
 * Build Premiere FCP XML from a Highlight Tap export (same math as Export XML).
 *
 * Usage:
 *   npx tsx scripts/export-xml-from-json.ts path/to/export.json [out.xml] [--master /abs/path.mp4]
 *
 * Accepts legacy taps arrays or v2 envelopes.
 * `--master` sets pathurl to that absolute file (file://localhost/...) instead
 * of the /MEDIA/ placeholder.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExportTaps } from '../src/exportJson'
import { buildFcpXml } from '../src/exportXml'
import type { ActiveGame, TapEvent } from '../src/types'

function inferGame(taps: TapEvent[]): ActiveGame {
  const labeled = taps.find((t) => t.opponentShort || t.opponent)
  const gameId = labeled?.gameId ?? null
  const opponent = labeled?.opponent ?? 'Opponent'
  const opponentShort = labeled?.opponentShort ?? opponent
  const dateIso =
    taps.find((t) => t.type === 'sync')?.wallTimeIso ??
    taps[0]?.wallTimeIso ??
    null
  const date = dateIso ? dateIso.slice(0, 10) : null
  return {
    source: labeled?.gameSource ?? 'caha',
    gameId,
    scheduleId: null,
    opponent,
    opponentShort,
    date,
    start: null,
    venue: null,
    side: null,
    note: null,
    tournamentUrl: labeled?.tournamentUrl ?? null,
    heatLabel: 'California Heat 16AA-1',
    fetchedAtIso: null,
  }
}

function parseArgs(argv: string[]): {
  inPath: string | undefined
  outPath: string | undefined
  masterPath: string | undefined
} {
  let masterPath: string | undefined
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--master') {
      masterPath = argv[++i]
      continue
    }
    if (a.startsWith('--master=')) {
      masterPath = a.slice('--master='.length)
      continue
    }
    positional.push(a)
  }
  return {
    inPath: positional[0],
    outPath: positional[1],
    masterPath,
  }
}

function main() {
  const { inPath, outPath: outArg, masterPath } = parseArgs(process.argv.slice(2))
  if (!inPath) {
    console.error(
      'Usage: npx tsx scripts/export-xml-from-json.ts <export.json> [out.xml] [--master /abs/path.mp4]',
    )
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(resolve(inPath), 'utf8')) as unknown
  const taps = parseExportTaps(raw)
  const game = inferGame(taps)
  const result = buildFcpXml(taps, game, { masterPath })
  const outPath = resolve(
    outArg ?? inPath.replace(/\.json$/i, '') + '.premiere.xml',
  )
  writeFileSync(outPath, result.xml)
  console.log(`Wrote ${outPath}`)
  console.log(`  master: ${result.masterFileName}`)
  console.log(`  pathurl: ${result.pathurl}`)
  console.log(`  shifts: ${result.shiftCount} · goals: ${result.goalCount}`)
  console.log(`  anchor: ${result.anchorLabel}`)
  if (result.warnedNoSync) console.log('  ! no Sync — times may be wrong')
  if (result.reanchoredForPreSync) console.log('  · re-anchored for pre-Sync')
  for (const w of result.warnings) console.log(`  ! ${w}`)
}

main()
