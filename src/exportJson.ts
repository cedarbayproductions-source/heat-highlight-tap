import type { TapEvent } from './types'

export function exportJson(taps: TapEvent[]): void {
  const blob = new Blob([JSON.stringify(taps, null, 2)], {
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
