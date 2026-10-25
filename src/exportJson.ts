import { downloadFile, exportBaseName } from './downloadFile'
import type { ActiveGame, TapEvent } from './types'

export type ExportJsonResult = {
  filename: string
  method: 'share' | 'savePicker' | 'anchor'
}

export function tapsJsonText(taps: TapEvent[]): string {
  return JSON.stringify(taps, null, 2)
}

export function jsonExportFilename(game: ActiveGame): string {
  return `${exportBaseName(game.opponentShort, game.date)}.json`
}

/** Clipboard for paste into Cursor chat — no Downloads / blob: URL. */
export async function copyJson(
  taps: TapEvent[],
  game: ActiveGame,
): Promise<{ filename: string; ok: boolean }> {
  const filename = jsonExportFilename(game)
  const text = tapsJsonText(taps)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return { filename, ok: true }
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return { filename, ok }
  } catch {
    return { filename, ok: false }
  }
}

export async function exportJson(
  taps: TapEvent[],
  game: ActiveGame,
): Promise<ExportJsonResult> {
  const filename = jsonExportFilename(game)
  const result = await downloadFile({
    contents: tapsJsonText(taps),
    filename,
    mime: 'application/json',
  })
  return { filename, method: result.method }
}
