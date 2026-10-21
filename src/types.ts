export type GameSource = 'caha' | 'manual'
export type Side = 'home' | 'visitor'

export type ActiveGame = {
  source: GameSource
  gameId: number | null
  scheduleId: string | null
  opponent: string
  opponentShort: string
  date: string | null
  start: string | null
  venue: string | null
  side: Side | null
  note: string | null
  tournamentUrl: string | null
  heatLabel: string
  fetchedAtIso: string | null
}

export type GameLabelFields = {
  gameId: number | null
  gameSource: GameSource
  opponent: string
  opponentShort: string
  tournamentUrl: string | null
}

export type SyncType = 'Puck drop' | 'Stoppage' | 'Other'
export type Period = 'P1' | 'P2' | 'P3' | 'OT'

export type GoalEvent = GameLabelFields & {
  id: string
  type: 'goal'
  wallTimeMs: number
  wallTimeIso: string
  scorer: string
  assist1: string | null
  assist2: string | null
  duringShift?: boolean
  createdAtIso: string
}

export type SyncEvent = GameLabelFields & {
  id: string
  type: 'sync'
  wallTimeMs: number
  wallTimeIso: string
  syncType: SyncType
  period: Period
  gameClock: string
  note: string | null
  createdAtIso: string
}

export type ShiftEvent = GameLabelFields & {
  id: string
  type: 'shift'
  player: string
  wallTimeMs: number
  wallTimeIso: string
  startWallMs: number
  startWallIso: string
  endWallMs: number
  endWallIso: string
  durationMs: number
  createdAtIso: string
}

export type TapEvent = GoalEvent | SyncEvent | ShiftEvent

export type OpenShift = {
  player: string
  startWallMs: number
  startWallIso: string
}

export type RosterPlayer = {
  number: number
  name: string
  pinRank?: number
  position?: 'G'
}
