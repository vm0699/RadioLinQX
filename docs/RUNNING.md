# Running & testing the RadioLinQ clone

Two ways to run. **Local mode needs no Docker** and is the fastest way to see
everything working today.

---

## A. Local mode (no Docker) — recommended right now

### 1. One-time: get sample DICOM data

```bash
cd C:/SAVRO/RadioLinQ
cp .env.example .env            # if you haven't already
bash scripts/load-dicom.sh      # downloads a 384-slice MRI + XA/US/RF demos into sample-data/
```

`sample-data/` is git-ignored. If you have your own `.dcm` files, drop them in
there instead (any folder depth) and skip the download.

### 2. Start the API

```bash
cd apps/api
npm install
npm run build
# Windows PowerShell:
$env:SAMPLE_DIR="C:/SAVRO/RadioLinQ/sample-data"; $env:DATA_DIR="C:/SAVRO/RadioLinQ/data"; $env:PORT="3000"; node dist/main.js
# Git Bash:
SAMPLE_DIR="C:/SAVRO/RadioLinQ/sample-data" DATA_DIR="C:/SAVRO/RadioLinQ/data" PORT=3000 node dist/main.js
```

You should see `API listening on :3000`. Check:

```bash
curl http://localhost:3000/api/mode            # -> {"mode":"local"}
curl http://localhost:3000/api/cases/stats     # -> {"all":144,"reported":76,"pending":68}
```

### 3. Start the web app

```bash
cd apps/web
npm install
npm run dev
```

Open **http://localhost:5173**.

> First load compiles the Cornerstone bundle — give it a few seconds. The Vite
> dev server proxies `/api` and `/dicom-web` to `:3000`.

---

## B. Full stack with Docker (Orthanc PACS)

Only once Docker Desktop's engine starts (`docker info` works — see
`docs/STATUS.md` for the repair steps).

```bash
cd C:/SAVRO/RadioLinQ
cp .env.example .env
docker compose up -d --build
bash scripts/load-dicom.sh      # now also STOW-RS-uploads sample-data/ into Orthanc
```

- App: http://localhost:5173
- Orthanc Explorer: http://localhost:8042  (user/pass from `.env`)
- API health: http://localhost:3000/api/health

`GET /api/mode` flips to `orthanc` automatically; the viewer switches from
`wadouri:` to `wadors:` image loading with no code change.

---

## What to click through

### Cases dashboard (`/`)
- **Tabs** All / Reported / Report Pending — counts update as you filter and as
  reports are signed.
- **Filter bar**: Patient ID, Patient Name, date range, Scan Type, Body Part,
  Tag, **More filters** (TAT status, Branch, Referring doctor, Radiologist).
- **Presets**: set some filters → **Save** (names it) → pick it later from the
  Preset dropdown.
- **+ Add Case** → fill the form → it lands as a new UNREAD case (no images).
- Row **⋮** → Open case / Assign radiologist / Open report editor / Delete.

### Case drawer (click a patient name)
- **Details** tab: full metadata, **Assign radiologist** dropdown, **Tags**.
- **Report** tab: Clinical history / Technique / Findings / Impression →
  **Save draft** (status → Draft) or **Sign & finalise** (status → Reported,
  moves to the Reported tab, notification fires). **Reopen for editing** undoes it.
- **Open viewer** (top-right) — only for cases that have images.

### Viewer (opened from a case)
- The real DICOM cases are: **Jane_Doe** (384-slice MRI — use this for MPR),
  plus Rubo DEMO **XA / US / RF** studies.
- Row **View series** → tick series → **View Selected** → viewer.
- Toolbar: Stack / Zoom / Pan / W-L / Rotate / Measure▾ (11 tools) / Delete /
  Grid (3×3) / Localizer / **MPR** / **Cross** / Ax-Cor-Sag / slab slider +
  projection (None/MIP/MinIP/Average) / Play + fps / Capture / Export Video.
- On the MRI: click **MPR** → 3-plane AXIAL/SAGITTAL/CORONAL; drag the
  crosshairs; set projection to **MIP** and raise the slab slider for a
  thick-slab MIP.
- **Cases** button (far left of the toolbar) returns to the dashboard.

### Referring Doctors (`/referring-doctors`)
- Table of 12 seeded doctors; **+ Add Doctor**, Edit, Delete (persisted).

### Settings (`/settings`)
- **Scan Center** · **Branches** · **Reference data** (scan types / body parts /
  tags — feed the Add Case + filter dropdowns) · **Radiologists** (toggle
  active) · **TAT / SLA** (turnaround hours per scan type — drives the TAT
  colours and due times). Changes persist and are picked up on the next case
  list load.

### Notifications (bell, top-right)
- Derived from case state: new cases in queue, TAT breaches, signed reports.
- Click one to jump to its case; **Mark all read** clears the badge.

### Chats (`/chats`)
- Lightweight local placeholder for the referrer↔radiologist thread.

---

## Reset the sample data

The dashboard "database" is JSON files under `data/` (git-ignored). To start
over with a clean deterministic seed:

```bash
bash scripts/reset-data.sh      # or just: rm -rf data
# then restart the API
```

The seed is deterministic — you always get the same 144 cases (6 real,
viewer-linked + ~138 synthetic spread over 45 days).

---

## Ports

| Service | Port |
|---|---|
| web (Vite dev) | 5173 |
| api (NestJS) | 3000 |
| Orthanc (Docker only) | 8042 (HTTP), 4242 (DICOM) |
| Postgres (Docker only) | internal |
