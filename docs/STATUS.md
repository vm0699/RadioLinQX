# Build status — DICOM viewer milestone

_Updated: 2026-08-30_

## Verified working — end to end, against real DICOM

Because Docker Desktop won't start on this machine (see below), verification was
done in **local mode**: the API serves the DICOM files under `sample-data/`
directly and the viewer loads them with `wadouri:` imageIds. Same viewer code
path as Orthanc mode.

Sample data used: a real **384-slice T1 MRI** (datalad/example-dicom-structural)
plus single-file **XA / US / RF** demos.

| Area | Evidence |
|---|---|
| API local mode | `GET /api/mode` → `{"mode":"local"}`; `GET /api/local/studies` → 6 studies with correct patient / modality / series+instance counts |
| Study list page | renders all 6 studies, correct columns |
| Viewer boot | `CornerstoneRender: using GPU rendering`, all 20 tools registered into the ToolGroup |
| **Stack rendering** | real pixel data decodes — overlay shows parsed values: RF study `1024 x 1024`; MRI `274 x 384`, `Slice 0.67 mm`, `Img 1/384`, `Ser 401`, `W 99 L 50` |
| `/api/local/wado/:sop` | returns valid `application/dicom` bytes, `200` |
| **MPR** | MPR button → 3-pane `AXIAL / SAGITTAL / CORONAL` layout; the streaming volume loader fetched **all 384 slices** (`200 OK` each) and assembled the volume, no errors |
| Toolbar | full control set renders: Stack/Zoom/Pan/W-L/Rotate, Measure▾ (11 tools), Delete, Grid (3×3), Localizer, MPR, Cross, Ax/Cor/Sag, slab slider + mm, projection (None/MIP/MinIP/Average), Play + fps, Capture, Export Video |

**Not yet exercised interactively:** dragging MPR crosshairs, thick-slab MIP
visual result, cine playback, each annotation tool, layout grid, capture/video
export. These are wired; they need a hands-on pass (best in a real browser — the
in-app preview pane can't screenshot while hidden and reloads under the volume
load).

## Both backends

`vite.config.ts` / `apps/api` support two DICOM sources, chosen at runtime via
`GET /api/mode`:

| mode | when | study/series source | imageIds |
|---|---|---|---|
| `orthanc` | Orthanc reachable | `/api/studies` (QIDO proxy) | `wadors:` |
| `local` | Orthanc down, `sample-data/` has files | `/api/local/studies` (parsed with dicom-parser) | `wadouri:` |
| `none` | neither | — | — |

Key fix: `dicomImageLoaderInit({ useLegacyMetadataProvider: true })` — the
Cornerstone v5 "naturalized metadata" `wadouri` path can't pull pixels from
uncompressed local files; the legacy path (parse P10 → read pixel data) works.

## Docker Desktop

Still broken on this machine. Tried: stopping wedged processes, `wsl --shutdown`,
clearing `%LOCALAPPDATA%\Docker\run`, setting `"EnableDockerAI": false` in
`%APPDATA%\Docker\settings-store.json` (backup at `settings-store.json.bak`),
relaunch. The crash dialog is gone but the Linux engine never becomes ready
(`docker info` hangs). Needs a factory reset / reinstall / `wsl --update` + reboot
— destructive or your call, so not done.

Once `docker info` works:
```bash
cd C:/SAVRO/RadioLinQ && cp .env.example .env
docker compose up -d --build
./scripts/load-dicom.sh          # uploads sample-data/ into Orthanc
```
`GET /api/mode` then flips to `orthanc` automatically; the viewer switches to
`wadors:` with no code change.

## Run it now (local mode, no Docker)

```bash
# API
cd apps/api && npm install && npm run build
SAMPLE_DIR="C:/SAVRO/RadioLinQ/sample-data" PORT=3000 node dist/main.js
# web
cd apps/web && npm install && npm run dev      # http://localhost:5173
```
`sample-data/` already has the MRI + demo studies (git-ignored). Open the app,
click a study's **View series**, tick the series, **View Selected**, then **MPR**.

## Next

- Interactive pass on every viewer tool (real browser).
- Then up the stack: auth, cases list + filters + presets, Add Case, report
  editor, referring doctors, chat, notifications, TAT/SLA, upload pipeline
  (per `docs/original-app-analysis.md`).
