# WeLink DICOM Edge Gateway Setup Guide

Connect your CT, MRI, X-Ray, or Ultrasound scanner directly to the WeLink platform.

When a technologist performs a scan on the modality and clicks **Send / C-STORE**, the gateway receives the DICOM slices over the local network and automatically uploads them to the cloud web application ([https://radio-lin-qx.vercel.app](https://radio-lin-qx.vercel.app/)), creating the Case Record with all patient details and imaging slices ready for reporting.

---

## 1. Quick Start on the Workstation / Gateway PC

The gateway runs on any Windows, Linux, or macOS machine connected to the same local area network (LAN) as your modality.

### Step 1: Open the Gateway
On the workstation PC (e.g. `192.168.1.39`), simply double-click:
```bat
start-welink-gateway.bat
```
*(Or in terminal: `npm run gateway`)*

You will see:
```text
╔══════════════════════════════════════════════════════════════╗
║                 WeLink DICOM Edge Gateway v1.0               ║
╠══════════════════════════════════════════════════════════════╣
║  MODALITY CONFIGURATION (Enter these on the scanner):        ║
║                                                              ║
║  ► IP Address:   192.168.1.39                                ║
║  ► Port:         4243                                        ║
║  ► AE Title:     WELINK (or ORTHANC)                         ║
║                                                              ║
║  CLOUD WEBSITE:                                              ║
║  ► Target API:   https://radiolinq-api.onrender.com/api/upload
║  ► Web App:      https://radio-lin-qx.vercel.app/            ║
╠══════════════════════════════════════════════════════════════╣
║  STATUS: Listening for C-ECHO and C-STORE sends...           ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 2. Modality Scanner Setup (Philips, GE, Siemens, Canon, etc.)

Go to the scanner console (e.g. **Configure Network Hosts** / **DICOM Nodes**):

| Setting | Value to Enter | Notes |
| :--- | :--- | :--- |
| **Display Name** | `WeLink` | Friendly name on the scanner screen (or `Radiolinq`) |
| **Host Name** | `WeLink` | Or workstation PC hostname |
| **IP Address** | `<Gateway-PC-IP>` | e.g. `192.168.1.39` (shown in gateway window) |
| **Port** | `4243` | Default port (or custom port configured in `.env`) |
| **AE Title** | `WELINK` (or `ORTHANC`) | Gateway accepts either without error |
| **Secure / TLS** | `No` | Standard DICOM DIMSE |

### Test the Connection
1. Click **Verify / Ping / Echo** on the scanner screen.
2. The scanner will report: **"Verification Successful / OK"**.
3. In the Gateway console window, you will see:
   `[WeLink] 🏓 C-ECHO Ping received from modality -> Responding SUCCESS (OK)`

---

## 3. Sending Scans & Automatic Cloud Ingestion

1. On the scanner, select the patient study.
2. Click **Send / Transfer** -> Select `WeLink`.
3. The modality transfers the slices over the local network via C-STORE.
4. The gateway receives the slices in real-time:
   ```text
   [WeLink] 📥 Receiving study for "Aarav Reddy" [CT] - Study UID: 1.2.840...
   [WeLink] 📥 Received 120 image(s)...
   [WeLink] 🚀 Study transfer complete (120 images). Uploading to cloud...
   ========================================================
   ✅ CASE CREATED ON WEBSITE!
      Case Number:  RLQ-2026-00147
      Patient Name: Aarav Reddy (634590)
      Modality:     CT — HRCT Chest
      Images:       120 image(s), 2 series
      URL:          https://radio-lin-qx.vercel.app/
   ========================================================
   ```
5. Refresh [https://radio-lin-qx.vercel.app/](https://radio-lin-qx.vercel.app/) — the case record appears in the list, and radiologists can immediately open the 2D/3D DICOM viewer and report the case!
