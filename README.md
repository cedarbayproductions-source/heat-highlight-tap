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

v2 envelope: raw `taps` plus a `mediaPlan` (In/Out ms, Sync offset, warnings, optional LiveBarn `slipMs` / `landmark`). Agents should cut from `mediaPlan.shifts` / `mediaPlan.goals` — do **not** re-derive Sync=0 and clamp negative times (that shortened pre-Sync shifts).

Legacy: a bare taps array still loads via `parseExportTaps` / `npm run media-plan -- export.json`.

## LiveBarn slip (per game)

Sync still means “relative media 0.” After Sync, set one **landmark** (e.g. Shift 01 On appears at LiveBarn `25:41`) or enter slip seconds (+/−). The app stores slip with the game in localStorage and writes `mediaPlan.slipMs` + `mediaPlan.landmark` on export.

`slipMs = landmarkMediaMs − (wallMs − syncWallMs)` when Sync is media 0 (re-anchor uses Sync-relative media instead). All shift/goal In/Out include slip; **±3s shift pads (and goal pads) still apply after slip**.

## Export XML (summary)

FCP XML (`xmeml` v4) with **Shifts** and **Goals** sequences of subclips. Same media math as JSON.

- Default: Sync (prefer Puck drop) = media 00:00 (relative mapping).
- Optional LiveBarn slip shifts every In/Out to match the master file.
- Pre-Sync ice: origin re-anchors to earliest padded cut so shift duration is preserved; Sync sits at a positive media timecode (XML comment + export alert say so). Master must include film before Sync.
- Pads: shifts −3s / +3s; goals −15s / +5s (applied before slip).
- Master path placeholder: `MEDIA/Heat_vs_{Opponent}_{date}_TTS{id}.mp4`. Frame rate **29.97**.
