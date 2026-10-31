import {
  FRAME_RATE,
  anchorLabel,
  buildMediaPlan,
  formatMediaTimecode,
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

/** LiveBarn masters are commonly mono @ 16 kHz (e.g. Sharks Ice). Declaring
 *  stereo/48 kHz in XMEML makes Premiere Relink fail on those files. Pass
 *  `audioChannels: 2` for stereo dumps (e.g. some Cube Olympic feeds). */
export const DEFAULT_XML_AUDIO_CHANNELS = 1
export const DEFAULT_XML_AUDIO_SAMPLE_RATE = 16_000

export type ExportXmlAudioOpts = {
  /** Source audio channel count written to `<channelcount>`. */
  audioChannels?: number
  /** Source sample rate written to audio `<samplerate>`. */
  audioSampleRate?: number
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
  audioChannels: number
  audioSampleRate: number
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
                    <samplerate>${opts.audioSampleRate}</samplerate>
                  </samplecharacteristics>
                  <channelcount>${opts.audioChannels}</channelcount>
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
  audioChannels: number
  audioSampleRate: number
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
        audioChannels: opts.audioChannels,
        audioSampleRate: opts.audioSampleRate,
      }),
    )
  })

  const audioTracks = Array.from({ length: Math.max(1, opts.audioChannels) }, () =>
    `<track>
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>`,
  ).join('\n            ')

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
            <numOutputChannels>${opts.audioChannels}</numOutputChannels>
            <format>
              <samplecharacteristics>
                <depth>16</depth>
                <samplerate>${opts.audioSampleRate}</samplerate>
              </samplecharacteristics>
            </format>
            ${audioTracks}
          </audio>
        </media>
      </sequence>`
}

export type ExportXmlResult = {
  xml: string
  filename: string
  warnedNoSync: boolean
  reanchoredForPreSync: boolean
  shiftCount: number
  goalCount: number
  masterFileName: string
  pathurl: string
  frameRate: number
  anchorLabel: string
  syncMediaMs: number
  warnings: string[]
  audioChannels: number
  audioSampleRate: number
}

export function buildFcpXml(
  taps: TapEvent[],
  game: ActiveGame,
  audioOpts: ExportXmlAudioOpts = {},
): ExportXmlResult {
  const audioChannels = audioOpts.audioChannels ?? DEFAULT_XML_AUDIO_CHANNELS
  const audioSampleRate =
    audioOpts.audioSampleRate ?? DEFAULT_XML_AUDIO_SAMPLE_RATE
  const plan = buildMediaPlan(taps)
  const { anchor, shifts, goals, warnings } = plan
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
        audioChannels,
        audioSampleRate,
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
        audioChannels,
        audioSampleRate,
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
        audioChannels,
        audioSampleRate,
      }),
    )
  }

  let warningComment = ''
  if (anchor.warnedNoSync) {
    warningComment = `<!-- WARNING: No Sync taps — media times are relative to the earliest content wall and may be wrong. Add a Sync (Puck drop preferred) and re-export. -->\n`
  } else if (anchor.sync && anchor.reanchoredForPreSync) {
    warningComment = `<!-- Sync: ${esc(anchor.sync.syncType)} · ${esc(anchor.sync.period)} ${esc(anchor.sync.gameClock)} @ ${esc(anchor.sync.wallTimeIso)} = media ${esc(formatMediaTimecode(anchor.syncMediaMs))} (re-anchored so pre-Sync ice is preserved). Media 00:00:00:00 = earliest cut In — master must include film before Sync. Frame rate ${FRAME_RATE} (timebase 30 NTSC). -->\n`
  } else if (anchor.sync) {
    warningComment = `<!-- Sync anchor: ${esc(anchor.sync.syncType)} · ${esc(anchor.sync.period)} ${esc(anchor.sync.gameClock)} @ ${esc(anchor.sync.wallTimeIso)} = media 00:00:00:00. Slip master so this moment is at file start (or nudge after Relink). Frame rate ${FRAME_RATE} (timebase 30 NTSC). -->\n`
  }

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

  return {
    xml,
    filename,
    warnedNoSync: anchor.warnedNoSync,
    reanchoredForPreSync: anchor.reanchoredForPreSync,
    shiftCount: shifts.length,
    goalCount: goals.length,
    masterFileName: fileName,
    pathurl,
    frameRate: FRAME_RATE,
    anchorLabel: anchorLabel(plan),
    syncMediaMs: anchor.syncMediaMs,
    warnings,
    audioChannels,
    audioSampleRate,
  }
}

export function exportFcpXml(
  taps: TapEvent[],
  game: ActiveGame,
  audioOpts: ExportXmlAudioOpts = {},
): ExportXmlResult {
  const result = buildFcpXml(taps, game, audioOpts)
  downloadText(result.filename, result.xml, 'application/xml')
  return result
}
