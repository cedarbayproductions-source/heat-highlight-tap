import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'heat-highlight-tap-keep-awake'

export type WakeLockSupport = 'supported' | 'unsupported'

function readPref(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === null) return true // default ON for rink / game use
    return v === '1'
  } catch {
    return true
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

function wakeLockApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    typeof navigator.wakeLock?.request === 'function'
  )
}

/**
 * Keep the screen awake while the PWA is visible and keepAwake is on.
 * Re-requests on visibilitychange (iOS releases the lock when backgrounded).
 * First acquire may need a user gesture on some browsers — we also retry on
 * the next pointer/keydown after enable.
 */
export function useScreenWakeLock() {
  const [keepAwake, setKeepAwakeState] = useState(readPref)
  const [active, setActive] = useState(false)
  const [support] = useState<WakeLockSupport>(() =>
    wakeLockApiAvailable() ? 'supported' : 'unsupported',
  )
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  const keepAwakeRef = useRef(keepAwake)
  keepAwakeRef.current = keepAwake

  const release = useCallback(async () => {
    const s = sentinelRef.current
    sentinelRef.current = null
    setActive(false)
    if (!s) return
    try {
      await s.release()
    } catch {
      /* already released */
    }
  }, [])

  const acquire = useCallback(async () => {
    if (!keepAwakeRef.current) return
    if (!wakeLockApiAvailable()) return
    if (document.visibilityState !== 'visible') return
    if (sentinelRef.current && !sentinelRef.current.released) {
      setActive(true)
      return
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      sentinelRef.current = sentinel
      setActive(true)
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null
          setActive(false)
        }
      })
    } catch {
      // NotAllowedError without gesture, or OS denial (Low Power Mode, etc.)
      setActive(false)
    }
  }, [])

  const setKeepAwake = useCallback(
    (on: boolean) => {
      setKeepAwakeState(on)
      writePref(on)
      if (!on) void release()
      else void acquire()
    },
    [acquire, release],
  )

  useEffect(() => {
    if (support !== 'supported') return

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && keepAwakeRef.current) {
        void acquire()
      } else {
        // Browser usually releases on hide; clear our handle.
        sentinelRef.current = null
        setActive(false)
      }
    }

    // Retry after a user gesture if the first request was blocked.
    const onGesture = () => {
      if (keepAwakeRef.current && !sentinelRef.current) void acquire()
    }

    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('pointerdown', onGesture, { passive: true })
    document.addEventListener('keydown', onGesture)

    if (document.visibilityState === 'visible' && keepAwake) {
      void acquire()
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('pointerdown', onGesture)
      document.removeEventListener('keydown', onGesture)
      void release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount + support
  }, [support, acquire, release])

  // When toggle flips on after mount, acquire; when off, release already handled.
  useEffect(() => {
    if (support !== 'supported') return
    if (keepAwake) void acquire()
    else void release()
  }, [keepAwake, support, acquire, release])

  return {
    keepAwake,
    setKeepAwake,
    active,
    support,
  }
}
