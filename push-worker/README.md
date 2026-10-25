# heat-highlight-tap-remind

Free Cloudflare Worker for Highlight Tap **game-start Web Push**.

- Own worker + KV only — **not** nextshift-test / ShowRunner
- Cron every minute; sends due reminders via VAPID
- Endpoints: `GET /health`, `GET /vapidPublicKey`, `POST /schedule`, `POST /cancel`, `POST /tick`

## Deploy

```bash
cd push-worker
npm install
# first time only:
# npx wrangler kv namespace create HEAT_TAP_REMIND
# paste id into wrangler.toml → REMIND_KV
printf '%s' '<vapid-private>' | npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler deploy
```

Public URL: `https://heat-highlight-tap-remind.showrunner-review.workers.dev`
