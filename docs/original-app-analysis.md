# RadioLinQ (appv2.radiolinq.com) — analysis notes

From a walkthrough of the production app on 2026-08-30 with a scan-centre login
("Sunray Scans XRAY"). This is the reference for the clone.

## Tech stack (observed)

| Layer | Evidence | Conclusion |
|---|---|---|
| Frontend | `static/js/main.*.chunk.js`, `3.*.chunk.js` | React, Create-React-App / webpack-4 |
| Viewer engine | console `CornerstoneRender: using GPU rendering`, `dicomParser` errors | **Cornerstone3D** (GPU/WebGL, vtk.js) |
| Pixel transport | console `Start to read j2k main header`, `Main header … decoded` | DICOM served **JPEG2000-compressed**, decoded in-browser; server also exposes an `/uncompressed/` variant |
| Loading | `prefetch done` logs | whole series prefetched/streamed |

Viewer route:
```
/cases/:caseId?seriesId=:caseId/uncompressed/:studyInstanceUID/:seriesInstanceUID
             &viewerListPath=/&viewerListSearch=fromDate=…&toDate=…&page=1&perPage=4
```
The viewer round-trips the case-list filter state in the URL.

## Navigation / IA

`Cases` · `Referring Doctors` · `Settings` · `Chats` (unread badge) ·
`Notifications` (badge) · account menu (only **Hard refresh**, **Logout** — no
profile/org switch on this login). Single-tenant login lands directly on Cases.

## Cases list

- Tabs: **All / Reported / Report Pending** with live counts.
- Filter bar: Patient ID, Patient Name, **date range** (required, defaults to
  today, appears to cap the span), Scan Type, Body Part, Tag, TAT status,
  "Interesting Keys".
- **Saved filter presets**: Default / Custom, Save, Manage; auto-named (a "ct"
  preset appeared after filtering by CT).
- Row/card fields: Tags, Patient ID, Patient name, Study (`<modality> - <desc>`),
  Uploaded date, TAT / Time Elapsed, Assigned Doctor, Due Time, Case Status
  (Reported / Report Pending), Upload Status, Scan Center, Referring Doctor.
- Row actions: **View series**, ⋮ menu.
- ~1050 cases in a month for this centre (472 reported / 578 pending), mostly DX.

## Add Case form

Patient ID · Patient name · Patient Mobile · **Scan Type** (CT, DEXA,
Cisternography, MR, CR, US, RF, MG, OT, ES, PT, ST, XA, DX, IO, DOC) · **Body
parts** (multi) · Scan Center Branch · Age · Gender · Study Description ·
**Contrast** (Yes/No) · Referring Doctor + mobile · Patient History · Remarks.

## Series dialog ("View series")

Lists series as rows: thumbnail + description + image count, each with a
checkbox; **"View Selected (N)"** opens the chosen series together in the viewer.

## Viewer

- Top bar: logo · **Refresh viewer** · **Clinical history** (referring doctor's
  note for the case; "No clinical history" when empty).
- Left rail: series thumbnails (description + image count).
- Overlay: patient/study metadata top-left (collapsible ‹ ); corner annotations
  (dimensions, slice thickness, instance #, series #, zoom scale, pan offset,
  WC/WW); orientation markers A/P/L/R; laterality marker.
- Mouse-binding badges: **L** = stack scroll, **R** = window/level; wheel = stack.

### Toolbar (horizontally scrollable), left → right

`Cases | Stack | Zoom | Pan | W/L | Rotate | Measure ▾ | Delete | Grid |
Localizer | MPR | Cross | Ax Cor Sag | slab-thickness slider (0.5–200 mm) + mm
input | projection ▾ (No MIP / MIP / MinIP / Average) | Play + speed |
Export Video`  (also a **Capture** still-frame)

- **Measure ▾**: Length, Angle, **Cobb Angle**, Rectangle, Ellipse, Freehand,
  Polygon, Open Polygon, Arrow, Probe, Text.
- **Grid**: 3×3 hover-grid → viewport layout / hanging protocol; disabled during MPR.
- **Localizer / Cross**: disabled for single-frame X-ray; active for volumes.

### MPR / 3D (the priority feature)

- **MPR** on a volumetric series → 3-pane orthogonal layout **AXIAL | SAGITTAL |
  CORONAL** from one reconstructed volume.
- **Linked crosshairs**, colour-coded per axis (green / yellow / red); drag in
  any pane → the other two reslice in real time. **Cross** toggles the tool.
- **Ax / Cor / Sag** buttons set / emphasise a plane.
- **Thick slab**: slider 0.5–200 mm + mm box, combined with projection mode
  (None / MIP / MinIP / Average). Verified: hand CT at 73.5 mm + MIP on the
  coronal pane renders all hand bones into one X-ray-like projection; slab
  extent drawn as dashed reference lines in the perpendicular panes.
- **Exit MPR** button; Grid layout locked while in MPR.
- It is MPR + thick-slab MIP, **not** cinematic volume rendering — no separate
  3D/VR button in the toolbar.
- **Export Video** captures cine/scroll/rotation; **Capture** = still snapshot.

## Workflow / pipeline (inferred)

1. Case created — manually (Add Case) or auto from DICOM ingest.
2. Images uploaded → server stores + builds compressed (J2K) + uncompressed
   variants → *Upload Status*.
3. Case shows **Report Pending**; **TAT clock** starts; radiologist assigned.
4. Radiologist opens study → Cornerstone3D viewer → review (stack / MPR /
   thick-slab / measure / annotate).
5. Report authored → status → **Reported** (report editor not inspected).
6. Chat for referrer↔radiologist queries; Notifications on status changes.

## Not inspected

Report editor, row ⋮ menu, Referring Doctors page, full Settings, Chat panel.
(Session dropped on a deep-link navigation.)
