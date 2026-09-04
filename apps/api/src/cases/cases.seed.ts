import { scanDicomInstances } from '../local/local.service';
import { makeRng, pick, pickSome, intBetween, type Rng } from '../seed/rand';
import type { CaseRecord } from './case.types';
import type { AppSettings } from '../settings/settings.service';
import type { ReferringDoctor } from '../directory/referring-doctors.service';

const FIRST = [
  'Aarav', 'Diya', 'Vihaan', 'Ananya', 'Kabir', 'Ishita', 'Reyansh', 'Saanvi',
  'Ayaan', 'Aadhya', 'Krishna', 'Myra', 'Arjun', 'Kiara', 'Vivaan', 'Anika',
  'Rohan', 'Prisha', 'Advait', 'Navya', 'Rahul', 'Meera', 'Karthik', 'Divya',
];
const LAST = [
  'Sharma', 'Iyer', 'Reddy', 'Nair', 'Menon', 'Patel', 'Rao', 'Gupta',
  'Kulkarni', 'Bose', 'Chowdhury', 'Pillai', 'Deshpande', 'Verma', 'Khan',
];
const STUDY_DESC: Record<string, string[]> = {
  CT: ['CT Brain Plain', 'HRCT Chest', 'CT Abdomen & Pelvis', 'CT KUB', 'CT Angio — Neck'],
  MR: ['MRI Brain Screening', 'MRI Lumbar Spine', 'MRI Knee — Right', 'MRI Whole Spine'],
  CR: ['X-Ray Chest PA', 'X-Ray Knee AP/LAT', 'X-Ray Lumbar Spine'],
  DX: ['DX Chest', 'DX Full Spine', 'DX Pelvis'],
  US: ['USG Abdomen', 'USG KUB', 'USG Pelvis', 'Echocardiogram'],
  XA: ['Coronary Angiography', 'Peripheral Angiogram'],
  RF: ['Barium Swallow', 'HSG'],
  MG: ['Bilateral Mammography'],
};

function fakePatient(rng: Rng) {
  return {
    patientId: String(intBetween(rng, 100000, 999999)),
    patientName: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
    patientAge: intBetween(rng, 3, 88),
    patientSex: pick(rng, ['M', 'F']),
    patientMobile: `+91 9${String(intBetween(rng, 100000000, 999999999))}`,
  };
}

function studyDescFor(rng: Rng, scanType: string): string {
  const opts = STUDY_DESC[scanType] ?? [`${scanType} Study`];
  return pick(rng, opts);
}

/**
 * Build the initial case list: one real, viewer-linked case per local DICOM
 * study, plus ~130 synthetic historical cases spread over the last 45 days so
 * the dashboard has volume, tab counts and a date range to filter.
 */
export async function seedCases(
  settings: AppSettings,
  referrers: ReferringDoctor[],
): Promise<CaseRecord[]> {
  const rng = makeRng('cases-v1');
  const rads = settings.radiologists.filter((r) => r.active);
  const out: CaseRecord[] = [];
  let seq = 1;

  const targetHours = (st: string) =>
    settings.tat.targetHoursByScanType[st] ??
    settings.tat.targetHoursByScanType['*'] ??
    24;

  const mkCase = (
    base: Partial<CaseRecord>,
    uploadedAt: Date,
    scanType: string,
  ): CaseRecord => {
    const ref = pick(rng, referrers);
    const due = new Date(uploadedAt.getTime() + targetHours(scanType) * 3600_000);
    // ~55% reported
    const reported = rng() < 0.55;
    const rad = pick(rng, rads);
    const status: CaseRecord['status'] = reported
      ? 'REPORTED'
      : pick(rng, ['UNREAD', 'ASSIGNED', 'ASSIGNED', 'DRAFT'] as const);
    const reportedAt = reported
      ? new Date(
          uploadedAt.getTime() +
            intBetween(rng, 1, targetHours(scanType) + 30) * 3600_000,
        ).toISOString()
      : undefined;

    return {
      id: `case-${seq}`,
      caseNumber: `RLQ-${new Date(uploadedAt).getFullYear()}-${String(seq).padStart(5, '0')}`,
      ...fakePatient(rng),
      scanType,
      bodyParts: pickSome(rng, settings.bodyParts, 2).slice(0, 2),
      studyDescription: studyDescFor(rng, scanType),
      contrast: rng() < 0.25 ? 'Yes' : 'No',
      branchId: pick(rng, settings.branches).id,
      referringDoctorId: ref.id,
      referringDoctorName: ref.name,
      referringDoctorMobile: ref.phone,
      patientHistory: pick(rng, [
        'Persistent headache x 2 weeks',
        'Trauma — RTA, rule out fracture',
        'Chronic cough, evaluate',
        'Post-op follow-up',
        'Abdominal pain, ? appendicitis',
        'Screening',
        'Low backache radiating to leg',
      ]),
      remarks: rng() < 0.3 ? 'Prior imaging available for comparison.' : '',
      tags:
        rng() < 0.35 ? pickSome(rng, settings.tags, 2) : [],
      status,
      assignedRadiologistId: status === 'UNREAD' ? undefined : rad.id,
      assignedRadiologistName: status === 'UNREAD' ? undefined : rad.name,
      uploadedAt: uploadedAt.toISOString(),
      dueAt: due.toISOString(),
      reportedAt,
      uploadStatus: rng() < 0.9 ? 'COMPLETE' : pick(rng, ['IN_PROGRESS', 'PARTIAL'] as const),
      imageCount: intBetween(rng, 1, 480),
      seriesCount: intBetween(rng, 1, 6),
      hasImages: false,
      linkedCaseIds: [],
      attachments: [],
      history: [
        {
          id: `ev-seed-${seq}`,
          at: uploadedAt.toISOString(),
          by: 'Sunray Scans',
          type: 'UPLOADED' as const,
          detail: 'Study received',
        },
        ...(reported
          ? [
              {
                id: `ev-seed-r-${seq}`,
                at: reportedAt!,
                by: rad.name,
                type: 'REPORT_SIGNED' as const,
                detail: `Report signed by ${rad.name}`,
              },
            ]
          : []),
      ],
      report: reported
        ? {
            clinicalHistory: 'As provided by referring physician.',
            technique: `${scanType} performed as per standard protocol.`,
            findings:
              'No acute intracranial abnormality. Ventricular system is normal in size and configuration. No midline shift.',
            impression: 'No significant abnormality detected. Clinical correlation advised.',
            updatedAt: reportedAt!,
            signedBy: rad.name,
            signedAt: reportedAt!,
          }
        : undefined,
      ...base,
    };
  };

  // --- real, viewer-linked cases from local DICOM ---
  const instances = await scanDicomInstances();
  const byStudy = new Map<string, typeof instances>();
  for (const i of instances) {
    const arr = byStudy.get(i.studyInstanceUid) ?? [];
    arr.push(i);
    byStudy.set(i.studyInstanceUid, arr);
  }
  for (const [studyUid, arr] of byStudy) {
    const first = arr[0];
    const seriesUids = [...new Set(arr.map((i) => i.seriesInstanceUid))];
    const uploadedAt = new Date(Date.now() - intBetween(rng, 1, 6) * 3600_000);
    const scanType = first.modality || 'OT';
    const c = mkCase(
      {
        patientId: first.patientId || String(intBetween(rng, 100000, 999999)),
        patientName: (first.patientName || 'Unknown').replace(/\^/g, ' '),
        patientSex: first.patientSex,
        studyDescription:
          first.studyDescription || first.seriesDescription || studyDescFor(rng, scanType),
        hasImages: true,
        studyInstanceUid: studyUid,
        seriesInstanceUids: seriesUids,
        imageCount: arr.reduce((n, i) => n + i.numberOfFrames, 0),
        seriesCount: seriesUids.length,
        // fresh arrivals — keep them in the pending queue
        status: 'UNREAD',
        assignedRadiologistId: undefined,
        assignedRadiologistName: undefined,
        reportedAt: undefined,
        report: undefined,
        uploadStatus: 'COMPLETE',
      },
      uploadedAt,
      scanType,
    );
    out.push(c);
    seq++;
  }

  // --- synthetic history ---
  for (let d = 0; d < 45; d++) {
    const perDay = intBetween(rng, 1, 5);
    for (let k = 0; k < perDay; k++) {
      const uploadedAt = new Date(
        Date.now() - d * 86400_000 - intBetween(rng, 0, 82800) * 1000,
      );
      const scanType = pick(rng, settings.scanTypes.slice(0, 8));
      out.push(mkCase({}, uploadedAt, scanType));
      seq++;
    }
  }

  return out.sort(
    (a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt),
  );
}
