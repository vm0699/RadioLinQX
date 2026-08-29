# RadioLinQ Clone — DICOM Viewer

A recreation of the RadioLinQ teleradiology **image viewer**, built on the same
technology the original uses: **Cornerstone3D** (GPU/WebGL volume rendering via
vtk.js) with a **DICOMweb** backend.

> Scope of this milestone: **viewer only**, end to end. Case management,
> reporting, chat, notifications, referring doctors, TAT/SLA and the upload
> pipeline come later and have placeholders in the architecture.

## What works

| Area | Feature |
|---|---|
| Study access | Study list (QIDO-RS), series picker dialog with multi-select ("View Selected") |
| 2D viewing | Stack scroll, Zoom, Pan, Window/Level (+ presets), Rotate/Flip, Invert |
| Layouts | 1×1 … 3×3 viewport grid (hanging protocol), drag-drop series into viewports |
| Annotations | Length, Angle, Cobb Angle, Rectangle ROI, Ellipse ROI, Freehand ROI, Polygon, Open Polygon, Arrow, Probe, Text — with delete/clear |
| MPR / 3D | Orthogonal AXIAL / SAGITTAL / CORONAL reconstruction from one volume, linked crosshairs, per-plane scroll |
| Thick slab | Slab thickness 0.5–200 mm with projection mode: None / MIP / MinIP / Average; slab bounds drawn as reference lines |
| Reference | Localizer / reference lines across series |
| Cine | Play/stop clip with speed control |
| Export | Frame capture (PNG) and viewport video capture (WebM) |
| Overlay | Patient/study metadata, corner annotations (dimensions, slice thickness, instance/series #, zoom, W/L), orientation markers (A/P/L/R), laterality |

## Architecture

```
┌──────────────┐      /dicom-web (QIDO/WADO-RS)      ┌───────────────┐
│  web (React) │ ─────────────────────────────────▶ │  api (NestJS) │
│  Cornerstone3D│                                    │  thin proxy   │
└──────────────┘                                     └───────┬───────┘
                                                             │ DICOMweb
                                                     ┌───────▼───────┐
                                                     │    Orthanc    │  ← C-STORE / drag-drop uploads
                                                     │  + DICOMweb   │
                                                     │  + Postgres   │
                                                     └───────────────┘
```

- **web** — Vite + React + TypeScript + Ant Design + Cornerstone3D. The viewer.
- **api** — NestJS. Today: reverse-proxies `/dicom-web/*` to Orthanc (CORS, auth
  seam, request logging) and exposes `/api/studies`. Tomorrow: cases, reports, auth.
- **orthanc** — open-source PACS. Stores DICOM, speaks DICOMweb (WADO-RS / QIDO-RS
  / STOW-RS), transcodes compressed transfer syntaxes. Backed by Postgres.
- **postgres** — Orthanc index now; app database later.

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
```

Then load some studies (see **Sample data** below) and open:

- Viewer app → http://localhost:5173
- Orthanc Explorer → http://localhost:8042  (user `radiolinq` / pass from `.env`)
- API health → http://localhost:3000/api/health

## Sample data

Drop DICOM files or folders into `sample-data/` and run:

```bash
./scripts/load-dicom.sh
```

The script recursively STOW-RS-uploads everything under `sample-data/` into
Orthanc. Any modality works; for MPR / thick-slab you need a volumetric series
(multi-slice CT or MR). If `sample-data/` is empty the script fetches a small
public CT series so the viewer has something to show.

`sample-data/` is git-ignored — no PHI in the repo.

## Local development (without Docker for the frontend)

```bash
# infra only
docker compose up -d orthanc postgres api

cd apps/web && npm install && npm run dev
```

Vite proxies `/dicom-web` and `/api` to the API container.

## Layout

```
apps/web        React viewer
apps/api        NestJS DICOMweb proxy
orthanc/        Orthanc configuration
scripts/        load-dicom.sh and helpers
docs/           notes from the original-app analysis
```
