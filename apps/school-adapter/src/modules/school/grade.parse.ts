import {load} from 'cheerio';

export interface HistoryGradeCourse {
  name: string;
  type: string;
  credits: number;
  score: string | null;
}

export interface HistoryGradeSummary {
  conductScore: string | null;
  classRank: number | null;
  totalScore: number | null;
}

export function normalizeSemester(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{3})[^\d]*([12上下一二])/);
  if (match && match[1] && match[2]) {
    const year = match[1];
    const sem = ['1', '上', '一'].includes(match[2]) ? '1' : '2';
    return `${year}${sem}`;
  }
  return trimmed;
}

export function parseHistoryGrades(html: string) {
  const $ = load(html);
  const result: Record<string, HistoryGradeCourse[]> = Object.create(null);
  const normalizeScore = (raw: string): string | null =>
    raw === '' || raw === '無成績' || raw === '----' || raw === '-1' ? null : raw;

  $('.grid_view .tr_data').each((_, el) => {
    const tds = $(el).find('td');
    const semester = $(el).attr('data-yysem') || 'unknown';
    const list = result[semester] ?? (result[semester] = []);

    const name = $(tds[2]).text().replace(/\(學年課\)/, '').trim();
    if (!name) return;

    list.push({
      name,
      type: $(tds[4]).text().trim(),
      credits: Number($(tds[5]).text().trim()) || 0,
      score: normalizeScore($(tds[6]).text().trim()),
    });
  });

  return result;
}

export function parseHistoryGradeSummaries(html: string) {
  const $ = load(html);
  const result: Record<string, HistoryGradeSummary> = Object.create(null);

  $('.tr_total[data-yysem]').each((_, el) => {
    const semester = $(el).attr('data-yysem');
    if (!semester) return;
    const tds = $(el).find('td');
    const conductRaw = $(tds[4]).text().trim();
    const classRankRaw = $(tds[5]).text().trim();
    const rankNum = Number(classRankRaw);
    result[semester] = {
      conductScore: conductRaw && conductRaw !== '----' ? conductRaw : null,
      classRank: !Number.isNaN(rankNum) && rankNum > 0 ? rankNum : null,
      totalScore: null,
    };
  });

  return result;
}

export function computeAverageScore(courses: Array<{ score: string | null }>): number | null {
  const nums = courses
    .map(c => parseFloat(c.score ?? ''))
    .filter(n => !Number.isNaN(n) && n >= 0);
  return nums.length > 0
    ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
    : null;
}
