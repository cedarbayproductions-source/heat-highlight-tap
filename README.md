# Heat Highlight Tap

Phone-first PWA for James Perry: **Goal** · **Sync** · **Shift** · **Export JSON** · **Export XML** (Premiere FCP sequence).

Live: [https://heat-highlight-tap.surge.sh/](https://heat-highlight-tap.surge.sh/)

## Dev

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 43127
npm run build
npm run test:xml   # FCP XML smoke
```

`VITE_BASE=/heat-highlight-tap/` for GitHub Pages.

## Deploy Surge

```bash
npm run build
npx surge ./dist heat-highlight-tap.surge.sh
```

## Export XML (summary)

FCP XML (`xmeml` v4) with **Shifts** and **Goals** sequences of subclips. Sync (prefer Puck drop) = media 00:00. Goals −15s / +5s. Master path placeholder: `MEDIA/Heat_vs_{Opponent}_{date}_TTS{id}.mp4`. Frame rate **29.97**.
