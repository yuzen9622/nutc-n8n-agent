import {load} from 'cheerio';

export interface AbsenceNoteRecord {
  id: number;
  appliedAt: string;
  type: string;
  courseInfo: string;
  reason: string;
  teacherStatus: string;
  finalStatus: string;
  remark: string;
}

export const LEAVE_TYPE_MAP: Record<string, number> = {
  事假: 1,
  病假: 2,
  公假: 3,
  喪假: 4,
  生理假: 5,
  婚假: 6,
  產假: 7,
  心理調適假: 8,
  心理假: 8,
};

export const LEAVE_TYPE_NAMES: Record<number, string> = {
  1: '事假',
  2: '病假',
  3: '公假',
  4: '喪假',
  5: '生理假',
  6: '婚假',
  7: '產假',
  8: '心理調適假',
};

export function normalizeLeaveType(input: unknown): {code: number; name: string} {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 10) {
    return {code: input, name: LEAVE_TYPE_NAMES[input] ?? `假別${input}`};
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const asNum = parseInt(trimmed, 10);
    if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= 10) {
      return {code: asNum, name: LEAVE_TYPE_NAMES[asNum] ?? `假別${asNum}`};
    }
    const matched = Object.keys(LEAVE_TYPE_MAP).find(name => trimmed.includes(name));
    if (matched && LEAVE_TYPE_MAP[matched]) {
      return {code: LEAVE_TYPE_MAP[matched], name: matched};
    }
  }
  // Default fallback to 1 (事假)
  return {code: 1, name: '事假'};
}

export function normalizeDate(input: string): string {
  const trimmed = input.trim();
  const replaced = trimmed.replace(/-/g, '/');
  const match = replaced.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match && match[1] && match[2] && match[3]) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}/${m}/${d}`;
  }
  return replaced;
}

export function parseAbsenceNotes(html: string): AbsenceNoteRecord[] {
  const $ = load(html);
  const result: AbsenceNoteRecord[] = [];

  $('table.grid_view tr[data-key]').each((_, el) => {
    const tds = $(el).find('td');
    const id = Number($(el).attr('data-key')) || 0;

    const descCell = $(tds[2]);
    const fullText = descCell.text().trim();
    const typeMatch = fullText.match(/\[(.+?)\]/);
    const type = typeMatch && typeMatch[1] ? typeMatch[1] : '';
    const courseInfo = descCell.find('i').text().trim();

    const descHtml = descCell.html() ?? '';
    const brParts = descHtml.split(/<br\s*\/?>/i);
    const reason = brParts[1] ? load(brParts[1]).text().trim() : '';

    result.push({
      id,
      appliedAt: $(tds[1]).text().trim(),
      type,
      courseInfo,
      reason,
      teacherStatus: $(tds[3]).text().trim(),
      finalStatus: $(tds[4]).text().trim(),
      remark: $(tds[5]).text().trim(),
    });
  });

  return result;
}

export function buildLeaveSubmissionPayload(input: {
  date: string;
  date1?: string;
  begin_sec: number;
  end_sec: number;
  an_type: number;
  reason: string;
  consecutive?: number;
  detail?: Array<[number, number]>;
}): Record<string, string> {
  const dateNorm = normalizeDate(input.date);
  const date1Norm = input.date1 ? normalizeDate(input.date1) : dateNorm;
  const beginSec = Math.max(1, Math.min(14, input.begin_sec));
  const endSec = Math.max(beginSec, Math.min(14, input.end_sec));
  const detailList = input.detail ?? Array.from({length: endSec - beginSec + 1}, (_, idx) => [1, beginSec + idx] as [number, number]);

  return {
    anid: '0',
    date: dateNorm,
    date1: date1Norm,
    detail: JSON.stringify(detailList),
    begin_sec: String(beginSec),
    end_sec: String(endSec),
    an_type: String(input.an_type),
    reason: input.reason.trim(),
    dropped: '0',
    consecutive: String(input.consecutive ?? 1),
    update: '儲存',
  };
}
