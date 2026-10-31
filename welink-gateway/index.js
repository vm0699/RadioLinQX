/**
 * WeLink DICOM Edge Gateway
 *
 * Runs locally on the scan center / hospital workstation (e.g. 192.168.1.39:4243).
 * Receives DICOM C-STORE push from CT/MRI/X-Ray modalities and automatically uploads
 * the study to the cloud website (https://radio-lin-qx.vercel.app), creating the case record!
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const dcmjsDimse = require('dcmjs-dimse');

const { Server, Scp, Transcoding } = dcmjsDimse;
const { PresentationContextResult, Status } = dcmjsDimse.constants;

// --- Configuration ---
const PORT = parseInt(process.env.DICOM_PORT || '4243', 10);
const AET = (process.env.DICOM_AET || 'WELINK').trim();
const API_URL = (process.env.CLOUD_API_URL || 'https://radiolinq-api.onrender.com/api/upload').trim();
const BUFFER_DIR = path.resolve(__dirname, 'buffer');
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '4000', 10); // 4s idle after last slice

// Ensure buffer directory exists
if (!fs.existsSync(BUFFER_DIR)) {
  fs.mkdirSync(BUFFER_DIR, { recursive: true });
}

// Map studyInstanceUid -> { timer, slices: string[], patientName, studyDesc, modality, receivedCount }
const activeStudies = new Map();

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length ? addresses : ['127.0.0.1'];
}

function sanitizeName(name) {
  if (!name) return 'Unknown';
  if (Array.isArray(name) && name[0] && name[0].Alphabetic) return name[0].Alphabetic;
  if (typeof name === 'object' && name.Alphabetic) return name.Alphabetic;
  return String(name).replace(/\^/g, ' ').trim();
}

/**
 * Upload all buffered DICOM files for a study to the cloud API
 */
async function uploadStudy(studyUid) {
  const study = activeStudies.get(studyUid);
  activeStudies.delete(studyUid);
  if (!study || !study.slices.length) return;

  const studyDir = path.join(BUFFER_DIR, studyUid.replace(/[^0-9.]/g, ''));
  console.log(`\n[WeLink] 🚀 Study transfer complete for "${study.patientName}" (${study.modality || 'DICOM'})`);
  console.log(`[WeLink] 📦 Uploading ${study.slices.length} image(s) to cloud: ${API_URL}...`);

  const form = new FormData();
  for (const filePath of study.slices) {
    if (fs.existsSync(filePath)) {
      form.append('files', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
      });
    }
  }

  try {
    const res = await axios.post(API_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: 500 * 1024 * 1024,
      maxBodyLength: 500 * 1024 * 1024,
      timeout: 120000,
    });

    if (res.data && res.data.created && res.data.created.length > 0) {
      for (const createdCase of res.data.created) {
        console.log(`\n========================================================`);
        console.log(`✅ CASE CREATED ON WEBSITE!`);
        console.log(`   Case Number:  ${createdCase.caseNumber}`);
        console.log(`   Patient Name: ${createdCase.patientName} (${createdCase.patientId || '-'})`);
        console.log(`   Modality:     ${createdCase.scanType} — ${createdCase.studyDescription || ''}`);
        console.log(`   Images:       ${createdCase.imageCount} image(s), ${createdCase.seriesCount} series`);
        console.log(`   Web App:      https://radio-lin-qx.vercel.app/`);
        console.log(`========================================================\n`);
      }
    } else {
      console.log(`[WeLink] ✅ Upload successful! Received:`, res.data);
    }

    // Clean up local buffer files after successful upload
    try {
      if (fs.existsSync(studyDir)) {
        fs.rmSync(studyDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore buffer cleanup errors
    }
  } catch (err) {
    console.error(`[WeLink] ❌ Failed to upload study ${studyUid}:`, err.response?.data || err.message);
    console.log(`[WeLink] ℹ️ Buffer preserved at: ${studyDir}`);
  }
}

/**
 * DICOM SCP Service Class Provider
 */
class WeLinkScp extends Scp {
  /**
   * Handle modality association handshake
   * Tolerant: accepts WELINK, ORTHANC, RADIOLINQ, or any called AE Title
   */
  associationRequested(association) {
    const calledAet = association.getCalledAeTitle();
    const callingAet = association.getCallingAeTitle();
    console.log(`[WeLink] 📡 Connection from modality "${callingAet}" -> Called AET: "${calledAet}"`);

    const contexts = association.getPresentationContexts();
    contexts.forEach((c) => {
      const context = association.getPresentationContext(c.id);
      const syntaxes = context.getTransferSyntaxUids();
      // Accept first proposed transfer syntax (or prefer explicit VR)
      const acceptedSyntax =
        syntaxes.find(
          (ts) =>
            ts === dcmjsDimse.constants.TransferSyntax.ExplicitVRLittleEndian ||
            ts === dcmjsDimse.constants.TransferSyntax.ImplicitVRLittleEndian,
        ) || syntaxes[0];

      if (acceptedSyntax) {
        context.setResult(PresentationContextResult.Accept, acceptedSyntax);
      } else {
        context.setResult(PresentationContextResult.RejectTransferSyntaxesNotSupported);
      }
    });

    this.sendAssociationAccept();
  }

  /**
   * Handle C-ECHO (Modality Ping / Verification test)
   */
  cEchoRequest(request, callback) {
    console.log(`[WeLink] 🏓 C-ECHO Ping received from modality -> Responding SUCCESS (OK)`);
    const response = dcmjsDimse.responses.CEchoResponse.fromRequest(request);
    response.setStatus(Status.Success);
    callback(response);
  }

  /**
   * Handle C-STORE (Incoming DICOM instance from scanner)
   */
  cStoreRequest(request, callback) {
    try {
      const ds = request.getDataset();
      const sopUid = request.getAffectedSopInstanceUid() || `sop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const studyUid = ds.getElement('StudyInstanceUID') || 'unknown-study';
      const patientName = sanitizeName(ds.getElement('PatientName'));
      const modality = ds.getElement('Modality') || 'OT';
      const studyDesc = ds.getElement('StudyDescription') || ds.getElement('SeriesDescription') || '';

      const studyDir = path.join(BUFFER_DIR, studyUid.replace(/[^0-9.]/g, ''));
      if (!fs.existsSync(studyDir)) {
        fs.mkdirSync(studyDir, { recursive: true });
      }

      const filePath = path.join(studyDir, `${sopUid}.dcm`);
      ds.toFile(filePath);

      let study = activeStudies.get(studyUid);
      if (!study) {
        study = {
          patientName,
          studyDesc,
          modality,
          slices: [],
          timer: null,
        };
        activeStudies.set(studyUid, study);
        console.log(`\n[WeLink] 📥 Receiving study for "${patientName}" [${modality}] - Study UID: ${studyUid}`);
      }

      study.slices.push(filePath);
      process.stdout.write(`\r[WeLink] 📥 Received ${study.slices.length} image(s)...`);

      // Reset debounce timer
      if (study.timer) clearTimeout(study.timer);
      study.timer = setTimeout(() => uploadStudy(studyUid), IDLE_TIMEOUT_MS);

      const response = dcmjsDimse.responses.CStoreResponse.fromRequest(request);
      response.setStatus(Status.Success);
      callback(response);
    } catch (err) {
      console.error('[WeLink] C-STORE error:', err.message);
      const response = dcmjsDimse.responses.CStoreResponse.fromRequest(request);
      response.setStatus(Status.ProcessingFailure);
      callback(response);
    }
  }

  associationReleaseRequested() {
    this.sendAssociationReleaseResponse();
  }
}

// --- Start the Gateway ---
async function start() {
  await Transcoding.initializeAsync();

  const server = new Server(WeLinkScp);
  server.on('networkError', (err) => {
    console.error('[WeLink] Network error:', err.message);
  });

  server.listen(PORT, '0.0.0.0');

  const ips = getLocalIpAddresses();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 WeLink DICOM Edge Gateway v1.0               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  MODALITY CONFIGURATION (Enter these on the scanner):        ║');
  console.log('║                                                              ║');
  console.log(`║  ► IP Address:   ${ips[0].padEnd(43)} ║`);
  if (ips.length > 1) {
    for (let i = 1; i < ips.length; i++) {
      console.log(`║    (Alt IP):     ${ips[i].padEnd(43)} ║`);
    }
  }
  console.log(`║  ► Port:         ${String(PORT).padEnd(43)} ║`);
  console.log(`║  ► AE Title:     ${(AET + ' (or ORTHANC)').padEnd(43)} ║`);
  console.log('║                                                              ║');
  console.log('║  CLOUD WEBSITE:                                              ║');
  console.log(`║  ► Target API:   ${API_URL.slice(0, 43).padEnd(43)} ║`);
  console.log('║  ► Web App:      https://radio-lin-qx.vercel.app/            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  STATUS: Listening for C-ECHO and C-STORE sends...           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

start().catch((err) => {
  console.error('[WeLink] Fatal error starting DICOM server:', err);
  process.exit(1);
});
