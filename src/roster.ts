import type { RosterPlayer } from './types'

export const HEAT_LABEL = 'California Heat 16AA-1'

export const ROSTER: RosterPlayer[] = [
  { number: 19, name: 'Pedram Abdollahi Foumani' },
  { number: 10, name: 'Liam L Liska' },
  { number: 77, name: 'Oliver P Artigas' },
  { number: 12, name: 'Jacob T Moore' },
  { number: 92, name: 'Lukas J Cheng' },
  { number: 14, name: 'Hagan Z Ordaz-Ocampo' },
  { number: 20, name: 'Hrach Chtrkyan', pinRank: 3 },
  { number: 23, name: 'Sebastian L Ortiz' },
  { number: 80, name: 'Troy B Danyluk' },
  { number: 17, name: 'Christian A Pascua' },
  { number: 7, name: 'Connor G Emerson' },
  { number: 93, name: 'Oliver Perry', pinRank: 1 },
  { number: 88, name: 'Jacob P Feder' },
  { number: 31, name: 'Parker G Slaten', position: 'G' },
  { number: 32, name: 'Andre M La Barge', position: 'G' },
  { number: 34, name: 'Giacomo L Trapasso', pinRank: 2 },
  { number: 21, name: 'Junu J Lee' },
]

export function playerLabel(p: RosterPlayer): string {
  const g = p.position === 'G' ? ' (G)' : ''
  return `#${p.number} ${p.name}${g}`
}

export function orderedRoster(): RosterPlayer[] {
  const pinned = ROSTER.filter((p) => p.pinRank != null).sort(
    (a, b) => (a.pinRank ?? 99) - (b.pinRank ?? 99),
  )
  const rest = ROSTER.filter((p) => p.pinRank == null).sort(
    (a, b) => a.number - b.number,
  )
  return [...pinned, ...rest]
}

export const ORDERED_ROSTER = orderedRoster()
export const DEFAULT_SHIFT_PLAYER = playerLabel(
  ROSTER.find((p) => p.number === 93)!,
)
