import { downloadFile, exportBaseName } from './downloadFile'
import type { ActiveGame, TapEvent } from './types'

export type ExportJsonResult = {
  filename: string
  method: 'share' | 'savePicker' | 'anchor'
}

export async function exportJson(
  taps: TapEvent[],
  game: ActiveGame,
): Promise<ExportJsonResult> {
  const filename = `${exportBaseName(game.opponentShort, game.date)}.json`
  const result = await downloadFile({
    contents: JSON.stringify(taps, null, 2),
    filename,
    mime: 'application/json',
  })
  return { filename, method: result.method }
}
