import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { CaseRecord } from './case.types';
import type { AppSettings } from '../settings/settings.service';

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function fact(label: string, value: string) {
  return new TableCell({
    borders: NO_BORDER,
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 20 }),
          new TextRun({ text: value || '—', size: 20 }),
        ],
      }),
    ],
  });
}

function section(title: string, body: string) {
  return [
    new Paragraph({
      spacing: { before: 220, after: 60 },
      children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 22, color: '2563EB' })],
    }),
    ...(body || '—')
      .split('\n')
      .map(
        (line) =>
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: line || ' ', size: 22 })],
          }),
      ),
  ];
}

/** Builds the "letter pad" — scan-centre letterhead + case report — as a .docx buffer. */
export async function buildReportDocx(
  c: CaseRecord,
  settings: AppSettings,
): Promise<Buffer> {
  const r = c.report;
  const branch = settings.branches.find((b) => b.id === c.branchId);

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
        children: [
          // ---- letterhead ----
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: settings.scanCenter.name, bold: true, size: 32, color: '2563EB' }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: [branch?.address, settings.scanCenter.contactEmail, settings.scanCenter.contactPhone]
                  .filter(Boolean)
                  .join('  ·  '),
                size: 18,
                color: '475569',
              }),
            ],
          }),
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '2563EB' } },
            spacing: { after: 200 },
            children: [],
          }),

          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 120 },
            children: [new TextRun({ text: 'RADIOLOGY REPORT' })],
          }),

          // ---- patient / study facts ----
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  fact('Patient', `${c.patientName} (${c.patientId})`),
                  fact('Age / Sex', `${c.patientAge ?? '—'} / ${c.patientSex ?? '—'}`),
                ],
              }),
              new TableRow({
                children: [
                  fact('Case No.', c.caseNumber),
                  fact('Study', `${c.scanType} — ${c.studyDescription ?? (c.bodyParts.join(', ') || '—')}`),
                ],
              }),
              new TableRow({
                children: [
                  fact('Referring Dr.', c.referringDoctorName || '—'),
                  fact('Study date', new Date(c.uploadedAt).toLocaleDateString()),
                ],
              }),
            ],
          }),

          ...section('Clinical History', r?.clinicalHistory ?? ''),
          ...section('Technique', r?.technique ?? ''),
          ...section('Findings', r?.findings ?? ''),
          ...section('Impression', r?.impression ?? ''),

          new Paragraph({ spacing: { before: 400 }, children: [] }),
          new Paragraph({
            children: [
              new TextRun({
                text: r?.signedBy
                  ? `Electronically signed by ${r.signedBy} on ${new Date(r.signedAt!).toLocaleString()}`
                  : `${c.assignedRadiologistName ?? 'Reporting radiologist'} (report not yet signed)`,
                italics: true,
                size: 20,
                color: '475569',
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

const HEADINGS = ['clinicalHistory', 'technique', 'findings', 'impression'] as const;
const HEADING_MATCH: Record<(typeof HEADINGS)[number], RegExp> = {
  clinicalHistory: /^clinical history$/i,
  technique: /^technique$/i,
  findings: /^findings$/i,
  impression: /^impression$/i,
};

/** Best-effort re-import of an edited .docx: splits its text back into
 *  report sections by matching the same headings we emit above. Anything
 *  before the first recognised heading, or if no headings are found at all,
 *  is dropped into `findings` so the doctor's edits are never lost. */
export function parseReportText(raw: string): Partial<Record<(typeof HEADINGS)[number], string>> {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const out: Partial<Record<(typeof HEADINGS)[number], string>> = {};
  let current: (typeof HEADINGS)[number] | null = null;
  let leftover: string[] = [];

  for (const line of lines) {
    const hit = HEADINGS.find((h) => HEADING_MATCH[h].test(line));
    if (hit) {
      current = hit;
      out[hit] = out[hit] ?? '';
      continue;
    }
    if (!line && current == null) continue;
    if (current) out[current] = out[current] ? `${out[current]}\n${line}` : line;
    else leftover.push(line);
  }
  for (const h of HEADINGS) if (out[h]) out[h] = out[h]!.trim();

  if (leftover.join('').trim() && !current) {
    out.findings = [leftover.join('\n').trim(), out.findings].filter(Boolean).join('\n\n');
  }
  return out;
}
