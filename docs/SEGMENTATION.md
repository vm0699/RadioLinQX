# Segmentation — hide organs in the 3D / VR viewer

Every voxel of the scan can carry a **label**. Hiding a label removes it from the volume, slice and surface views
(and from the HU probe / ruler, so you can measure *through* it). Open the **Segment** tab on the VR tablet, or the
**Segment · hide organs** section of the desktop `/vr` page.

```
                   ┌────────────── how labels get created ──────────────┐
 Auto-segment  ──▶ │ CT: skin layer · fat · soft tissue · lungs · bone  │
 (in browser)      │ MR/other: skin layer · interior                    │
                   ├────────────────────────────────────────────────────┤
 Hide / Grow   ──▶ │ point at a structure → hides its label, or grows a │
 (click / trigger) │ region from the point (connected, similar tissue)  │
                   ├────────────────────────────────────────────────────┤
 Carve         ──▶ │ brush: hold & sweep to cut the scan away           │
                   ├────────────────────────────────────────────────────┤
 Import        ──▶ │ organ label map (.nii/.nii.gz): liver, kidneys,    │
                   │ heart, 100+ structures from TotalSegmentator/Slicer│
                   └────────────────────────────────────────────────────┘
                                   │
                         Save to case  ──▶ loads automatically in every headset
```

## Tools

| Tool | Desktop | In the headset | Notes |
|---|---|---|---|
| **Hide** | click | point + trigger | On a labelled structure: toggles that label (again = show). On an un-segmented area: grows a region and hides it. |
| **Grow** | click | point + trigger | Region growing from the point; takes over voxels of the label under it (so organs can be split out of "soft tissue"). |
| **Carve** | left-drag (right-drag orbits) | hold trigger + sweep | Brush size in mm. Repeated strokes dig deeper. |
| **Auto-segment** | button | button | ½ s. CT: skin layer (outer 6 mm), fat, soft tissue & organs, lungs & airways, bone. Other modalities: skin layer + interior. |
| **Undo** | button | button | 4 levels. |
| Tolerance | slider | slider | ± intensity (HU for CT) around the clicked tissue. |
| **Leak control** | 0–3 | 0–3 | Morphological opening that cuts thin bridges (vessels, partial-volume contacts) so a region doesn't bleed into neighbours. |
| **Soft edge** | switch | button | Also hides the 1-voxel rim around a hidden segment (removes the halo a tight mask leaves). |

Lists: one switch per **group** (Skin & body · Lungs · Spine · Ribs · Vessels · Muscles · Organs …) and per **label**
(desktop: rename, solo ◎, highlight ◍, delete ✕, volume in mL). Newly grown regions appear under *Regions*, carving under *Edits*.

## Organ-level segmentation (named organs)

The built-in tools are classical image processing — fast and offline, but not organ-aware. For **named organs** run an
AI segmenter once, then import its label map:

### TotalSegmentator (CT → 117 structures)
```bash
pip install TotalSegmentator
TotalSegmentator -i <DICOM_FOLDER or ct.nii.gz> -o seg --ml      # one multi-label file → seg.nii(.gz)
#  --fast  for a quick CPU run   ·  GPU recommended for full resolution
```
Then on the page: **Import .nii / .nii.gz** (names: *auto* recognises the TotalSegmentator ids) → organs appear grouped
(Organs, Vessels, Lungs & airways, Spine, Ribs & sternum, Limb & pelvis bones, Muscles, Skull, Brain & cord).
Click a group switch to hide e.g. all ribs; **Save to case** to keep it. *(Check the TotalSegmentator licence terms for your use.)*

### 3D Slicer / ITK-SNAP / MONAI
Export the segmentation as a **label map NIfTI** (Slicer: *Segmentations → Export to labelmap → Save as .nii.gz*).
Any resolution and orientation works — the importer resamples through the NIfTI affines onto the rendered grid
(≤ 255 labels; ids above 254 are ignored). Names default to "Label N" and can be renamed on the desktop page.

## Saving & sharing

* **Save to case** writes a gzipped uint8 NIfTI of the labels (on the rendered grid) + names/colours/visibility to the
  server (`PUT /api/cases/:id/segmentation`, stored in `data/segmentations/<caseId>/`) and adds a *SEGMENTATION*
  entry to the case history. The VR page loads it automatically — the doctor segments once on the desktop, the
  referring doctor opens the same case in a headset and sees the same hidden/shown state.
* **Labels .nii.gz** downloads the same file for 3D Slicer / other tools.
* `GET /api/cases/:id/segmentation` (+ `/file`) and `DELETE` complete the API.
* On Render's free tier the disk is ephemeral like the rest of `data/` (resets on redeploy).

## How it renders

* Labels live in a `Uint8Array` on the same grid as the 3D texture. Visibility is baked into a small **RG8 3D texture**
  (R = hidden, G = highlighted) that the ray-marcher samples with linear filtering, so cut edges are smooth, not blocky.
  Toggling a label re-uploads only that mask (≈ 10 MB for a 5 M-voxel volume).
* Surface mode extracts the iso-surface from a copy of the volume with hidden voxels removed and colours each vertex
  by its label (so the exported GLB/USDZ carries organ colours; STL is geometry only).
* Picking (HU probe, ruler, tool clicks) skips hidden voxels.

## Limits — please read

* Auto-segmentation is threshold/morphology based: good for body layers, lungs, bone; **not** organ detection.
* Region growing depends on contrast; leaks happen. Use *Leak control*, lower the tolerance, or *Undo*.
* Imported label maps must be in the **same patient space** as the scan (same series).
* Visualisation aid — **not a diagnostic or surgical-planning tool**, no clinical validation.

## Code

| File | Role |
|---|---|
| `src/vr/segmentation.ts` | label volume, region growing, morphology, auto-segmentation, undo |
| `src/vr/nifti.ts` | NIfTI-1 read/write (gz), affine resampling of external label maps |
| `src/vr/segNames.ts` | TotalSegmentator names + grouping, palette |
| `src/vr/volumeShader.ts` | mask sampling in the ray-marcher |
| `src/vr/VRScene.ts` | tools, mask texture, surface masking, persistence hooks, tablet tab |
| `apps/api/src/cases/cases.controller.ts` | `/api/cases/:id/segmentation` |
