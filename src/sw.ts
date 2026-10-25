/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim, setCacheNameDetails } from 'workbox-core'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

setCacheNameDetails({ prefix: 'heat-highlight-tap-game-remind-1' })
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
self.skipWaiting()
clientsClaim()

type ArmMsg = {
  type: 'ARM_GAME_REMIND'
  fireAtMs: number
  title: string
  body: string
  tag: string
}

type DisarmMsg = { type: 'DISARM_GAME_REMIND' }

let armTimer: ReturnType<typeof setTimeout> | null = null
let armedTag: string | null = null

function clearArm() {
  if (armTimer != null) {
    clearTimeout(armTimer)
    armTimer = null
  }
  armedTag = null
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as ArmMsg | DisarmMsg | { type?: string } | null
  if (!data || typeof data !== 'object') return
  if (data.type === 'DISARM_GAME_REMIND') {
    clearArm()
    return
  }
  if (data.type !== 'ARM_GAME_REMIND') return
  const msg = data as ArmMsg
  clearArm()
  const delay = msg.fireAtMs - Date.now()
  const show = () =>
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      data: { url: self.registration.scope },
    })
  if (delay <= 0) {
    void show()
    return
  }
  // Best-effort only: iOS suspends idle SWs; Web Push covers closed/background.
  armedTag = msg.tag
  armTimer = setTimeout(() => {
    armTimer = null
    if (armedTag !== msg.tag) return
    void show()
  }, Math.min(delay, 2_147_000_000))
})

self.addEventListener('push', (event: PushEvent) => {
  let title = 'Highlight Tap · game start'
  let body = 'Your game is starting'
  let tag = 'heat-highlight-tap-game-start'
  try {
    const raw = event.data?.json() as
      | { title?: string; body?: string; tag?: string }
      | undefined
    if (raw?.title) title = raw.title
    if (raw?.body) body = raw.body
    if (raw?.tag) tag = raw.tag
  } catch {
    const text = event.data?.text()
    if (text) body = text
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url: self.registration.scope },
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const target =
    (event.notification.data as { url?: string } | undefined)?.url ||
    self.registration.scope
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target)
    })(),
  )
})
