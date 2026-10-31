========================================================================
                    WeLink DICOM Gateway - Setup Guide
========================================================================

This gateway receives DICOM scans directly from your CT, MRI, X-Ray,
or Ultrasound machine and automatically creates the case on the website:
https://radio-lin-qx.vercel.app/

------------------------------------------------------------------------
STEP 1: Run the Gateway on your Workstation PC
------------------------------------------------------------------------
1. Make sure Node.js (v18 or v20+) is installed on this PC:
   https://nodejs.org/ (download LTS version)
2. Double-click "start.bat".
3. A black window will appear showing:
   - IP Address (e.g. 192.168.1.39)
   - Port (4243)
   - AE Title (WELINK or ORTHANC)

*Keep this window open while transferring scans!*

------------------------------------------------------------------------
STEP 2: Configure on your Scanner (Philips, GE, Siemens, etc.)
------------------------------------------------------------------------
On the scanner console screen:
Open "Configure Network Hosts" / "DICOM Storage / Nodes":

1. Click "Add" or edit existing entry:
   - Display Name:  WeLink   (or Radiolinq)
   - Host Name:     WeLink   (or your PC hostname)
   - IP Address:    <IP shown in the gateway window>  (e.g. 192.168.1.39)
   - Port:          4243
   - AE Title:      WELINK   (or ORTHANC)
   - Secure / TLS:  No

2. Click "Verify" / "Ping" / "Echo":
   - The scanner will show: "Successful / OK"
   - The gateway window will log: "C-ECHO Ping received -> SUCCESS"

------------------------------------------------------------------------
STEP 3: Send Scans to WeLink
------------------------------------------------------------------------
1. Select the patient study on your scanner.
2. Click "Send" / "Transfer" -> Select "WeLink".
3. Once all images are sent, the gateway uploads the study to the cloud.
4. Check https://radio-lin-qx.vercel.app/
   The case record appears immediately with patient details and DICOM images!
========================================================================
