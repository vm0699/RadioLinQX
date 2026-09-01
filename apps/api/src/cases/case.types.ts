export type CaseStatus =
  | 'UNREAD' // uploaded, no radiologist yet
  | 'ASSIGNED' // radiologist assigned, not started
  | 'DRAFT' // report in progress
  | 'REPORT_PENDING' // alias used by the UI tab (UNREAD|ASSIGNED|DRAFT)
  | 'REPORTED';

export type UploadStatus = 'COMPLETE' | 'IN_PROGRESS' | 'PARTIAL';
export type TatStatus = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'REPORTED';

export interface CaseReport {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  updatedAt: string;
  signedBy?: string;
  signedAt?: string;
}

export interface CaseRecord {
  id: string;
  caseNumber: string;

  patientId: string;
  patientName: string;
  patientAge?: number;
  patientSex?: string;
  patientMobile?: string;

  scanType: string;
  bodyParts: string[];
  studyDescription?: string;
  contrast?: 'Yes' | 'No';

  branchId?: string;
  referringDoctorId?: string;
  referringDoctorName?: string;
  referringDoctorMobile?: string;

  patientHistory?: string;
  remarks?: string;
  tags: string[];

  status: Exclude<CaseStatus, 'REPORT_PENDING'>;
  assignedRadiologistId?: string;
  assignedRadiologistName?: string;

  uploadedAt: string;
  dueAt: string;
  reportedAt?: string;
  uploadStatus: UploadStatus;

  imageCount: number;
  seriesCount: number;

  // viewer linkage — present only when real images exist
  hasImages: boolean;
  studyInstanceUid?: string;
  seriesInstanceUids?: string[];

  report?: CaseReport;
}

export interface FilterPreset {
  id: string;
  name: string;
  query: Record<string, string>;
  createdAt: string;
}

/** Read-time derived fields the UI wants but we don't persist. */
export interface CaseView extends CaseRecord {
  tatStatus: TatStatus;
  timeElapsedMs: number;
  timeRemainingMs: number;
}
