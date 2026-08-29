import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { OrthancService } from './orthanc.service';

/** DICOM JSON: { "0020000D": { "vr": "UI", "Value": ["1.2.3"] } } */
type DicomJson = Record<string, { vr?: string; Value?: unknown[] }>;

function str(obj: DicomJson, tag: string): string | undefined {
  const v = obj?.[tag]?.Value?.[0];
  if (v == null) return undefined;
  if (typeof v === 'object' && 'Alphabetic' in (v as any)) {
    return String((v as any).Alphabetic);
  }
  return String(v);
}
function num(obj: DicomJson, tag: string): number | undefined {
  const v = str(obj, tag);
  return v == null ? undefined : Number(v);
}

@Controller('api/studies')
export class StudiesController {
  private readonly log = new Logger(StudiesController.name);

  constructor(private readonly orthanc: OrthancService) {}

  /**
   * Flattened study list for the picker screen. Accepts the same filter params
   * as QIDO-RS (PatientName, StudyDate, ModalitiesInStudy, limit, offset, ...).
   * Degrades to an empty list if Orthanc is unreachable (e.g. infra not up).
   */
  @Get()
  async list(@Query() query: Record<string, string>) {
    let raw: DicomJson[] = [];
    try {
      raw = (await this.orthanc.searchStudies({
        includefield: 'all',
        ...query,
      })) as DicomJson[];
    } catch (e) {
      this.log.warn(`studies query failed: ${(e as Error).message}`);
      return [];
    }

    return raw.map((s) => ({
      studyInstanceUid: str(s, '0020000D'),
      patientId: str(s, '00100020'),
      patientName: str(s, '00100010'),
      patientSex: str(s, '00100040'),
      patientBirthDate: str(s, '00100030'),
      studyDate: str(s, '00080020'),
      studyTime: str(s, '00080030'),
      accessionNumber: str(s, '00080050'),
      studyDescription: str(s, '00081030'),
      modalities: str(s, '00080061'),
      referringPhysician: str(s, '00080090'),
      seriesCount: num(s, '00201206'),
      instanceCount: num(s, '00201208'),
    }));
  }

  /** Flattened series list for one study — powers the "View series" dialog. */
  @Get(':studyUid/series')
  async series(@Param('studyUid') studyUid: string) {
    let raw: DicomJson[] = [];
    try {
      raw = (await this.orthanc.searchSeries(studyUid)) as DicomJson[];
    } catch (e) {
      this.log.warn(`series query failed: ${(e as Error).message}`);
      return [];
    }
    return raw
      .map((s) => ({
        seriesInstanceUid: str(s, '0020000E'),
        seriesNumber: num(s, '00200011'),
        modality: str(s, '00080060'),
        seriesDescription: str(s, '0008103E'),
        bodyPart: str(s, '00180015'),
        instanceCount: num(s, '00201209'),
      }))
      .sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0));
  }
}
