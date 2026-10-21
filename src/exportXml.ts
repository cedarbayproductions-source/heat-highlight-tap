import {
  FRAME_RATE,
  buildMediaAnchor,
  buildMediaWindows,
  framesToNtscTimebase,
  masterClipFileName,
  masterClipPathUrl,
  msToFrames,
  type MediaWindow,
} from './mediaTime'
import type { ActiveGame, TapEvent } from './types'

export { FRAME_RATE }

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function rateXml(): string {
  const { timebase, ntsc } = framesToNtscTimebase(0)
  return `<rate>
          <timebase>${timebase}</timebase>
          <ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc>
        </rate>`
}

function clipItemXml(opts: {
  id: string
  name: string
  /** Source in (frames on master) */
  startFrame: number
  endFrame: number
  /** Timeline placement */
  timelineStart: number
  timelineEnd: number
  fileId: string
  masterDurationFrames: number
  pathurl: string
  fileName: string
}): string {
  const duration = Math.max(1, opts.endFrame - opts.startFrame)
  return `<clipitem id="${esc(opts.id)}">
            <name>${esc(opts.name)}</name>
            <duration>${duration}</duration>
            ${rateXml()}
            <start>${opts.timelineStart}</start>
            <end>${opts.timelineEnd}</end>
            <in>${opts.startFrame}</in>
            <out>${opts.endFrame}</out>
            <file id="${esc(opts.fileId)}">
              <name>${esc(opts.fileName)}</name>
              <pathurl>${esc(opts.pathurl)}</pathurl>
              ${rateXml()}
              <duration>${opts.masterDurationFrames}</duration>
              <timecode>
                ${rateXml()}
                <string>00:00:00:00</string>
                <frame>0</frame>
                <displayformat>NDF</displayformat>
              </timecode>
              <media>
                <video>
                  <duration>${opts.masterDurationFrames}</duration>
                  <samplecharacteristics>
                    ${rateXml()}
                    <width>1920</width>
                    <height>1080</height>
                  </samplecharacteristics>
                </video>
                <audio>
                  <samplecharacteristics>
                    <depth>16</depth>
                    <samplerate>48000</samplerate>
                  </samplecharacteristics>
                  <channelcount>2</channelcount>
                </audio>
              </media>
            </file>
          </clipitem>`
}

function sequenceXml(opts: {
  id: string
  name: string
  windows: MediaWindow[]
  fileId: string
  pathurl: string
  fileName: string
  masterDurationFrames: number
}): string {
  let timeline = 0
  const items: string[] = []
  opts.windows.forEach((w, i) => {
    const startFrame = msToFrames(w.inMs)
    const endFrame = Math.max(startFrame + 1, msToFrames(w.outMs))
    const dur = endFrame - startFrame
    const timelineStart = timeline
    const timelineEnd = timeline + dur
    timeline = timelineEnd
    items.push(
      clipItemXml({
        id: `${opts.id}-clip-${i + 1}`,
        name: w.name,
        startFrame,
        endFrame,
        timelineStart,
        timelineEnd,
        fileId: opts.fileId,
        masterDurationFrames: opts.masterDurationFrames,
        pathurl: opts.pathurl,
        fileName: opts.fileName,
      }),
    )
  })

  const seqDuration = Math.max(1, timeline)
  return `<sequence id="${esc(opts.id)}">
        <name>${esc(opts.name)}</name>
        <duration>${seqDuration}</duration>
        ${rateXml()}
        <timecode>
          ${rateXml()}
          <string>00:00:00:00</string>
          <frame>0</frame>
          <displayformat>NDF</displayformat>
        </timecode>
        <media>
          <video>
            <format>
              <samplecharacteristics>
                ${rateXml()}
                <width>1920</width>
                <height>1080</height>
                <anamorphic>FALSE</anamorphic>
                <pixelaspectratio>square</pixelaspectratio>
                <fielddominance>none</fielddominance>
              </samplecharacteristics>
            </format>
            <track>
              ${items.join('\n              ')}
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
          </video>
          <audio>
            <numOutputChannels>2</numOutputChannels>
            <format>
              <samplecharacteristics>
                <depth>16</depth>
                <samplerate>48000</samplerate>
              </samplecharacteristics>
            </format>
            <track>
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
          </audio>
        </media>
      </sequence>`
}

export type ExportXmlResult = {
  xml: string
  filename: string
  warnedNoSync: boolean
  shiftCount: number
  goalCount: number
  masterFileName: string
  pathurl: string
  frameRate: number
  anchorLabel: string
}

export function buildFcpXml(
  taps: TapEvent[],
  game: ActiveGame,
): ExportXmlResult {
  const anchor = buildMediaAnchor(taps)
  const { shifts, goals } = buildMediaWindows(taps, anchor)
  const fileName = masterClipFileName({
    opponentShort: game.opponentShort,
    date: game.date,
    gameId: game.gameId,
  })
  const pathurl = masterClipPathUrl(fileName)

  const maxOutMs = Math.max(
    0,
    ...shifts.map((w) => w.outMs),
    ...goals.map((w) => w.outMs),
    60_000,
  )
  // Master duration: cover farthest out + 2 min headroom
  const masterDurationFrames = msToFrames(maxOutMs + 120_000)

  const projectName = `Heat vs ${game.opponentShort}${game.date ? ` · ${game.date}` : ''}`
  const fileId = 'heat-master-file-1'

  const children: string[] = []
  if (shifts.length) {
    children.push(
      sequenceXml({
        id: 'seq-shifts',
        name: `Shifts · ${game.opponentShort}`,
        windows: shifts,
        fileId,
        pathurl,
        fileName,
        masterDurationFrames,
      }),
    )
  }
  if (goals.length) {
    children.push(
      sequenceXml({
        id: 'seq-goals',
        name: `Goals · ${game.opponentShort}`,
        windows: goals,
        fileId,
        pathurl,
        fileName,
        masterDurationFrames,
      }),
    )
  }

  // If neither shifts nor goals, still emit an empty Shifts sequence so import works
  if (!children.length) {
    children.push(
      sequenceXml({
        id: 'seq-shifts',
        name: `Shifts · ${game.opponentShort}`,
        windows: [],
        fileId,
        pathurl,
        fileName,
        masterDurationFrames,
      }),
    )
  }

  const warningComment = anchor.warnedNoSync
    ? `<!-- WARNING: No Sync taps — media times are relative to the earliest wall stamp and may be wrong. Add a Sync (Puck drop preferred) and re-export. -->\n`
    : anchor.sync
      ? `<!-- Sync anchor: ${esc(anchor.sync.syncType)} · ${esc(anchor.sync.period)} ${esc(anchor.sync.gameClock)} @ ${esc(anchor.sync.wallTimeIso)} = media 00:00:00:00. Slip master so this moment is at file start (or nudge after Relink). Frame rate ${FRAME_RATE} (timebase 30 NTSC). -->\n`
      : ''

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
${warningComment}  <project>
    <name>${esc(projectName)}</name>
    <children>
      ${children.join('\n      ')}
    </children>
  </project>
</xmeml>
`

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `heat-highlight-premiere-${stamp}.xml`

  const anchorLabel = anchor.sync
    ? `${anchor.sync.syncType} · ${anchor.sync.period} ${anchor.sync.gameClock}`
    : 'no Sync (earliest tap = 0)'

  return {
    xml,
    filename,
    warnedNoSync: anchor.warnedNoSync,
    shiftCount: shifts.length,
    goalCount: goals.length,
    masterFileName: fileName,
    pathurl,
    frameRate: FRAME_RATE,
    anchorLabel,
  }
}

export function exportFcpXml(taps: TapEvent[], game: ActiveGame): ExportXmlResult {
  const result = buildFcpXml(taps, game)
  downloadText(result.filename, result.xml, 'application/xml')
  return result
}
