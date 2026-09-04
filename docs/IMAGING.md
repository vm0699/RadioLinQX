# Imaging pipeline — upload, format, 3D rendering, and scaling

## 1. There is no separate "3D file". A study *is* the 3D data.

A scanner (CT, MR, PET…) writes one **DICOM file per slice** (`.dcm`, "DICOM
Part-10"). A series is an ordered stack of those slices; each slice carries its
own `ImagePositionPatient` / `ImageOrientationPatient` / `PixelSpacing` /
`SliceThickness`. Put the stack together and you have a **volume** — that volume
is what MPR, thick-slab MIP and VRT (3D) are computed from, on the fly.

So "upload the scan in 3D" = **upload the whole series folder of `.dcm` files**.
Nothing is pre-rendered; the viewer reconstructs 2D reformats and the 3D volume
from the slices each time.

(2D modalities — DX/CR X-ray, US, XA angio — are a single image or a frame
loop, not a volume, so MPR/VRT are disabled for them. Same as the real app.)

## 2. How a hospital / centre gets images in

Three paths, in order of how real sites do it:

| Path | How | In this clone |
|---|---|---|
| **A — DICOM node (C-STORE)** | The modality or the site PACS is configured with the platform's AE title + host + port and "sends" the study over the DICOM protocol. Zero human steps. | Needs **Orthanc** (`docker compose up orthanc`); the modality does C-STORE to port 4242. Orthanc then exposes it over DICOMweb and `/api/mode` returns `orthanc`. |
| **B — Web upload** | A tech opens the case portal and drag-drops the study folder. | **Built.** Cases → **Upload study** → drop the `.dcm` folder. `POST /api/upload` (multipart) → the API parses each file with `dicom-parser`, groups by `StudyInstanceUID`, writes them under `sample-data/uploads/<study>/`, and creates a linked case. The viewer then works exactly as with seed data. |
| **C — Desktop uploader / gateway** | A small agent watches a folder or the local PACS and pushes studies up (STOW-RS) — used where the modality can't reach the internet directly. | Not built here; it's the same `POST /api/upload` / STOW-RS endpoint driven by a script. `scripts/load-dicom.sh` is a minimal version. |

For the hosted demo we run **path B** (no Orthanc). On Render free the uploaded
files sit on ephemeral disk and are lost on redeploy — for production they'd go
to object storage (S3 / Cloudflare R2) or into Orthanc with a real volume.

## 3. How the 3D is rendered right now

**100% client-side, in the browser, on the viewer's GPU.**

- **`@cornerstonejs/core` + `@cornerstonejs/tools`** (Cornerstone3D v5) with
  **vtk.js** underneath.
- The **streaming volume loader** fetches every slice of the series
  (`/api/local/wado/<sop>` or WADO-RS), the **web-worker pool** decodes them
  (JPEG/JPEG2000/JPEG-LS via WASM codecs), and the pixels are packed into a
  single 3D texture.
- **MPR** = three `ORTHOGRAPHIC` viewports sampling that texture on arbitrary
  planes (axial/sagittal/coronal), with linked crosshairs.
- **Thick-slab MIP/MinIP/Average** = the same, with a slab thickness + a
  max/min/avg blend mode along the view ray.
- **VRT** = a `VOLUME_3D` viewport doing ray-marched volume rendering with a
  transfer function (`setProperties({ preset: 'CT-Bone' | 'MR-Default' | … })`).

Nothing renders on the server. The server only stores bytes and streams slices.

### What this costs

- Bandwidth: the browser downloads the **whole series** to build the volume — a
  thin-slice CT is 200–500 MB. Fine on a LAN / good connection, heavy on mobile.
- Client GPU/RAM: a 512³ volume is ~256 MB of texture. Old laptops struggle
  past ~1 GB of volume.
- First-view latency = download + decode time.

## 4. Cloud / server-side rendering — for scale

Client-side is right for a radiologist on a workstation. It does **not** scale to
"share a 3D link with a referrer on a phone" or "100 concurrent light viewers".
Options, cheapest-effort first:

| Approach | What it is | Trade-off |
|---|---|---|
| **DICOMweb + progressive / HTJ2K** | Keep client rendering, but serve **HTJ2K** (High-Throughput JPEG2000) and progressive `retrieveStages` so a usable image appears from ~10–20% of the bytes. Orthanc and the cloud PACS below support it. | Small change (transfer syntax + loader config). Biggest bang for buck. Still needs a capable client for VRT. |
| **Managed cloud PACS** — Google Cloud Healthcare API, AWS HealthImaging, Microsoft DICOM service | Hosted DICOMweb store + de-id + IHE. You point the same Cornerstone loaders at their WADO-RS URL. | Removes all storage/scaling ops. Costs per GB + per request. Still client-side pixels. |
| **Server-side 2D render (WADO-RS `rendered`)** | Ask the PACS for a **pre-rendered PNG/JPEG** of a frame (`.../frames/1/rendered?window=…`). Great for thumbnails, previews, a lightweight "referrer view". | No interactivity beyond what you re-request. No true 3D. |
| **Server-side 3D (headless GPU) → pixel streaming** | A GPU service (VTK / Cornerstone3D-node / **NVIDIA Clara / MONAI Deploy / Cinematic**, or Kitware **Trame** + vtk.js server) renders MPR/VRT on the server and streams frames (WebRTC / WebSocket) or a video. Client is a thin canvas. | The real "cloud rendering" answer. Needs GPU instances (T4/L4), an autoscaler, and a session broker. Highest cost + ops, but any device gets full 3D and the volume never leaves the server. |
| **Pre-baked assets** | Nightly job renders VRT turntables / key MIPs to short MP4s or glTF and caches them on a CDN. | Zero live cost, zero interactivity. Good for tumour-board decks and patient hand-outs. |

### Recommended path for this project

1. **Now / near-term:** turn on **HTJ2K + progressive retrieve** and move
   storage to Orthanc or a managed cloud PACS. Keep rendering client-side for
   the radiologist. This is a config-level change to the loader + a transfer
   syntax on ingest.
2. **When light/mobile viewers or big volumes matter:** add a **headless GPU
   render service** (Trame/vtk.js or Cornerstone3D-node on a T4/L4) behind a
   session broker, and a `mode: 'remote'` in the viewer that swaps the local
   `RenderingEngine` for a pixel-stream canvas. The toolbar and case flow stay
   identical.
3. **Always:** pre-bake VRT turntable MP4s for reports / sharing.
