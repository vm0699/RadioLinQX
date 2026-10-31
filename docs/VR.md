# VR / 3D — immersive viewing of scans

Open any multi-slice CT / MR / PET series as a **360° 3D volume** on the desktop, or step *inside it* with a VR headset.
No plugin, no app install — it's WebXR in the browser.

```
Case drawer ▸ "Open in VR / 3D"      Viewer toolbar ▸ "VR"
                    └──────────────┬───────────────┘
                              /vr?case=…&study=…&series=…
```

## What it does

| | Desktop preview | Headset (VR) |
|---|---|---|
| 3D volume rendering (GPU ray-marching, lighting, MIP) | ✔ orbit / zoom / pan | ✔ walk around it, 360° |
| Iso-surface mesh (bone / skin) | ✔ | ✔ (lighter on standalone headsets) |
| MPR slice plane (axial / coronal / sagittal) | ✔ | ✔ |
| Clip plane (cut the scan open) | ✔ | ✔ |
| Presets · window / level · density · quality | ✔ sliders | ✔ tablet on your wrist + thumbsticks |
| **Segmentation — hide organs** ([details](SEGMENTATION.md)) | ✔ click / brush | ✔ point + trigger, tablet **Segment** tab |
| HU / signal probe | ✔ hover | ✔ point the ray |
| 3D ruler in millimetres | ✔ 2 clicks | ✔ 2 trigger pulls |
| Grab, move, scale, rotate the scan | – | ✔ grip / two grips / hand pinch |
| Export GLB · USDZ · STL · NIfTI | ✔ | – (do it on desktop) |

A **"● VR headset ready"** chip appears in the top bar (and a dot on the viewer's **VR** button) the moment a headset is
connected (`navigator.xr` + `devicechange`).

## Studies with several series

A case can hold many series (e.g. the demo renal MRI: pre-contrast, two post-contrast and a delayed
coronal 3D phase, two axial T1 and a T2). Every place that shows 3D knows about them:

- **Viewer → VRT** — the left rail switches the rendered series (the viewing angle is kept). **Shift/Ctrl-click**
  adds series to a side-by-side compare (up to 4); **Compare** in the toolbar picks the first four volumes.
  With **Link** on, rotating one view rotates all of them (each keeps its own zoom). **View** snaps to
  Anterior / Posterior / Left / Right / Superior / Inferior / *Scan plane*; **Spin** is a turntable.
- **VR / 3D page** — a *Series* list at the top of the side panel; picking one reloads the scene at the same
  orbit angle. The case's preferred series (see `case.json` below) opens first.
- **Cases → View series** — every series has its own *3D / VR* button.

Segmentations are stored per case and mapped by patient coordinates, so a label map made on one phase is
resampled onto the other series of the same patient.

Demo data: `sample-data/tcga-renal-mr-multiseries/` (public TCIA/TCGA MRI, 7 series, ~53 MB). A `case.json`
next to a sample study overrides the seeded case's description, history, tags and `seriesOrder`.

## Using a headset

### Meta Quest (2 / 3 / Pro) — standalone
1. On the desktop page click **Send to headset** (copies the link) and open it in **Meta Quest Browser**,
   or just browse to the app on the Quest and open the case there.
2. Wait for the volume to load → **Enter VR**.
3. *(Quest 3 / Pro)* **Enter AR** puts the scan in your room (passthrough).

### PC-VR (Rift / Index / Reverb / Quest Link) · Vision Pro
Chrome / Edge (with SteamVR / Oculus) or Safari on visionOS → same page, **Enter VR**.
WebXR needs **HTTPS** — the Vercel deployment already is; for local dev see below.

### Controls

| Input | Action |
|---|---|
| **Grip** (either hand) | grab & move the scan |
| **Both grips** | scale (pull apart) + rotate |
| **Trigger** (right) | click the tablet · place ruler points |
| **Right stick** | ← → window width · ↑ ↓ level |
| **Left stick** | ↑ ↓ clip / slice plane position · ← → density |
| **A** | show / hide tablet · **B** reset view |
| **X** | ruler on/off · **Y** next preset |
| **Hands** (hand-tracking) | pinch = grab, or click on the tablet |

The tablet has two tabs — **View** and **Segment** (auto-segment, Hide / Grow / Carve tools, per-group visibility, save to case). It rides on the left controller (use **Pin panel** to park it in the room, **Swap hands** for lefties).

> Standalone headsets have a mobile GPU: it starts on **Quality: low**. If it feels heavy switch to **Surface** mode
> (a polygon mesh renders far faster than ray-marching) or keep Quality low.

## Converting scans (the "decompile" step)

DICOM slices can't be dropped into a VR app directly. The page converts them in the browser — nothing is uploaded anywhere:

```
DICOM series
  → Cornerstone loader (any transfer syntax, sorted by position, HU rescale)
  → box-filter resample (≤256 / axis)  →  float16 3D texture  →  ray-marched volume
  → marching-cubes iso-surface (smooth gradient normals, ≤160 / axis)  →  mesh
```

| Export | For | Notes |
|---|---|---|
| **GLB** | Quest / Blender / any WebXR or glTF viewer | metres, Y-up, patient anterior = +Z |
| **USDZ** | Apple Vision Pro / iPhone AR Quick Look | |
| **STL** | 3D printing, CAD | millimetres, patient (LPS) orientation |
| **NIfTI** (.nii) | 3D Slicer, ITK-SNAP, FSL, nibabel | **full resolution**, int16 when lossless, RAS affine from the DICOM geometry |

Meshes use the current **Surface level** (HU for CT) and preset colour.

## Develop / test without a headset

```bash
npm run dev            # apps/web  (+ API on :3000)
```

* **Desktop preview**: just open `/vr?case=…&study=…&series=…`.
* **Software headset** (Meta's IWER Quest 3 emulator, dev-only): append `&emulateXR=1`.
  The chip turns green, *Enter VR* works, and you can drive the controllers from the console:
  ```js
  const d = window.__xrDevice;            // IWER XRDevice
  d.controllers.right.position.set(0.1, 1.3, -0.6);
  d.controllers.right.updateButtonValue('squeeze', 1);   // grab
  d.controllers.left.updateAxes('thumbstick', 0, 1);     // clip plane
  window.__vr                              // the VRScene (state, info, setState, pick…)
  ```
* **Real headset on your LAN**: WebXR needs a secure context. Easiest: USB-C + `adb reverse tcp:5173 tcp:5173`
  and `adb reverse tcp:3000 tcp:3000`, then browse to `http://localhost:5173` *on the Quest* (localhost counts as secure).
  Or just use the deployed HTTPS site.

## Code map (`apps/web/src/vr`)

| File | Role |
|---|---|
| `volumeData.ts` | load series → full volume → resample → half-float texture; mm→model matrix; CPU sampling |
| `volumeShader.ts` | GLSL ray-marcher (per-eye, physical step, lighting, MIP, clip, MPR plane) |
| `transferFunction.ts` | presets (HU-anchored for CT) + LUT |
| `marchingCubes.ts` | iso-surface extraction |
| `exporters.ts` | GLB / USDZ / STL / NIfTI |
| `VRScene.ts` | three.js scene, WebXR session, controllers & hands, picking, ruler |
| `VRPanel.ts` | in-headset canvas tablet |
| `segmentation.ts` · `nifti.ts` · `segNames.ts` | segmentation: labels, algorithms, NIfTI I/O ([docs](SEGMENTATION.md)) |
| `xr.ts` | device detection hook, helpers |
| `../pages/VRPage.tsx` | desktop UI |

## Limits

* Only scalar (grayscale) volumes with ≥12 slices. US / XA / CR / DX / RGB series are not offered.
* Huge volumes (>130 M voxels) are decimated 2× in-plane while loading to bound memory.
* The mesh is a *visualisation* surface (marching cubes at one threshold) — not a segmentation, not for diagnosis.
* Quest browser memory limits apply: very large CTs may need Quality low / Surface mode.
