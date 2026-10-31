# Multi-series demo study (renal MRI)

Public, de-identified DICOM from The Cancer Imaging Archive (TCIA) — a TCGA kidney-cancer
subject (`TCGA-B9-7268`, Siemens 1.5 T abdominal MRI), retrieved through the NCI Imaging
Data Commons public DICOMweb proxy. TCGA radiology is distributed under CC BY 3.0; see the
TCIA TCGA-KIRC / TCGA-KIRP collection pages for the formal citation and data-use terms.
No patient identifiers beyond the public TCGA barcode.

Subset kept for the demo (7 of the study's 10 series), one folder per series:

| Series # | Description | Slices | Matrix | Thickness |
|---|---|---|---|---|
| 7  | FL3D T1 VIBE COR PRE        | 56 | 256×232 | 1.5 mm |
| 9  | FL3D T1 VIBE COR POST       | 56 | 256×232 | 1.5 mm |
| 10 | FL3D T1 VIBE COR POST       | 56 | 256×232 | 1.5 mm |
| 12 | FL3D T1 VIBE COR POST DELAY | 56 | 256×232 | 1.5 mm |
| 8  | T1 AXIAL IPAT VIBE PRE      | 72 | 256×256 | 3 mm   |
| 11 | T1 AXIAL IPAT VIBE POST DELAY | 72 | 256×256 | 3 mm |
| 6  | TSE T2 AXIAL FS             | 22 | 360×512 | 7 mm   |

`case.json` supplies the case's description / history / series order to the seed.

