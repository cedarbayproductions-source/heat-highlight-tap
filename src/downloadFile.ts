/**
 * Save a typed file without navigating Safari to a blank blob: URL.
 * Prefer Web Share (iOS Share → Save to Files), then showSaveFilePicker, then <a download>.
 */

export type DownloadFileResult =
  | { method: 'share' }
  | { method: 'savePicker' }
  | { method: 'anchor' }

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i) : ''
}

function canShareFile(file: File): boolean {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
  }
  if (typeof nav.share !== 'function') return false
  if (typeof nav.canShare !== 'function') {
    // Older iOS: try share and catch; treat as available when share exists.
    return true
  }
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

async function tryShareFile(file: File): Promise<boolean> {
  if (!canShareFile(file)) return false
  try {
    // Prefer files so iOS Share → Save to Files / AirDrop keeps heat-taps-….json.
    // text is a short label only (not the full JSON — use Copy JSON for chat paste).
    await navigator.share({
      files: [file],
      title: file.name,
      text: file.name,
    })
    return true
  } catch (err) {
    // User cancel is fine; fall through to other methods only on AbortError? Prefer
    // not re-prompting after an intentional cancel.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return true
    }
    // Retry files-only if title/text caused a reject on some WebViews.
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (err2) {
      if (err2 instanceof DOMException && err2.name === 'AbortError') {
        return true
      }
      return false
    }
  }
}

async function trySaveFilePicker(
  blob: Blob,
  filename: string,
  mime: string,
): Promise<boolean> {
  const w = window as SaveFilePickerWindow
  if (typeof w.showSaveFilePicker !== 'function') return false
  const ext = extensionOf(filename) || ''
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: filename,
          accept: { [mime]: ext ? [ext] : [] },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return true
    }
    return false
  }
}

/** <a download> without assigning location / opening the blob URL in-tab. */
function downloadViaAnchor(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Keep the blob alive briefly so Safari can finish the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadFile(opts: {
  contents: string | Blob
  filename: string
  mime: string
}): Promise<DownloadFileResult> {
  const blob =
    opts.contents instanceof Blob
      ? opts.contents.type
        ? opts.contents
        : new Blob([opts.contents], { type: opts.mime })
      : new Blob([opts.contents], { type: opts.mime })
  const file = new File([blob], opts.filename, {
    type: opts.mime,
    lastModified: Date.now(),
  })

  if (await tryShareFile(file)) {
    return { method: 'share' }
  }
  if (await trySaveFilePicker(blob, opts.filename, opts.mime)) {
    return { method: 'savePicker' }
  }
  downloadViaAnchor(blob, opts.filename)
  return { method: 'anchor' }
}

/** Safe slug for filenames: letters, numbers, hyphen. */
export function fileSlug(raw: string | null | undefined, fallback = 'game'): string {
  const s = (raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || fallback
}

export function exportBaseName(opponentShort: string, date: string | null): string {
  const opp = fileSlug(opponentShort, 'opponent')
  const day = fileSlug(date, new Date().toISOString().slice(0, 10))
  return `heat-taps-${opp}-${day}`
}
