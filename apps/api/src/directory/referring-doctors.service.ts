import { Injectable } from '@nestjs/common';
import { JsonStore } from '../store/json-store';
import { makeRng, pick } from '../seed/rand';

export interface ReferringDoctor {
  id: string;
  name: string;
  phone: string;
  email?: string;
  hospital?: string;
  speciality?: string;
  casesReferred: number;
  createdAt: string;
}

const NAMES = [
  'Dr. Ramesh Gupta', 'Dr. Fatima Sheikh', 'Dr. John Mathew', 'Dr. Kavya Reddy',
  'Dr. Arjun Deshmukh', 'Dr. Sneha Pillai', 'Dr. Imran Khan', 'Dr. Lakshmi Menon',
  'Dr. Tarun Bansal', 'Dr. Rekha Joshi', 'Dr. Suresh Babu', 'Dr. Neha Kapoor',
];
const HOSPITALS = [
  'City General Hospital', 'Apollo Clinic', 'Sunrise Medical Centre',
  'Lakeside Nursing Home', 'Community Health Centre', 'Metro Ortho & Trauma',
];
const SPECIALITIES = [
  'General Physician', 'Orthopaedics', 'Neurology', 'Pulmonology',
  'Oncology', 'Paediatrics', 'ENT', 'Internal Medicine',
];

function seed(): ReferringDoctor[] {
  const rng = makeRng('referring-doctors-v1');
  return NAMES.map((name, i) => ({
    id: `ref-${i + 1}`,
    name,
    phone: `+91 9${String(400000000 + Math.floor(rng() * 99999999)).slice(0, 9)}`,
    email: `${name.split(' ').slice(-1)[0].toLowerCase()}@clinic.example`,
    hospital: pick(rng, HOSPITALS),
    speciality: pick(rng, SPECIALITIES),
    casesReferred: 0,
    createdAt: new Date(Date.now() - Math.floor(rng() * 300) * 86400000).toISOString(),
  }));
}

@Injectable()
export class ReferringDoctorsService {
  private store = new JsonStore<ReferringDoctor>('referring-doctors.json', seed);

  list() {
    return this.store.all();
  }
  get(id: string) {
    return this.store.find(id);
  }
  create(d: Omit<ReferringDoctor, 'id' | 'casesReferred' | 'createdAt'>) {
    return this.store.insert({
      ...d,
      id: `ref-${Date.now().toString(36)}`,
      casesReferred: 0,
      createdAt: new Date().toISOString(),
    });
  }
  update(id: string, patch: Partial<ReferringDoctor>) {
    return this.store.update(id, patch);
  }
  remove(id: string) {
    return this.store.remove(id);
  }
  /** used by the seed when it invents cases */
  async seedList() {
    return this.store.all();
  }
}
