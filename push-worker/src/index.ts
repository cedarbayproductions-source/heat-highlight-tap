import { buildPushPayload } from '@block65/webcrypto-web-push'

type Env = {
  REMIND_KV: KVNamespace
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
}

type PushSubJSON = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

type RemindRecord = {
  subscription: PushSubJSON
  fireAtMs: number
  title: string
  body: string
  tag: string
  createdAtMs: number
}

const KEY_PREFIX = 'remind:'
const ALLOWED_ORIGINS = [
  'https://cedarbayproductions-source.github.io',
  'https://heat-highlight-tap.surge.sh',
  'http://localhost:43127',
  'http://localhost:5173',
  'http://127.0.0.1:43127',
  'http://127.0.0.1:5173',
]

function corsHeaders(origin: string | null): HeadersInit {
  const allow =
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
      ? origin
      : ALLOWED_ORIGINS[0]
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

function json(data: unknown, origin: string | null, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders(origin),
    },
  })
}

function kvKey(endpoint: string): string {
  // endpoint is unique per browser install
  let h = 0
  for (let i = 0; i < endpoint.length; i++) {
    h = (h * 31 + endpoint.charCodeAt(i)) >>> 0
  }
  return `${KEY_PREFIX}${h.toString(16)}:${endpoint.length}`
}

function isSub(v: unknown): v is PushSubJSON {
  if (!v || typeof v !== 'object') return false
  const s = v as PushSubJSON
  return (
    typeof s.endpoint === 'string' &&
    !!s.keys &&
    typeof s.keys.p256dh === 'string' &&
    typeof s.keys.auth === 'string'
  )
}

async function sendOne(env: Env, rec: RemindRecord): Promise<boolean> {
  const payload = await buildPushPayload(
    {
      data: JSON.stringify({
        title: rec.title,
        body: rec.body,
        tag: rec.tag,
      }),
      // Apple requires user-visible push
      options: { ttl: 3600, urgency: 'high' },
    },
    rec.subscription as never,
    {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
  )

  const res = await fetch(rec.subscription.endpoint, payload)
  // 404 / 410 = subscription gone
  if (res.status === 404 || res.status === 410) return false
  return res.ok || res.status === 201
}

async function runDue(env: Env, now = Date.now()): Promise<number> {
  const listed = await env.REMIND_KV.list({ prefix: KEY_PREFIX })
  let sent = 0
  for (const key of listed.keys) {
    const raw = await env.REMIND_KV.get(key.name, 'json')
    if (!raw || typeof raw !== 'object') {
      await env.REMIND_KV.delete(key.name)
      continue
    }
    const rec = raw as RemindRecord
    if (typeof rec.fireAtMs !== 'number' || !isSub(rec.subscription)) {
      await env.REMIND_KV.delete(key.name)
      continue
    }
    // Too far in the past → drop
    if (rec.fireAtMs < now - 5 * 60_000) {
      await env.REMIND_KV.delete(key.name)
      continue
    }
    // Due (within 60s before → 5 min after)
    if (rec.fireAtMs > now + 60_000) continue
    try {
      const ok = await sendOne(env, rec)
      if (!ok) {
        // keep for one more cron if transient failure and still near due
        if (rec.fireAtMs < now - 2 * 60_000) {
          await env.REMIND_KV.delete(key.name)
        }
        continue
      }
      sent++
      await env.REMIND_KV.delete(key.name)
    } catch {
      if (rec.fireAtMs < now - 2 * 60_000) {
        await env.REMIND_KV.delete(key.name)
      }
    }
  }
  return sent
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin')
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(
        {
          ok: true,
          worker: 'heat-highlight-tap-remind',
          hasPublic: Boolean(env.VAPID_PUBLIC_KEY),
          hasPrivate: Boolean(env.VAPID_PRIVATE_KEY),
        },
        origin,
      )
    }

    if (request.method === 'GET' && url.pathname === '/vapidPublicKey') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY }, origin)
    }

    if (request.method === 'POST' && url.pathname === '/schedule') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json({ error: 'invalid json' }, origin, 400)
      }
      const b = body as Record<string, unknown>
      if (!isSub(b.subscription) || typeof b.fireAtMs !== 'number') {
        return json({ error: 'subscription + fireAtMs required' }, origin, 400)
      }
      if (b.fireAtMs < Date.now() - 60_000) {
        return json({ error: 'fireAtMs in the past' }, origin, 400)
      }
      const rec: RemindRecord = {
        subscription: b.subscription,
        fireAtMs: b.fireAtMs,
        title:
          typeof b.title === 'string' && b.title.trim()
            ? b.title.trim()
            : 'Highlight Tap · game start',
        body:
          typeof b.body === 'string' && b.body.trim()
            ? b.body.trim()
            : 'Your game is starting',
        tag:
          typeof b.tag === 'string' && b.tag.trim()
            ? b.tag.trim()
            : 'heat-highlight-tap-game-start',
        createdAtMs: Date.now(),
      }
      const key = kvKey(rec.subscription.endpoint)
      // Expire KV a day after fire time
      const ttlSec = Math.max(
        3600,
        Math.ceil((rec.fireAtMs + 86_400_000 - Date.now()) / 1000),
      )
      await env.REMIND_KV.put(key, JSON.stringify(rec), {
        expirationTtl: Math.min(ttlSec, 60 * 60 * 24 * 30),
      })
      return json({ ok: true, fireAtMs: rec.fireAtMs }, origin)
    }

    if (request.method === 'POST' && url.pathname === '/cancel') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json({ error: 'invalid json' }, origin, 400)
      }
      const endpoint = (body as { endpoint?: string }).endpoint
      if (typeof endpoint !== 'string' || !endpoint) {
        return json({ error: 'endpoint required' }, origin, 400)
      }
      await env.REMIND_KV.delete(kvKey(endpoint))
      return json({ ok: true }, origin)
    }

    // Manual tick for testing
    if (request.method === 'POST' && url.pathname === '/tick') {
      const sent = await runDue(env)
      return json({ ok: true, sent }, origin)
    }

    return json({ error: 'not found' }, origin, 404)
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runDue(env).then(() => undefined))
  },
}
