// Naming + grouping for organ label maps.
//
// The ids below follow TotalSegmentator v2 "total" (CT). Any other label map just
// gets generic "Label N" names; users can always rename on the desktop page.

const TS: Record<number, string> = {
  1: 'spleen', 2: 'kidney_right', 3: 'kidney_left', 4: 'gallbladder', 5: 'liver', 6: 'stomach', 7: 'pancreas',
  8: 'adrenal_gland_right', 9: 'adrenal_gland_left', 10: 'lung_upper_lobe_left', 11: 'lung_lower_lobe_left',
  12: 'lung_upper_lobe_right', 13: 'lung_middle_lobe_right', 14: 'lung_lower_lobe_right', 15: 'esophagus',
  16: 'trachea', 17: 'thyroid_gland', 18: 'small_bowel', 19: 'duodenum', 20: 'colon', 21: 'urinary_bladder',
  22: 'prostate', 23: 'kidney_cyst_left', 24: 'kidney_cyst_right', 25: 'sacrum', 26: 'vertebrae_S1',
  27: 'vertebrae_L5', 28: 'vertebrae_L4', 29: 'vertebrae_L3', 30: 'vertebrae_L2', 31: 'vertebrae_L1',
  32: 'vertebrae_T12', 33: 'vertebrae_T11', 34: 'vertebrae_T10', 35: 'vertebrae_T9', 36: 'vertebrae_T8',
  37: 'vertebrae_T7', 38: 'vertebrae_T6', 39: 'vertebrae_T5', 40: 'vertebrae_T4', 41: 'vertebrae_T3',
  42: 'vertebrae_T2', 43: 'vertebrae_T1', 44: 'vertebrae_C7', 45: 'vertebrae_C6', 46: 'vertebrae_C5',
  47: 'vertebrae_C4', 48: 'vertebrae_C3', 49: 'vertebrae_C2', 50: 'vertebrae_C1', 51: 'heart', 52: 'aorta',
  53: 'pulmonary_vein', 54: 'brachiocephalic_trunk', 55: 'subclavian_artery_right', 56: 'subclavian_artery_left',
  57: 'common_carotid_artery_right', 58: 'common_carotid_artery_left', 59: 'brachiocephalic_vein_left',
  60: 'brachiocephalic_vein_right', 61: 'atrial_appendage_left', 62: 'superior_vena_cava',
  63: 'inferior_vena_cava', 64: 'portal_vein_and_splenic_vein', 65: 'iliac_artery_left',
  66: 'iliac_artery_right', 67: 'iliac_vena_left', 68: 'iliac_vena_right', 69: 'humerus_left',
  70: 'humerus_right', 71: 'scapula_left', 72: 'scapula_right', 73: 'clavicula_left', 74: 'clavicula_right',
  75: 'femur_left', 76: 'femur_right', 77: 'hip_left', 78: 'hip_right', 79: 'spinal_cord',
  80: 'gluteus_maximus_left', 81: 'gluteus_maximus_right', 82: 'gluteus_medius_left',
  83: 'gluteus_medius_right', 84: 'gluteus_minimus_left', 85: 'gluteus_minimus_right', 86: 'autochthon_left',
  87: 'autochthon_right', 88: 'iliopsoas_left', 89: 'iliopsoas_right', 90: 'brain', 91: 'skull',
  116: 'sternum', 117: 'costal_cartilages',
};
for (let i = 1; i <= 12; i++) {
  TS[91 + i] = `rib_left_${i}`;
  TS[103 + i] = `rib_right_${i}`;
}

export type NameScheme = 'generic' | 'totalseg';

/** "lung_upper_lobe_left" → "Lung upper lobe left" */
function pretty(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function groupOfName(raw: string): string {
  const n = raw.toLowerCase();
  if (/^(vertebrae|sacrum)/.test(n)) return 'Spine';
  if (/^(rib_|sternum|costal)/.test(n)) return 'Ribs & sternum';
  if (/^(humerus|scapula|clavicula|femur|hip)/.test(n)) return 'Limb & pelvis bones';
  if (n === 'skull') return 'Skull';
  if (n === 'brain' || n === 'spinal_cord') return 'Brain & cord';
  if (/^lung|^trachea/.test(n)) return 'Lungs & airways';
  if (/aorta|artery|vein|vena|trunk|atrial_appendage/.test(n)) return 'Vessels';
  if (/^(gluteus|autochthon|iliopsoas)/.test(n)) return 'Muscles';
  return 'Organs';
}

export function totalSegName(id: number): string | null {
  return TS[id] ?? null;
}

export function nameFor(id: number, scheme: NameScheme): { name: string; group: string } {
  if (scheme === 'totalseg') {
    const raw = TS[id];
    if (raw) return { name: pretty(raw), group: groupOfName(raw) };
  }
  return { name: `Label ${id}`, group: 'Imported' };
}

/** Heuristic: does this id set look like a TotalSegmentator "total" map? */
export function looksLikeTotalSeg(ids: number[]): boolean {
  if (ids.length < 12) return false;
  const max = Math.max(...ids);
  const known = ids.filter((i) => TS[i]).length;
  return max <= 117 && known / ids.length > 0.9;
}

const PALETTE: [number, number, number][] = [
  [230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180],
  [70, 240, 240], [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255],
  [170, 110, 40], [255, 250, 200], [128, 0, 0], [170, 255, 195], [128, 128, 0], [255, 215, 180],
  [0, 0, 128], [128, 128, 128],
];

export function paletteColor(id: number): [number, number, number] {
  const c = PALETTE[(id * 7 + 3) % PALETTE.length];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}
