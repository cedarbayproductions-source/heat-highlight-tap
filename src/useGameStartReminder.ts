import { useCallback, useEffect, useRef, useState } from 'react'
import { formatGameStartLabel, gameStartMs } from './gameStart'
import {
  PUSH_WORKER_URL,
  REMIND_TAG_PREFIX,
  VAPID_PUBLIC_KEY,
} from './pushConfig'
import type { ActiveGame } from './types'

const PREF_KEY = 'heat-highlight-tap-remind-start'
const NOTIFY_TAG = 'heat-highlight-tap-game-start'

export type RemindSupport =
  | 'supported'
  | 'needs-homescreen'
  | 'unsupported'

export type RemindStatus =
  | 'off'
  | 'needs-permission'
  | 'denied'
  | 'no-start'
  | 'passed'
  | 'scheduled'
  | 'unavailable'

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

function notificationApiOk(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    typeof Notification.requestPermission === 'function'
  )
}

function detectSupport(): RemindSupport {
  if (!notificationApiOk()) return 'unsupported'
  if (isIos() && !isStandaloneDisplay()) return 'needs-homescreen'
  return 'supported'
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

function remindTag(game: ActiveGame): string {
  const id =
    game.gameId != null
      ? String(game.gameId)
      : game.scheduleId || game.opponentShort || 'custom'
  return `${REMIND_TAG_PREFIX}-${id}`
}

function notifyBody(game: ActiveGame): { title: string; body: string } {
  const when = formatGameStartLabel(game) ?? game.start ?? 'now'
  return {
    title: 'Highlight Tap · game start',
    body: `vs ${game.opponentShort} · ${when}`,
  }
}

async function showLocalNotification(
  reg: ServiceWorkerRegistration | null,
  game: ActiveGame,
): Promise<void> {
  const { title, body } = notifyBody(game)
  const opts: NotificationOptions = {
    body,
    tag: NOTIFY_TAG,
  }
  try {
    if (reg?.showNotification) {
      await reg.showNotification(title, opts)
      return
    }
  } catch {
    /* fall through */
  }
  if (Notification.permission === 'granted') {
    new Notification(title, opts)
  }
}

async function postPushSchedule(
  subscription: PushSubscription,
  fireAtMs: number,
  game: ActiveGame,
): Promise<boolean> {
  const { title, body } = notifyBody(game)
  try {
    const res = await fetch(`${PUSH_WORKER_URL}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        fireAtMs,
        title,
        body,
        tag: remindTag(game),
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function clearPushSchedule(
  subscription: PushSubscription | null,
): Promise<void> {
  if (!subscription) return
  try {
    await fetch(`${PUSH_WORKER_URL}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } catch {
    /* offline / worker down — local disarm still applies */
  }
}

export function useGameStartReminder(game: ActiveGame) {
  const [enabled, setEnabledState] = useState(readPref)
  const [support] = useState<RemindSupport>(detectSupport)
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    notificationApiOk() ? Notification.permission : 'denied',
  )
  const [pushArmed, setPushArmed] = useState(false)
  const [localArmed, setLocalArmed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  const gameRef = useRef(game)
  gameRef.current = game
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const clearLocalTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLocalArmed(false)
    void getSwRegistration().then((reg) => {
      reg?.active?.postMessage({ type: 'DISARM_GAME_REMIND' })
    })
  }, [])

  const armLocal = useCallback(
    async (fireAtMs: number, g: ActiveGame) => {
      clearLocalTimer()
      firedRef.current = false
      const delay = fireAtMs - Date.now()
      const reg = await getSwRegistration()
      reg?.active?.postMessage({
        type: 'ARM_GAME_REMIND',
        fireAtMs,
        title: notifyBody(g).title,
        body: notifyBody(g).body,
        tag: NOTIFY_TAG,
      })
      if (delay <= 0) {
        if (!firedRef.current) {
          firedRef.current = true
          await showLocalNotification(reg, g)
        }
        setLocalArmed(false)
        return
      }
      // setTimeout is fine while the page is open; SW message is best-effort when backgrounded.
      timerRef.current = window.setTimeout(() => {
        if (firedRef.current) return
        firedRef.current = true
        void showLocalNotification(reg, g)
        setLocalArmed(false)
      }, Math.min(delay, 2_147_000_000))
      setLocalArmed(true)
    },
    [clearLocalTimer],
  )

  const ensurePush = useCallback(async (fireAtMs: number, g: ActiveGame) => {
    if (!('PushManager' in window)) {
      setPushArmed(false)
      return false
    }
    const reg = await getSwRegistration()
    if (!reg?.pushManager) {
      setPushArmed(false)
      return false
    }
    try {
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            VAPID_PUBLIC_KEY,
          ) as BufferSource,
        })
      }
      const ok = await postPushSchedule(sub, fireAtMs, g)
      setPushArmed(ok)
      return ok
    } catch {
      setPushArmed(false)
      return false
    }
  }, [])

  const disarmAll = useCallback(async () => {
    clearLocalTimer()
    setPushArmed(false)
    const reg = await getSwRegistration()
    const sub = await reg?.pushManager?.getSubscription()
    await clearPushSchedule(sub ?? null)
  }, [clearLocalTimer])

  const syncSchedule = useCallback(async () => {
    if (!enabledRef.current) {
      await disarmAll()
      return
    }
    if (support === 'unsupported' || support === 'needs-homescreen') {
      await disarmAll()
      return
    }
    if (Notification.permission !== 'granted') {
      await disarmAll()
      return
    }
    const g = gameRef.current
    const fireAtMs = gameStartMs(g)
    if (fireAtMs == null) {
      await disarmAll()
      return
    }
    if (fireAtMs <= Date.now() - 60_000) {
      // More than a minute past start — don't fire stale.
      clearLocalTimer()
      setPushArmed(false)
      const reg = await getSwRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      await clearPushSchedule(sub ?? null)
      return
    }
    await armLocal(fireAtMs, g)
    await ensurePush(fireAtMs, g)
  }, [armLocal, clearLocalTimer, disarmAll, ensurePush, support])

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        if (support === 'unsupported' || support === 'needs-homescreen') {
          setEnabledState(false)
          writePref(false)
          return
        }
        let perm = Notification.permission
        if (perm === 'default') {
          perm = await Notification.requestPermission()
        }
        setPermission(perm)
        if (perm !== 'granted') {
          setEnabledState(false)
          writePref(false)
          await disarmAll()
          return
        }
        setEnabledState(true)
        writePref(true)
        enabledRef.current = true
        await syncSchedule()
        return
      }
      setEnabledState(false)
      writePref(false)
      enabledRef.current = false
      await disarmAll()
    },
    [disarmAll, support, syncSchedule],
  )

  // Re-arm when game or permission changes while enabled.
  useEffect(() => {
    if (!enabled) return
    void syncSchedule()
  }, [
    enabled,
    game.date,
    game.start,
    game.gameId,
    game.opponentShort,
    syncSchedule,
  ])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && enabledRef.current) {
        if (notificationApiOk()) setPermission(Notification.permission)
        void syncSchedule()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [syncSchedule])

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const fireAtMs = gameStartMs(game)
  const label = formatGameStartLabel(game)

  let status: RemindStatus = 'off'
  if (support === 'unsupported' || support === 'needs-homescreen') {
    status = 'unavailable'
  } else if (!enabled) {
    status = 'off'
  } else if (permission === 'denied') {
    status = 'denied'
  } else if (permission !== 'granted') {
    status = 'needs-permission'
  } else if (fireAtMs == null) {
    status = 'no-start'
  } else if (fireAtMs <= Date.now() - 60_000) {
    status = 'passed'
  } else if (localArmed || pushArmed) {
    status = 'scheduled'
  } else {
    status = 'needs-permission'
  }

  return {
    enabled,
    setEnabled,
    support,
    permission,
    status,
    label,
    fireAtMs,
    localArmed,
    pushArmed,
  }
}
