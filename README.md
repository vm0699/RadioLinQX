# RadioLinQ Clone

A recreation of the RadioLinQ teleradiology platform: a **Cornerstone3D** DICOM
viewer (GPU/WebGL volume rendering via vtk.js) plus the **case-management
dashboard** around it — cases, reporting workflow, referring doctors, settings,
notifications.

**→ How to start & test everything: [`docs/RUNNING.md`](docs/RUNNING.md)**
(local mode needs no Docker.)

## What works

### Viewer
| Area | Feature |
|---|---|
| Study access | Series picker with multi-select ("View Selected"), launched from a case |
| 2D viewing | Stack scroll, Zoom, Pan, Window/Level, Rotate, Invert |
| Layouts | 1×1 … 3×3 viewport grid, drag-drop series into viewports |
| Annotations | Length, Angle, Cobb Angle, Rectangle/Ellipse/Freehand ROI, Polygon, Arrow, Probe, Text — with delete/clear |
| MPR / 3D | Orthogonal AXIAL / SAGITTAL / CORONAL from one volume, linked crosshairs |
| Thick slab | 0.5–200 mm slab with projection: None / MIP / MinIP / Average |
| Cine / export | Play clip + speed; PNG frame capture; WebM viewport capture |
| Overlay | Patient/study metadata (from the case), corner readouts (dims, slice thickness, instance/series #, zoom, W/L), A/P/L/R markers |

### Dashboard
| Area | Feature |
|---|---|
| Cases list | All / Reported / Report Pending tabs with live counts; columns: Tags, Patient ID/name, Study, Uploaded, TAT/Elapsed, Assigned, Case Status, Upload, Actions |
| Filters | Patient ID/name, date range, Scan Type, Body Part, Tag, TAT status, Branch, Referring doctor, Radiologist; **saved presets** |
| Add Case | Full form (patient, scan type, body parts, branch, contrast, referring dr, history, remarks) |
| Case drawer | Details + assign radiologist + tags; **report editor** (clinical history / technique / findings / impression) with Save draft → **Sign & finalise** → status flips to Reported |
| Referring Doctors | CRUD table |
| Settings | Scan center, branches, reference data (scan types / body parts / tags), radiologists, TAT/SLA targets — all feed the rest of the app |
| Notifications | Derived feed (new cases, TAT breaches, signed reports) with unread badge |
| Chats | Lightweight local placeholder |

Sample data: one viewer-linked case per real DICOM study in `sample-data/`
(a 384-slice MRI + XA/US/RF demos) plus ~138 synthetic cases over 45 days, from a
**deterministic seed**. The dashboard "database" is JSON files under `data/`
(git-ignored); `scripts/reset-data.sh` wipes it.

## Architecture

```
┌───────────────┐   /api/*  (cases, settings, notifs, ...)   ┌───────────────┐
│  web (React)  │ ─────────────────────────────────────────▶ │  api (NestJS) │
│  Cornerstone3D│   /dicom-web/*  or  /api/local/*           │               │
└───────────────┘                                            └──┬────────┬───┘
                                              DICOMweb (mode A) │        │ read files (mode B)
                                              ┌─────────────────▼──┐  ┌──▼───────────┐
                                              │ Orthanc + Postgres │  │ sample-data/ │
                                              │  (docker compose)  │  │  + data/*.json│
                                              └────────────────────┘  └──────────────┘
```

- **web** — Vite + React + TS + Ant Design + Cornerstone3D. Viewer + dashboard.
- **api** — NestJS. Cases / reports / referring doctors / settings / notifications
  (JSON store under `data/`), plus DICOM access two ways:
  - **mode `orthanc`** — reverse-proxies `/dicom-web/*` to Orthanc, `wadors:` imageIds.
  - **mode `local`** — serves `sample-data/` DICOM files at `/api/local/*`,
    `wadouri:` imageIds. Used automatically when Orthanc is down.
  `GET /api/mode` reports which.
- **orthanc** + **postgres** — open-source PACS (DICOMweb + transcoding), Docker only.

## Quick start

**Local mode (no Docker):** see [`docs/RUNNING.md`](docs/RUNNING.md) — install,
`bash scripts/load-dicom.sh`, start `apps/api` then `apps/web`, open
http://localhost:5173.

**Full stack (Docker):**
```bash
cp .env.example .env
docker compose up -d --build
bash scripts/load-dicom.sh
```
- App → http://localhost:5173
- Orthanc Explorer → http://localhost:8042 (user from `.env`)
- API health → http://localhost:3000/api/health

## Sample data

`bash scripts/load-dicom.sh` fetches public DICOM (a 384-slice T1 MRI + XA/US/RF
demos) into `sample-data/`, and — if Orthanc is up — STOW-RS-uploads it. Drop
your own `.dcm` files in `sample-data/` to use those instead. `sample-data/` and
`data/` are git-ignored — no PHI in the repo. `bash scripts/reset-data.sh`
re-seeds the dashboard.

## Layout

```
apps/web        React viewer
apps/api        NestJS DICOMweb proxy
orthanc/        Orthanc configuration
scripts/        load-dicom.sh and helpers
docs/           notes from the original-app analysis
```
