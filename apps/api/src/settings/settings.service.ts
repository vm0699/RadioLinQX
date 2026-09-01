import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store';

export interface Radiologist {
  id: string;
  name: string;
  email: string;
  specialties: string[];
  active: boolean;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
}

export interface AppSettings {
  id: 'app';
  scanCenter: {
    name: string;
    aet: string;
    contactEmail: string;
    contactPhone: string;
  };
  branches: Branch[];
  scanTypes: string[];
  bodyParts: string[];
  tags: string[];
  radiologists: Radiologist[];
  tat: {
    /** default turnaround target, hours, keyed by scan type ('*' = fallback) */
    targetHoursByScanType: Record<string, number>;
    statWindowHours: number;
  };
}

const DEFAULTS: AppSettings = {
  id: 'app',
  scanCenter: {
    name: 'Sunray Scans',
    aet: 'RADIOLINQ',
    contactEmail: 'ops@sunrayscans.example',
    contactPhone: '+91 90000 00000',
  },
  branches: [
    { id: 'br-main', name: 'Sunray Scans — Main', code: 'MAIN' },
    { id: 'br-xray', name: 'Sunray Scans — X-Ray Unit', code: 'XRAY' },
    { id: 'br-ct', name: 'Sunray Scans — CT/MRI Centre', code: 'CTMRI' },
  ],
  scanTypes: [
    'CT', 'MR', 'CR', 'DX', 'US', 'MG', 'RF', 'XA', 'PT', 'NM',
    'DEXA', 'Cisternography', 'OT', 'ES', 'ST', 'IO', 'DOC',
  ],
  bodyParts: [
    'Head', 'Brain', 'Neck', 'Cervical Spine', 'Thoracic Spine', 'Lumbar Spine',
    'Whole Spine', 'Chest', 'Abdomen', 'Pelvis', 'Abdomen & Pelvis',
    'Shoulder', 'Elbow', 'Wrist', 'Hand', 'Hip', 'Knee', 'Ankle', 'Foot',
    'KUB', 'HRCT Chest', 'CT Angio', 'Whole Body',
  ],
  tags: [
    'Urgent', 'STAT', 'Critical finding', 'Second opinion', 'Teaching file',
    'Interesting case', 'Follow-up', 'Comparison available', 'Poor quality',
  ],
  radiologists: [
    { id: 'rad-1', name: 'Dr. Anitha Rao', email: 'anitha.rao@radiolinq.example', specialties: ['CT', 'MR', 'Neuro'], active: true },
    { id: 'rad-2', name: 'Dr. Vikram Shetty', email: 'vikram.shetty@radiolinq.example', specialties: ['CR', 'DX', 'MSK'], active: true },
    { id: 'rad-3', name: 'Dr. Meera Iyer', email: 'meera.iyer@radiolinq.example', specialties: ['US', 'MG', 'Body'], active: true },
    { id: 'rad-4', name: 'Dr. Sanjay Kulkarni', email: 'sanjay.k@radiolinq.example', specialties: ['CT', 'Chest'], active: true },
    { id: 'rad-5', name: 'Dr. Priya Nair', email: 'priya.nair@radiolinq.example', specialties: ['MR', 'Neuro', 'Spine'], active: false },
  ],
  tat: {
    targetHoursByScanType: { '*': 24, CT: 12, MR: 24, CR: 6, DX: 6, US: 8, XA: 4 },
    statWindowHours: 1,
  },
};

@Injectable()
export class SettingsService {
  private store = new JsonStore<AppSettings>('settings.json', () => [DEFAULTS]);

  async get(): Promise<AppSettings> {
    const all = await this.store.all();
    return all[0] ?? DEFAULTS;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next = { ...current, ...patch, id: 'app' as const };
    await this.store.replaceAll([next]);
    return next;
  }

  async targetHours(scanType?: string): Promise<number> {
    const s = await this.get();
    return (
      (scanType && s.tat.targetHoursByScanType[scanType]) ||
      s.tat.targetHoursByScanType['*'] ||
      24
    );
  }
}
