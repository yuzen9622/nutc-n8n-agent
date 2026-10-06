// Adapted from nutc_student_system b2e4d4f: schedule.parse.ts. No I/O.
import * as cheerio from "cheerio";
import type { CalendarEvent } from "./school.type.js";

export function parseSchedule(html: string): CalendarEvent[] {
  const $ = cheerio.load(html);

  function fullWidthToAsciiDigits(s: string) {
    return s.replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  }

  function parsePeriods(timeClass: string): number[] {
    const m = timeClass.match(/第([^節]+)/);
    if (!m) return [];

    const rawContent = m[1];
    if (!rawContent) return [];

    const content = fullWidthToAsciiDigits(rawContent.trim());
    const parts = content
      .split(/[、,，]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const periods: number[] = [];
    for (const p of parts) {
      if (p.includes("～") || p.includes("~") || p.includes("-")) {
        const sep = p.includes("～") ? "～" : p.includes("~") ? "~" : "-";
        const [rawA, rawB] = p.split(sep);
        if (rawA === undefined || rawB === undefined) continue;

        const a = parseInt(rawA, 10);
        const b = parseInt(rawB, 10);
        if (Number.isInteger(a) && Number.isInteger(b) && a>=1 && b<=13 && a<=b) {
          for (let i = a; i <= b; i++) periods.push(i);
        }
      } else {
        const n = parseInt(p, 10);
        if (Number.isInteger(n) && n>=1 && n<=13) periods.push(n);
      }
    }
    return Array.from(new Set(periods)).sort((a, b) => a - b);
  }

  const periodTimes: Record<number, [string, string]> = {
    1:  ["08:10", "09:00"],
    2:  ["09:10", "10:00"],
    3:  ["10:10", "11:00"],
    4:  ["11:10", "12:00"],
    5:  ["13:25", "14:15"],
    6:  ["14:20", "15:10"],
    7:  ["15:20", "16:10"],
    8:  ["16:15", "17:05"],
    9:  ["17:10", "18:00"],
    10: ["18:10", "19:00"],
    11: ["19:10", "20:00"],
    12: ["20:10", "21:00"],
    13: ["21:10", "22:00"],
  };

  const weekdayMap: Record<string, number> = {
    星期一: 1,
    星期二: 2,
    星期三: 3,
    星期四: 4,
    星期五: 5,
    星期六: 6,
    星期日: 7,
  };

  const events: CalendarEvent[] = [];

  const rows = $("table.grid_view tr").slice(1);
  rows.each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (tds.length < 8) return;

    const className = $(tds[1]).text().trim();
    const title = $(tds[2]).text().trim();
    const timeClass = $(tds[4]).text().trim();
    const teacher = $(tds[7]).text().trim();
    const classroomMatch = timeClass.match(/\(([^)]+)\)/);

    const classroom =
      classroomMatch && classroomMatch[1] ? classroomMatch[1].trim() : "";

    const dayMatch = timeClass.match(/(星期[一二三四五六日])/);

    const weekday =
      dayMatch && dayMatch[1] ? (weekdayMap[dayMatch[1]] ?? 0) : 0;

    const periods = parsePeriods(timeClass);
    if (periods.length === 0 || weekday===0 || !title) return;

    // 合併為連續區間，並為每個區間建立一個事件
    let rangeStart = periods[0];
    let prev = periods[0];

    if (rangeStart === undefined || prev === undefined) return;

    const pushEvent = (start: number, end: number) => {
      const usedPeriods: number[] = [];
      for (let p = start; p <= end; p++) usedPeriods.push(p);

      const firstPeriod = usedPeriods[0];
      const lastPeriod = usedPeriods.at(-1);

      const startTime =
        periodTimes[start]?.[0] ??
        (firstPeriod !== undefined
          ? periodTimes[firstPeriod]?.[0]
          : undefined) ??
        "00:00";

      const endTime =
        periodTimes[end]?.[1] ??
        (lastPeriod !== undefined ? periodTimes[lastPeriod]?.[1] : undefined) ??
        "00:00";

      events.push({
        weekday,
        periods: usedPeriods,
        startTime,
        endTime,
        title,
        teacher,
        className,
        classroom,
      });
    };

    for (let i = 1; i < periods.length; i++) {
      const cur = periods[i];
      if (cur === undefined) continue;

      if (cur === prev + 1) {
        prev = cur;
        continue;
      }

      pushEvent(rangeStart, prev);

      // 開始新的 range
      rangeStart = cur;
      prev = cur;
    }

    pushEvent(rangeStart, prev);
  });

  return events;
}
