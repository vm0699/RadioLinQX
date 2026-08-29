# Build status — DICOM viewer milestone

_Updated: 2026-08-30_

## Done

| Component | State |
|---|---|
| Monorepo scaffold (`apps/web`, `apps/api`, `orthanc/`, `scripts/`, compose) | ✅ |
| **web** — Vite + React + TS + Ant Design + **Cornerstone3D v5.8** | ✅ builds, typechecks, runs (`npm run dev`) |
| **api** — NestJS DICOMweb reverse-proxy + `/api/studies` (flattened QIDO) | ✅ builds, runs, graceful when Orthanc down |
| Study list page (table, search, series dialog with multi-select "View Selected") | ✅ renders |
| Viewer shell (topbar: brand / Refresh / Clinical history; loader; error state) | ✅ renders |
| Cornerstone bootstrap — core init, DICOM image loader + web workers, tools, streaming volume loader | ✅ `CornerstoneRender: using GPU rendering` |
| Tool registry — all 20 tools registered; ToolGroup wiring | ✅ (fixed dev-mode module-instance / ordering issue) |
| Toolbar — Cases / Stack / Zoom / Pan / W-L / Rotate / Measure▾ (11 tools) / Delete / Grid (3×3) / Localizer / MPR / Cross / Ax-Cor-Sag / slab slider + mm / projection (None/MIP/MinIP/Avg) / Play + fps / Capture / Export Video | ✅ built |
| ViewerGrid — stack grid reconciliation, MPR enter/exit, slab/projection, invert, drag-drop series | ✅ built |
| Overlay — patient block, corner readouts (dims, slice, instance#, series#, zoom, W/L), A/P/L/R markers | ✅ built |
| Docker Compose (postgres + orthanc + api + web) | ✅ written, **not yet run** |
| `scripts/load-dicom.sh` — STOW-RS upload of `sample-data/` (public fallback) | ✅ written, not yet run |

## Blocked / not yet verified

1. **Docker Desktop on this machine is crashing on start** ("Inference manager … remove `dockerInference`: file cannot be accessed"). Until it starts, Orthanc/Postgres can't come up, so:
   - no real study list
   - image pixels / MPR / thick-slab **not yet exercised against real DICOM**
2. The viewer has been smoke-tested only with a fake study id (shell + cornerstone init verified; pixel path not).

### Fixing Docker Desktop

Try, in order:
```powershell
# 1. fully quit Docker Desktop (tray → Quit), then:
wsl --shutdown
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Docker\run"
# 2. relaunch Docker Desktop
```
If it still crashes: Docker Desktop → (if it opens) Settings → **Features in development** → turn **off** "Docker Model Runner" / "Docker AI"; or Settings → **Troubleshoot → Reset to factory defaults**.

Once `docker info` works:
```bash
cd C:/SAVRO/RadioLinQ
cp .env.example .env
docker compose up -d --build
./scripts/load-dicom.sh          # add a CT/MR series to sample-data/ first for MPR
# open http://localhost:5173
```

## Local dev without the web container

```bash
docker compose up -d postgres orthanc      # once Docker is healthy
cd apps/api && npm install && npm run build && PORT=3000 node dist/main.js
cd apps/web && npm install && npm run dev   # http://localhost:5173
```

## Known dev-mode notes

- Cornerstone3D v5 is split into many `@cornerstonejs/*` packages that share
  singleton state. `vite.config.ts` pins `optimizeDeps` (exclude
  `dicom-image-loader` for its worker; pre-bundle core/tools + the 4 wasm codec
  subpaths) and `resolve.dedupe`. Production `vite build` (Rollup) is
  unaffected.
- Harmless console warnings remain: "For crosshairs to operate, at least two
  viewports…" (only relevant in MPR) and a React Router v7 future-flag notice.

## Next after images render

- Verify: stack scroll, W/L, zoom/pan, each annotation tool, grid layouts,
  MPR 3-plane + linked crosshairs, thick-slab MIP, cine, capture/video.
- Then move up the stack: auth, cases list + filters + presets, Add Case,
  reporting editor, referring doctors, chat, notifications, TAT/SLA, upload
  pipeline (per `docs/original-app-analysis.md`).
