/**
 * Free Cloudflare Worker for Web Push (cron + VAPID).
 * Isolated from nextshift-test / ShowRunner — own worker + KV only.
 */
export const PUSH_WORKER_URL =
  'https://heat-highlight-tap-remind.showrunner-review.workers.dev'

/** VAPID public key (private key lives only as Worker secret). */
export const VAPID_PUBLIC_KEY =
  'BA9Wp5YtVlHNrYNPCjeCDTBBLK6D51FlXHwfJVC7x0XQFehVWY7DFOoIpuU564vaPGO50ZU2jWrslN78jq8RqTE'

export const REMIND_TAG_PREFIX = 'heat-highlight-tap-game'
