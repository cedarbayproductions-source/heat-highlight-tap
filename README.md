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

## Export JSON (agent cuts)

v2 envelope: raw `taps` plus a `mediaPlan` (In/Out ms, Sync offset, warnings). Agents should cut from `mediaPlan.shifts` / `mediaPlan.goals` — do **not** re-derive Sync=0 and clamp negative times (that shortened pre-Sync shifts).

Legacy: a bare taps array still loads via `parseExportTaps` / `npm run media-plan -- export.json`.

## Export XML (summary)

FCP XML (`xmeml` v4) with **Shifts** and **Goals** sequences of subclips. Same media math as JSON.

- Default: Sync (prefer Puck drop) = media 00:00.
- Pre-Sync ice: origin re-anchors to earliest padded cut so shift duration is preserved; Sync sits at a positive media timecode (XML comment + export alert say so). Master must include film before Sync.
- Pads: shifts −3s / +3s; goals −15s / +5s.
- Master path placeholder: `MEDIA/Heat_vs_{Opponent}_{date}_TTS{id}.mp4`. Frame rate **29.97**.
