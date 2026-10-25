/**
 * Smoke test: FCP XML from Sync + Shift + Goal taps.
 * Run: npm run test:xml
 */
import { buildFcpXml } from '../src/exportXml'
import type { ActiveGame, TapEvent } from '../src/types'

const game: ActiveGame = {
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
  heatLabel: 'California Heat 16AA-1',
  fetchedAtIso: '2026-10-20T12:00:00.000Z',
}

const syncWall = Date.parse('2026-10-25T16:45:00.000Z')
const shiftStart = syncWall + 90_000
const shiftEnd = shiftStart + 42_000
const goalWall = shiftStart + 20_000

const taps: TapEvent[] = [
  {
    id: 'sync-1',
    type: 'sync',
    wallTimeMs: syncWall,
    wallTimeIso: new Date(syncWall).toISOString(),
    syncType: 'Puck drop',
    period: 'P1',
    gameClock: '16:00',
    note: null,
    createdAtIso: new Date(syncWall).toISOString(),
    gameId: 58010,
    gameSource: 'caha',
    opponent: game.opponent,
    opponentShort: game.opponentShort,
    tournamentUrl: null,
  },
  {
    id: 'shift-1',
    type: 'shift',
    player: '#93 Oliver Perry',
    wallTimeMs: shiftStart,
    wallTimeIso: new Date(shiftStart).toISOString(),
    startWallMs: shiftStart,
    startWallIso: new Date(shiftStart).toISOString(),
    endWallMs: shiftEnd,
    endWallIso: new Date(shiftEnd).toISOString(),
    durationMs: 42_000,
    createdAtIso: new Date(shiftEnd).toISOString(),
    gameId: 58010,
    gameSource: 'caha',
    opponent: game.opponent,
    opponentShort: game.opponentShort,
    tournamentUrl: null,
  },
  {
    id: 'goal-1',
    type: 'goal',
    wallTimeMs: goalWall,
    wallTimeIso: new Date(goalWall).toISOString(),
    scorer: '#93 Oliver Perry',
    assist1: null,
    assist2: null,
    duringShift: true,
    createdAtIso: new Date(goalWall).toISOString(),
    gameId: 58010,
    gameSource: 'caha',
    opponent: game.opponent,
    opponentShort: game.opponentShort,
    tournamentUrl: null,
  },
]

const withSync = buildFcpXml(taps, game)
const noSync = buildFcpXml(
  taps.filter((t) => t.type !== 'sync'),
  game,
)

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(withSync.xml.includes('<xmeml version="4">'), 'xmeml v4')
assert(withSync.xml.includes('seq-shifts'), 'shifts sequence')
assert(withSync.xml.includes('seq-goals'), 'goals sequence')
assert(withSync.xml.includes('Shift 01 · #93 Oliver Perry'), 'shift name')
assert(withSync.xml.includes('Goal 01 · #93 Oliver Perry'), 'goal name')
assert(
  withSync.xml.includes('Heat_vs_Jr_Reign_2026-10-25_TTS58010.mp4'),
  'master path',
)
assert(withSync.xml.includes('<timebase>30</timebase>'), '29.97 ntsc timebase')
assert(withSync.xml.includes('<ntsc>TRUE</ntsc>'), 'ntsc true')
assert(!withSync.warnedNoSync, 'sync present → no warn')
assert(withSync.shiftCount === 1 && withSync.goalCount === 1, 'counts')
assert(
  withSync.filename === 'heat-taps-Jr-Reign-2026-10-25.xml',
  `filename ${withSync.filename}`,
)
assert(noSync.warnedNoSync, 'no sync → warn')

// Shift in = 90s from sync = 90 * 29.97 ≈ 2697 frames
assert(withSync.xml.includes('<in>2697</in>') || withSync.xml.includes('<in>2698</in>'), 'shift in ~90s')

console.log('smoke-export-xml OK')
console.log('  master:', withSync.masterFileName)
console.log('  pathurl:', withSync.pathurl)
console.log('  anchor:', withSync.anchorLabel)
console.log('  noSync warn:', noSync.warnedNoSync)
