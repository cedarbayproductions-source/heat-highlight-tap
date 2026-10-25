import { useEffect, useId, useState } from 'react'
import { BUILD_STAMP } from './buildStamp'
import { exportJson } from './exportJson'
import { exportFcpXml } from './exportXml'
import {
  FALLBACK_GAME,
  fetchCahaActiveGame,
  gameIdLabel,
  hintFromTournamentUrl,
  makeManualGame,
} from './game'
import { DEFAULT_SHIFT_PLAYER, ORDERED_ROSTER, playerLabel } from './roster'
import {
  labelsFromGame,
  loadActiveGame,
  loadOpenShift,
  loadTaps,
  saveActiveGame,
  saveOpenShift,
  saveTaps,
} from './storage'
import type {
  ActiveGame,
  OpenShift,
  Period,
  SyncType,
  TapEvent,
} from './types'
import { useScreenWakeLock } from './useScreenWakeLock'

const SHIFT_BACKDATE_MS = 30_000
const NONE = ''
const SYNC_TYPES: SyncType[] = ['Puck drop', 'Stoppage', 'Other']
const PERIODS: Period[] = ['P1', 'P2', 'P3', 'OT']
const PUCK_DROP_CLOCK = '16:00'

type DraftGoal = {
  kind: 'goal'
  wallTimeMs: number
  wallTimeIso: string
  scorer: string
  assist1: string
  assist2: string
}

type DraftSync = {
  kind: 'sync'
  wallTimeMs: number
  wallTimeIso: string
  syncType: SyncType
  period: Period
  gameClock: string
  clockTouched: boolean
  note: string
}

type Draft = DraftGoal | DraftSync

type CustomForm = {
  opponent: string
  date: string
  venue: string
  note: string
  tournamentUrl: string
  hintNote: string
  hintBusy: boolean
}

function emptyCustom(game: ActiveGame): CustomForm {
  if (game.source === 'manual') {
    return {
      opponent: game.opponent,
      date: game.date ?? '',
      venue: game.venue ?? '',
      note: game.note ?? '',
      tournamentUrl: game.tournamentUrl ?? '',
      hintNote: '',
      hintBusy: false,
    }
  }
  return {
    opponent: '',
    date: '',
    venue: '',
    note: '',
    tournamentUrl: '',
    hintNote: '',
    hintBusy: false,
  }
}

function isClock(v: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(v.trim())
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function PlayerSelect({
  id,
  label,
  value,
  onChange,
  allowNone,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  allowNone?: boolean
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none focus:border-[var(--heat-red)] focus:ring-2 focus:ring-[var(--heat-red)]/40"
      >
        {allowNone ? <option value={NONE}>— None —</option> : null}
        {!allowNone ? <option value={NONE}>Select scorer…</option> : null}
        {ORDERED_ROSTER.map((p) => {
          const label = playerLabel(p)
          return (
            <option key={p.number} value={label}>
              {label}
            </option>
          )
        })}
      </select>
    </label>
  )
}

function OptionSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function App() {
  const uid = useId()
  const [game, setGame] = useState<ActiveGame>(() => loadActiveGame())
  const [taps, setTaps] = useState<TapEvent[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState<CustomForm>(() =>
    emptyCustom(loadActiveGame()),
  )
  const [flash, setFlash] = useState(false)
  const [clockError, setClockError] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [openShift, setOpenShift] = useState<OpenShift | null>(() =>
    loadOpenShift(),
  )
  const [shiftPlayer, setShiftPlayer] = useState(
    () => loadOpenShift()?.player ?? DEFAULT_SHIFT_PLAYER,
  )
  const [nowMs, setNowMs] = useState(() => Date.now())
  /** Non-null = show Sync-before-Shift reminder; value is backdate ms for Continue. */
  const [pendingShiftBackdate, setPendingShiftBackdate] = useState<
    number | null
  >(null)
  const {
    keepAwake,
    setKeepAwake,
    active: wakeLockActive,
    support: wakeLockSupport,
  } = useScreenWakeLock()

  useEffect(() => {
    setTaps(loadTaps(game))
    if (game.source === 'manual') {
      setStatus('Custom game (manual)')
      return
    }
    let cancelled = false
    setStatus('Loading CAHA schedule…')
    ;(async () => {
      try {
        const { game: next } = await fetchCahaActiveGame()
        if (cancelled) return
        setGame(next)
        saveActiveGame(next)
        setStatus(
          next.date
            ? `CAHA · ${next.date}${next.start ? ` ${next.start}` : ''}`
            : 'CAHA schedule',
        )
      } catch {
        if (cancelled) return
        setStatus('Offline — using cached game')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, [])

  useEffect(() => {
    if (!openShift) return
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [openShift])

  function applyGame(next: ActiveGame, label: string) {
    setGame(next)
    saveActiveGame(next)
    setStatus(label)
  }

  function applyTaps(next: TapEvent[]) {
    setTaps(next)
    saveTaps(next)
  }

  function stampWall() {
    const wallTimeMs = Date.now()
    const wallTimeIso = new Date(wallTimeMs).toISOString()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 600)
    return { wallTimeMs, wallTimeIso }
  }

  function onGoal() {
    const { wallTimeMs, wallTimeIso } = stampWall()
    setClockError(false)
    setCustomOpen(false)
    setDraft({
      kind: 'goal',
      wallTimeMs,
      wallTimeIso,
      scorer: playerLabel(ORDERED_ROSTER[0]),
      assist1: NONE,
      assist2: NONE,
    })
  }

  function onSync() {
    const { wallTimeMs, wallTimeIso } = stampWall()
    setClockError(false)
    setCustomOpen(false)
    setDraft({
      kind: 'sync',
      wallTimeMs,
      wallTimeIso,
      syncType: 'Puck drop',
      period: 'P1',
      gameClock: PUCK_DROP_CLOCK,
      clockTouched: false,
      note: '',
    })
  }

  function setOpen(next: OpenShift | null) {
    setOpenShift(next)
    saveOpenShift(next)
    if (next) setShiftPlayer(next.player)
  }

  function hasSyncForActiveGame(): boolean {
    return taps.some((t) => {
      if (t.type !== 'sync') return false
      if (game.gameId != null && t.gameId != null) {
        return t.gameId === game.gameId
      }
      if (game.source === 'manual') {
        return t.gameSource === 'manual' && t.opponent === game.opponent
      }
      return (
        t.opponentShort === game.opponentShort || t.opponent === game.opponent
      )
    })
  }

  function doShiftOn(backdateMs = 0) {
    if (openShift) return
    setPendingShiftBackdate(null)
    setCustomOpen(false)
    setDraft(null)
    const startWallMs = Date.now() - backdateMs
    const startWallIso = new Date(startWallMs).toISOString()
    setFlash(true)
    window.setTimeout(() => setFlash(false), 600)
    setOpen({
      player: shiftPlayer || DEFAULT_SHIFT_PLAYER,
      startWallMs,
      startWallIso,
    })
  }

  /** Shift On / On (−30s): remind if no Sync yet for this game. */
  function shiftOn(backdateMs = 0) {
    if (openShift) return
    if (!hasSyncForActiveGame()) {
      setPendingShiftBackdate(backdateMs)
      return
    }
    doShiftOn(backdateMs)
  }

  function dismissShiftSyncReminder() {
    setPendingShiftBackdate(null)
  }

  function continueShiftWithoutSync() {
    if (pendingShiftBackdate == null) return
    doShiftOn(pendingShiftBackdate)
  }

  function goToSyncFromShiftReminder() {
    setPendingShiftBackdate(null)
    onSync()
  }

  function shiftOff() {
    if (!openShift) return
    setCustomOpen(false)
    setDraft(null)
    const endWallMs = Date.now()
    const endWallIso = new Date(endWallMs).toISOString()
    const labels = labelsFromGame(game)
    applyTaps([
      {
        id: crypto.randomUUID(),
        type: 'shift',
        player: openShift.player,
        wallTimeMs: openShift.startWallMs,
        wallTimeIso: openShift.startWallIso,
        startWallMs: openShift.startWallMs,
        startWallIso: openShift.startWallIso,
        endWallMs,
        endWallIso,
        durationMs: Math.max(0, endWallMs - openShift.startWallMs),
        createdAtIso: endWallIso,
        ...labels,
      },
      ...taps,
    ])
    setOpen(null)
  }

  function onSyncType(next: string) {
    if (!draft || draft.kind !== 'sync') return
    const syncType = next as SyncType
    setClockError(false)
    if (syncType === 'Puck drop' && !draft.clockTouched) {
      setDraft({ ...draft, syncType, gameClock: PUCK_DROP_CLOCK })
    } else {
      setDraft({ ...draft, syncType })
    }
  }

  function cancelDraft() {
    setDraft(null)
    setClockError(false)
  }

  function saveDraft() {
    if (!draft) return
    const labels = labelsFromGame(game)
    if (draft.kind === 'goal') {
      if (!draft.scorer) return
      const duringShift =
        openShift != null && openShift.player === DEFAULT_SHIFT_PLAYER
          ? true
          : undefined
      applyTaps([
        {
          id: crypto.randomUUID(),
          type: 'goal',
          wallTimeMs: draft.wallTimeMs,
          wallTimeIso: draft.wallTimeIso,
          scorer: draft.scorer,
          assist1: draft.assist1 || null,
          assist2: draft.assist2 || null,
          ...(duringShift ? { duringShift: true } : {}),
          createdAtIso: new Date().toISOString(),
          ...labels,
        },
        ...taps,
      ])
      setDraft(null)
      return
    }
    const clock = draft.gameClock.trim()
    if (!isClock(clock)) {
      setClockError(true)
      return
    }
    applyTaps([
      {
        id: crypto.randomUUID(),
        type: 'sync',
        wallTimeMs: draft.wallTimeMs,
        wallTimeIso: draft.wallTimeIso,
        syncType: draft.syncType,
        period: draft.period,
        gameClock: clock,
        note: draft.note.trim() || null,
        createdAtIso: new Date().toISOString(),
        ...labels,
      },
      ...taps,
    ])
    setDraft(null)
    setClockError(false)
  }

  async function refreshCaha() {
    if (refreshing) return
    if (
      game.source === 'manual' &&
      !window.confirm('Replace custom game with the next CAHA game?')
    ) {
      return
    }
    setRefreshing(true)
    setStatus('Refreshing CAHA…')
    try {
      const { game: next } = await fetchCahaActiveGame()
      applyGame(
        next,
        next.date
          ? `CAHA · ${next.date}${next.start ? ` ${next.start}` : ''}`
          : 'CAHA schedule',
      )
      setCustomOpen(false)
    } catch {
      setStatus('Refresh failed — kept cached game')
    } finally {
      setRefreshing(false)
    }
  }

  function openCustom() {
    setDraft(null)
    setCustom(emptyCustom(game))
    setCustomOpen(true)
  }

  async function blurTournamentUrl() {
    const url = custom.tournamentUrl.trim()
    if (!url || custom.hintBusy) return
    setCustom((c) => ({ ...c, hintBusy: true, hintNote: 'Checking link…' }))
    const hint = await hintFromTournamentUrl(url)
    setCustom((c) => ({
      ...c,
      hintBusy: false,
      opponent: c.opponent.trim() ? c.opponent : (hint.opponent ?? c.opponent),
      date: c.date.trim() ? c.date : (hint.date ?? c.date),
      hintNote:
        hint.note ?? (hint.opponent ? 'Suggested opponent from page.' : ''),
    }))
  }

  function saveCustom() {
    if (!custom.opponent.trim()) return
    applyGame(
      makeManualGame({
        opponent: custom.opponent,
        date: custom.date,
        venue: custom.venue,
        note: custom.note,
        tournamentUrl: custom.tournamentUrl,
      }),
      'Custom game (manual)',
    )
    setCustomOpen(false)
  }

  function clearAll() {
    if (!(taps.length || openShift)) return
    if (!window.confirm('Clear all saved taps on this phone?')) return
    applyTaps([])
    setOpen(null)
  }

  function onExportXml() {
    const result = exportFcpXml(taps, game)
    if (result.warnedNoSync) {
      window.alert(
        `Exported ${result.filename}\n\nNo Sync taps — media In/Out are relative to the earliest wall stamp and may be wrong in Premiere. Add a Sync (Puck drop preferred) and re-export.\n\nMaster path placeholder:\n${result.pathurl}`,
      )
    } else {
      window.alert(
        `Exported ${result.filename}\n\n${result.shiftCount} shift clip(s) · ${result.goalCount} goal clip(s)\nAnchor: ${result.anchorLabel} = media 00:00\nFrame rate: ${result.frameRate}\n\nPut your game film at:\nMEDIA/${result.masterFileName}\n(or Relink after import)`,
      )
    }
  }

  const saveDisabled =
    draft?.kind === 'goal'
      ? !draft.scorer
      : draft?.kind === 'sync'
        ? !draft.gameClock.trim()
        : true

  const metaLine = [game.date, game.start, game.venue, game.side ? `Heat ${game.side}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      {pendingShiftBackdate != null ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-sync-reminder-title`}
        >
          <div className="sheet-enter w-full max-w-sm rounded-2xl border border-[var(--panel-edge)] bg-[var(--panel)] p-5 shadow-xl backdrop-blur-sm">
            <p
              id={`${uid}-sync-reminder-title`}
              className="font-[family-name:var(--display)] text-xl font-semibold uppercase tracking-wide text-[var(--ink)]"
            >
              No Sync yet
            </p>
            <p className="mt-3 text-base text-[var(--ink)]">
              Add a Sync (puck drop / rink clock) so shifts line up in Premiere.
              Without it, Export XML media times may be wrong.
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Best at puck drop — clock defaults to 16:00.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={goToSyncFromShiftReminder}
                className="w-full rounded-xl border-[3px] border-[var(--ice)] bg-[linear-gradient(165deg,#1a3a4d,#0e2433)] px-4 py-3.5 font-[family-name:var(--display)] text-lg font-bold uppercase tracking-wide text-[var(--ink)]"
              >
                Go to Sync
              </button>
              <button
                type="button"
                onClick={continueShiftWithoutSync}
                className="w-full rounded-xl border-2 border-[var(--shift)] bg-[linear-gradient(165deg,#2a5240,#1a3328)] px-4 py-3 text-base font-semibold text-[var(--ink)]"
              >
                Continue anyway
              </button>
              <button
                type="button"
                onClick={dismissShiftSyncReminder}
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="mb-5 text-center">
        <p className="font-[family-name:var(--display)] text-4xl font-bold uppercase tracking-[0.08em] text-[var(--heat-red-hot)] sm:text-5xl">
          California Heat
        </p>
        <h1 className="mt-1 font-[family-name:var(--display)] text-2xl font-semibold uppercase tracking-wide text-[var(--ink)]">
          Highlight Tap
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {game.heatLabel} · vs {game.opponentShort} · {gameIdLabel(game)}
        </p>
        {metaLine ? (
          <p className="text-xs text-[var(--muted)]">{metaLine}</p>
        ) : null}
        {game.tournamentUrl ? (
          <p className="mt-1 truncate text-[11px] text-[var(--ice)]">
            <a
              href={game.tournamentUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--panel-edge)] underline-offset-2"
            >
              Tournament link
            </a>
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--muted)]">
          Goal = wall time · Sync = rink clock · Shift = #93 ice windows
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
          <button
            type="button"
            onClick={() => void refreshCaha()}
            disabled={refreshing}
            className="font-semibold uppercase tracking-[0.12em] text-[var(--ice)] underline decoration-[var(--panel-edge)] underline-offset-2 disabled:opacity-40"
          >
            {refreshing ? 'Refreshing…' : 'Refresh game'}
          </button>
          <button
            type="button"
            onClick={openCustom}
            className="font-semibold uppercase tracking-[0.12em] text-[var(--muted)] underline decoration-[var(--panel-edge)] underline-offset-2"
          >
            Custom game
          </button>
          <button
            type="button"
            onClick={() => setKeepAwake(!keepAwake)}
            aria-pressed={keepAwake}
            className="font-semibold uppercase tracking-[0.12em] text-[var(--muted)] underline decoration-[var(--panel-edge)] underline-offset-2"
            title={
              wakeLockSupport === 'unsupported'
                ? 'Screen Wake Lock needs a recent iOS Safari (≈16.4+)'
                : keepAwake
                  ? 'Screen stays on while this app is open'
                  : 'Tap to keep screen on during the game'
            }
          >
            Keep awake{' '}
            {wakeLockSupport === 'unsupported'
              ? '· N/A'
              : keepAwake
                ? wakeLockActive
                  ? '· ON'
                  : '· …'
                : '· off'}
          </button>
        </div>
        {status ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">{status}</p>
        ) : null}
      </header>

      {customOpen ? (
        <section className="sheet-enter mb-6 rounded-2xl border border-[var(--panel-edge)] bg-[var(--panel)] p-4 shadow-xl backdrop-blur-sm">
          <h2 className="font-[family-name:var(--display)] text-xl font-semibold uppercase tracking-wide text-[var(--ink)]">
            Set custom game
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            CAHA games load automatically. Tournaments: paste the schedule link
            and set the opponent.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            <label className="block" htmlFor={`${uid}-turl`}>
              <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                Tournament URL{' '}
                <span className="normal-case tracking-normal opacity-70">
                  (optional)
                </span>
              </span>
              <input
                id={`${uid}-turl`}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://…"
                value={custom.tournamentUrl}
                onChange={(e) =>
                  setCustom({ ...custom, tournamentUrl: e.target.value })
                }
                onBlur={() => void blurTournamentUrl()}
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-base font-medium text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
              />
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                {custom.hintBusy
                  ? 'Checking link…'
                  : custom.hintNote ||
                    'Best-effort only — many sites block reading from the phone browser.'}
              </p>
            </label>
            <label className="block" htmlFor={`${uid}-opp`}>
              <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                Opponent
              </span>
              <input
                id={`${uid}-opp`}
                type="text"
                autoComplete="off"
                placeholder="e.g. Vegas Elite"
                value={custom.opponent}
                onChange={(e) =>
                  setCustom({ ...custom, opponent: e.target.value })
                }
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--heat-red)] focus:ring-2 focus:ring-[var(--heat-red)]/40"
              />
            </label>
            <label className="block" htmlFor={`${uid}-date`}>
              <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                Date{' '}
                <span className="normal-case tracking-normal opacity-70">
                  (optional)
                </span>
              </span>
              <input
                id={`${uid}-date`}
                type="date"
                value={custom.date}
                onChange={(e) => setCustom({ ...custom, date: e.target.value })}
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
              />
            </label>
            <label className="block" htmlFor={`${uid}-venue`}>
              <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                Venue{' '}
                <span className="normal-case tracking-normal opacity-70">
                  (optional)
                </span>
              </span>
              <input
                id={`${uid}-venue`}
                type="text"
                autoComplete="off"
                placeholder="Rink name"
                value={custom.venue}
                onChange={(e) =>
                  setCustom({ ...custom, venue: e.target.value })
                }
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
              />
            </label>
            <label className="block" htmlFor={`${uid}-gnote`}>
              <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                Note{' '}
                <span className="normal-case tracking-normal opacity-70">
                  (optional)
                </span>
              </span>
              <input
                id={`${uid}-gnote`}
                type="text"
                maxLength={80}
                autoComplete="off"
                placeholder="Pool game, championship, …"
                value={custom.note}
                onChange={(e) => setCustom({ ...custom, note: e.target.value })}
                className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
              />
            </label>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="rounded-xl border border-[var(--panel-edge)] bg-transparent px-4 py-3.5 text-base font-semibold text-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveCustom}
              disabled={!custom.opponent.trim()}
              className="rounded-xl bg-[var(--heat-red)] px-4 py-3.5 text-base font-bold uppercase tracking-wide text-white disabled:opacity-40"
            >
              Save game
            </button>
          </div>
          <button
            type="button"
            onClick={() => void refreshCaha()}
            className="mt-3 w-full rounded-xl border border-[var(--panel-edge)] px-4 py-2.5 text-sm font-semibold text-[var(--ice)]"
          >
            Use CAHA next game instead
          </button>
        </section>
      ) : null}

      {!draft && !customOpen ? (
        <section className="flex flex-1 flex-col items-center justify-start gap-3 py-2 sm:justify-center sm:gap-5 sm:py-4">
          <button
            type="button"
            onClick={onGoal}
            className="goal-btn flex h-[min(38vw,200px)] w-[min(38vw,200px)] items-center justify-center rounded-full border-[6px] border-[#f5d0d6] bg-[linear-gradient(160deg,var(--heat-red-hot),var(--heat-red-deep))] font-[family-name:var(--display)] text-4xl font-bold uppercase tracking-[0.14em] text-white shadow-[0_12px_40px_rgba(200,16,46,0.45)] active:brightness-95 sm:h-[min(52vw,240px)] sm:w-[min(52vw,240px)] sm:text-5xl"
            aria-label="Record goal wall time"
          >
            Goal
          </button>
          <p className="max-w-[16rem] text-center text-xs text-[var(--muted)] sm:text-sm">
            Tap when the puck goes in — then scorer & assists.
          </p>
          <button
            type="button"
            onClick={onSync}
            className="sync-btn flex min-h-[3.75rem] w-full max-w-sm items-center justify-center rounded-2xl border-[3px] border-[var(--ice)] bg-[linear-gradient(165deg,#1a3a4d,#0e2433)] px-6 py-3.5 font-[family-name:var(--display)] text-2xl font-bold uppercase tracking-[0.16em] text-[var(--ink)] shadow-[0_10px_28px_rgba(30,80,120,0.35)] active:brightness-95 sm:min-h-[4.25rem] sm:py-4 sm:text-3xl"
            aria-label="Record rink game clock sync"
          >
            Sync
          </button>
          <p className="max-w-[20rem] text-center text-xs text-[var(--muted)] sm:text-sm">
            Best at puck drop (clock defaults to 16:00). Forgot? Stoppage or
            first-goal catch-up still works for LiveBarn.
          </p>
          <div
            className={`shift-panel mt-2 w-full max-w-sm rounded-2xl border px-4 py-3 ${
              openShift
                ? 'border-[var(--shift)] bg-[rgba(60,120,90,0.18)]'
                : 'border-[var(--panel-edge)] bg-[var(--panel)]'
            }${flash && openShift ? ' stamp-flash' : ''}`}
          >
            <p className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--shift)]">
              Shift · ice time · not Goal
            </p>
            {openShift ? (
              <>
                <p className="mt-2 text-center font-[family-name:var(--display)] text-xl font-semibold uppercase tracking-wide text-[var(--shift-hot)]">
                  ON ice · {openShift.player.replace(/^#\d+\s*/, '#')}
                </p>
                <p className="mt-1 text-center font-[family-name:var(--display)] text-3xl font-bold tabular-nums text-[var(--ink)]">
                  {fmtElapsed(nowMs - openShift.startWallMs)}
                </p>
                <p className="mt-0.5 text-center text-[11px] text-[var(--muted)]">
                  Started {fmtTime(openShift.startWallIso)}
                </p>
                <button
                  type="button"
                  onClick={shiftOff}
                  className="shift-off-btn mt-3 flex min-h-[3.25rem] w-full items-center justify-center rounded-xl border-2 border-[var(--shift)] bg-[linear-gradient(165deg,#2a5240,#1a3328)] px-4 py-2.5 font-[family-name:var(--display)] text-xl font-bold uppercase tracking-[0.14em] text-[var(--ink)] active:brightness-95"
                  aria-label="Shift off — stamp end wall time now"
                >
                  Shift off
                </button>
              </>
            ) : (
              <>
                <label className="mt-2 block" htmlFor={`${uid}-shift-player`}>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                    Tracked player
                  </span>
                  <select
                    id={`${uid}-shift-player`}
                    value={shiftPlayer}
                    onChange={(e) => setShiftPlayer(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-[var(--panel-edge)] bg-[#0e1620] px-3 py-2.5 text-sm font-medium text-[var(--ink)] outline-none focus:border-[var(--shift)] focus:ring-2 focus:ring-[var(--shift)]/35"
                  >
                    {ORDERED_ROSTER.map((p) => {
                      const label = playerLabel(p)
                      return (
                        <option key={p.number} value={label}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => shiftOn(0)}
                  className="shift-on-btn mt-3 flex min-h-[3.25rem] w-full items-center justify-center rounded-xl border-2 border-[var(--shift)] bg-[linear-gradient(165deg,#2a5240,#1a3328)] px-4 py-2.5 font-[family-name:var(--display)] text-xl font-bold uppercase tracking-[0.14em] text-[var(--ink)] active:brightness-95"
                  aria-label="Shift on — stamp start wall time now"
                >
                  Shift on
                </button>
                <button
                  type="button"
                  onClick={() => shiftOn(SHIFT_BACKDATE_MS)}
                  className="mt-2 flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-dashed border-[var(--shift)]/70 bg-transparent px-3 py-2 text-sm font-semibold text-[var(--shift-hot)] active:brightness-95"
                  aria-label="Shift on started about 30 seconds ago — backdate start by 30 seconds"
                >
                  On (−30s) · started ~30s ago
                </button>
                <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
                  Optional. Post-game we cut each window and stitch into one
                  recruiting clip.
                </p>
              </>
            )}
          </div>
        </section>
      ) : null}

      {draft ? (
        <section
          className={`sheet-enter mb-6 rounded-2xl border border-[var(--panel-edge)] bg-[var(--panel)] p-4 shadow-xl backdrop-blur-sm ${flash ? 'stamp-flash' : ''}`}
        >
          <div className="mb-4 rounded-xl border border-[var(--panel-edge)] bg-[#0a1018] px-4 py-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ice)]">
              {draft.kind === 'sync'
                ? 'Sync wall time captured'
                : 'Wall time captured'}
            </p>
            <p className="mt-1 font-[family-name:var(--display)] text-3xl font-semibold tabular-nums text-[var(--ink)]">
              {fmtTime(draft.wallTimeIso)}
            </p>
            <p className="mt-1 break-all text-[11px] text-[var(--muted)]">
              {draft.wallTimeIso} · {draft.wallTimeMs}
            </p>
          </div>
          {draft.kind === 'goal' ? (
            <div className="flex flex-col gap-4">
              <PlayerSelect
                id={`${uid}-scorer`}
                label="Scorer"
                value={draft.scorer}
                onChange={(v) => setDraft({ ...draft, scorer: v })}
              />
              <PlayerSelect
                id={`${uid}-a1`}
                label="Assist 1"
                value={draft.assist1}
                onChange={(v) => setDraft({ ...draft, assist1: v })}
                allowNone
              />
              <PlayerSelect
                id={`${uid}-a2`}
                label="Assist 2"
                value={draft.assist2}
                onChange={(v) => setDraft({ ...draft, assist2: v })}
                allowNone
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <OptionSelect
                id={`${uid}-sync-type`}
                label="Sync type"
                value={draft.syncType}
                options={SYNC_TYPES}
                onChange={onSyncType}
              />
              <OptionSelect
                id={`${uid}-period`}
                label="Period"
                value={draft.period}
                options={PERIODS}
                onChange={(v) =>
                  setDraft({ ...draft, period: v as Period })
                }
              />
              <label className="block" htmlFor={`${uid}-clock`}>
                <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                  Game clock
                </span>
                <input
                  id={`${uid}-clock`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={
                    draft.syncType === 'Puck drop'
                      ? '16:00'
                      : 'e.g. 8:45 (frozen board)'
                  }
                  value={draft.gameClock}
                  onChange={(e) => {
                    setClockError(false)
                    setDraft({
                      ...draft,
                      gameClock: e.target.value,
                      clockTouched: true,
                    })
                  }}
                  className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium tabular-nums text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
                  aria-invalid={clockError}
                />
                {clockError ? (
                  <p className="mt-1.5 text-sm text-[var(--heat-red-hot)]">
                    Enter the rink clock like 16:00 or 8:45.
                  </p>
                ) : draft.syncType === 'Puck drop' ? (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Tap at the drop — no need to read a moving board. Defaults
                    to 16:00 (16-minute period start). Pick the period above.
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Required — enter the frozen scoreboard clock (or catch-up
                    time).
                  </p>
                )}
              </label>
              <label className="block" htmlFor={`${uid}-note`}>
                <span className="mb-1.5 block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ice)]">
                  Note{' '}
                  <span className="normal-case tracking-normal opacity-70">
                    (optional)
                  </span>
                </span>
                <input
                  id={`${uid}-note`}
                  type="text"
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Short note"
                  value={draft.note}
                  onChange={(e) =>
                    setDraft({ ...draft, note: e.target.value })
                  }
                  className="w-full rounded-xl border border-[var(--panel-edge)] bg-[#0e1620] px-4 py-4 text-lg font-medium text-[var(--ink)] shadow-inner outline-none placeholder:text-[var(--muted)] focus:border-[var(--ice)] focus:ring-2 focus:ring-[var(--ice)]/35"
                />
              </label>
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={cancelDraft}
              className="rounded-xl border border-[var(--panel-edge)] bg-transparent px-4 py-3.5 text-base font-semibold text-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saveDisabled}
              className="rounded-xl bg-[var(--heat-red)] px-4 py-3.5 text-base font-bold uppercase tracking-wide text-white disabled:opacity-40"
            >
              {draft.kind === 'sync' ? 'Save sync' : 'Save tap'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-auto">
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 className="font-[family-name:var(--display)] text-xl font-semibold uppercase tracking-wide">
            Today&apos;s taps
          </h2>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => exportJson(taps)}
              disabled={!taps.length}
              className="rounded-lg border border-[var(--panel-edge)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ice)] disabled:opacity-30"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={onExportXml}
              disabled={!taps.length}
              className="rounded-lg border border-[var(--panel-edge)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--heat-red-hot)] disabled:opacity-30"
            >
              Export XML
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={!taps.length && !openShift}
              className="rounded-lg border border-[var(--panel-edge)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] disabled:opacity-30"
            >
              Clear
            </button>
          </div>
        </div>
        {openShift ? (
          <div className="mb-3 rounded-xl border border-[var(--shift)]/50 bg-[rgba(60,120,90,0.12)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--shift)]">
              Open shift
            </p>
            <p className="mt-1 text-base font-semibold text-[var(--ink)]">
              ON ice · {openShift.player} ·{' '}
              <span className="tabular-nums">
                {fmtElapsed(nowMs - openShift.startWallMs)}
              </span>
            </p>
          </div>
        ) : null}
        {taps.length ? (
          <ul className="flex flex-col gap-3">
            {taps.map((e, i) => (
              <li
                key={e.id}
                className="rounded-xl border border-[var(--panel-edge)] bg-[var(--panel)] px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`font-[family-name:var(--display)] text-lg font-semibold ${
                      e.type === 'shift'
                        ? 'text-[var(--shift-hot)]'
                        : e.type === 'sync'
                          ? 'text-[var(--ice)]'
                          : 'text-[var(--heat-red-hot)]'
                    }`}
                  >
                    #{taps.length - i}
                  </span>
                  <time
                    className="text-sm tabular-nums text-[var(--ice)]"
                    dateTime={
                      e.type === 'shift' ? e.startWallIso : e.wallTimeIso
                    }
                  >
                    {fmtDateTime(
                      e.type === 'shift' ? e.startWallIso : e.wallTimeIso,
                    )}
                  </time>
                </div>
                {e.type === 'sync' ? (
                  <>
                    <p className="mt-1 text-base font-semibold">
                      Sync · {e.syncType} · {e.period} {e.gameClock}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {e.note ?? 'Rink clock anchor'}
                    </p>
                  </>
                ) : e.type === 'shift' ? (
                  <>
                    <p className="mt-1 text-base font-semibold">
                      Shift · {e.player} · {fmtElapsed(e.durationMs)}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {fmtTime(e.startWallIso)} → {fmtTime(e.endWallIso)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-base font-semibold">{e.scorer}</p>
                    <p className="text-sm text-[var(--muted)]">
                      A1: {e.assist1 ?? '—'} · A2: {e.assist2 ?? '—'}
                      {e.duringShift ? ' · during shift' : ''}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--panel-edge)] px-4 py-8 text-center">
            <p className="font-medium text-[var(--ink)]">No taps yet</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Hit Goal when Heat scores, Sync for LiveBarn, or Shift for #93 ice
              windows.
            </p>
          </div>
        )}
      </section>

      <footer className="mt-8 text-center text-[11px] text-[var(--muted)]">
        James Perry · Heat 16AA · Roster from CAHA game 57982 until a new sheet
        posts a lineup
        {game.gameId == null ? '' : ` · Active TTS ${game.gameId}`}
        {game.source === 'manual' ? ' · custom game' : ''}
        {!game.fetchedAtIso && game.source === 'caha'
          ? ` · fallback ${FALLBACK_GAME.opponentShort}`
          : ''}
        <span className="mt-1 block tabular-nums opacity-80">
          build {BUILD_STAMP}
        </span>
      </footer>
    </div>
  )
}
